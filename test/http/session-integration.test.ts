import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import request from 'supertest';
import { TaskDriverHttpServer } from '../../src/server.js';
import { TaskDriverConfig } from '../../src/config/types.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Session Integration Tests
 * Tests the complete session lifecycle including:
 * - Multi-pod session persistence
 * - Session resumption across server restarts
 * - Session cleanup and management
 * - Real storage-layer persistence
 */

const TEST_DATA_DIR = path.join(process.cwd(), 'test-session-integration-data');

const createTestConfig = (port = 0): TaskDriverConfig => ({
  server: {
    host: 'localhost',
    port,
    cors: {
      origin: '*',
      credentials: true
    }
  },
  storage: {
    provider: 'file' as const,
    fileStorage: {
      dataDir: TEST_DATA_DIR,
      lockTimeout: 5000
    }
  },
  logging: {
    level: 'error',
    format: 'json'
  },
  security: {
    sessionTimeout: 30000, // 30 seconds for faster tests
    rateLimit: {
      windowMs: 60000,
      max: 1000
    }
  },
  defaults: {
    taskTimeout: 300000,
    maxRetries: 3,
    retryDelay: 1000
  }
});

describe('Session Integration Tests', () => {
  let server1: TaskDriverHttpServer;
  let server2: TaskDriverHttpServer;
  let app1: any;
  let app2: any;
  let testProject: any;
  let testAgent: any;

  beforeEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Create the first server and set up test data
    server1 = new TaskDriverHttpServer(createTestConfig());
    await server1.initialize();
    app1 = (server1 as any).app;

    // Create test project and agent using storage directly
    const storage = new FileStorageProvider(TEST_DATA_DIR);
    await storage.initialize();
    
    testProject = await storage.createProject({
      name: 'integration-test-project',
      description: 'Project for integration testing'
    });

    // In the ephemeral agent model, agents don't need to be created
    // They exist only when they have active task leases
    testAgent = {
      name: 'integration-test-agent',
      projectId: testProject.id
    };
    
    await storage.close();
  });

  afterEach(async () => {
    if (server1) await server1.stop();
    if (server2) await server2.stop();
    
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
  });

  describe('Multi-Pod Session Persistence', () => {
    test('should persist sessions across multiple server instances', async () => {
      // Create session on server 1
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;
      const sessionId = loginResponse.body.data.session.id;

      // Start server 2 using the same storage
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Verify session works on server 2
      const sessionResponse = await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(sessionResponse.body.data.session.id).toBe(sessionId);
      expect(sessionResponse.body.data.agent.name).toBe(testAgent.name);
      expect(sessionResponse.body.data.project.id).toBe(testProject.id);
    });

    test('should handle session updates across server instances', async () => {
      // Create session on server 1
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Update session data on server 1
      const sessionData = { serverInstance: 'server1', counter: 1 };
      await request(app1)
        .put('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ data: sessionData })
        .expect(200);

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Verify session data is accessible on server 2
      const sessionResponse = await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(sessionResponse.body.data.session.data).toEqual(sessionData);

      // Update session data on server 2
      const updatedData = { ...sessionData, serverInstance: 'server2', counter: 2 };
      await request(app2)
        .put('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ data: updatedData })
        .expect(200);

      // Verify update is visible on server 1
      const verifyResponse = await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(verifyResponse.body.data.session.data).toEqual(updatedData);
    });

    test('should handle session logout from any server instance', async () => {
      // Create session on server 1
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Logout from server 2
      await request(app2)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      // Verify session is invalid on server 1
      await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);

      // Verify session is invalid on server 2
      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);
    });
  });

  describe('Session Resumption Scenarios', () => {
    test('should resume session after server restart', async () => {
      // Create session
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const originalSessionId = loginResponse.body.data.session.id;

      // Stop and restart server
      await server1.stop();
      server1 = new TaskDriverHttpServer(createTestConfig());
      await server1.initialize();
      app1 = (server1 as any).app;

      // Resume session
      const resumeResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id,
          resumeExisting: true
        })
        .expect(200);

      expect(resumeResponse.body.data.resumed).toBe(true);
      expect(resumeResponse.body.data.session.id).toBe(originalSessionId);
    });

    test('should handle node reconnection scenario', async () => {
      // Simulate agent working on server 1
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Update session with work data
      await request(app1)
        .put('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          data: {
            currentTask: 'task-123',
            progress: 50,
            lastHeartbeat: new Date().toISOString()
          }
        })
        .expect(200);

      // Stop server 1 (simulate pod restart)
      await server1.stop();

      // Start server 2 (simulate new pod)
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Agent reconnects and resumes session
      const resumeResponse = await request(app2)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id,
          resumeExisting: true
        })
        .expect(200);

      expect(resumeResponse.body.data.resumed).toBe(true);
      expect(resumeResponse.body.data.session.data).toMatchObject({
        currentTask: 'task-123',
        progress: 50
      });
    });

    test('should prevent duplicate sessions across server instances', async () => {
      // Create session on server 1
      const loginResponse1 = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken1 = loginResponse1.body.data.sessionToken;

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Create new session on server 2 (should clean up first)
      const loginResponse2 = await request(app2)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken2 = loginResponse2.body.data.sessionToken;

      // Verify first session is invalidated
      await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken1}`)
        .expect(401);

      // Verify second session is valid
      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken2}`)
        .expect(200);
    });
  });

  describe('Session Cleanup and Management', () => {
    test('should clean up expired sessions across server instances', async () => {
      // Create session with very short TTL
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Verify session is valid initially
      await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      // Wait for session to expire (30 seconds as configured)
      await new Promise(resolve => setTimeout(resolve, 31000));

      // Session should be expired on server 1
      await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);

      // Start server 2 and verify session is also expired there
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);
    }, 35000); // Allow time for session expiration

    test('should handle multiple agents with separate sessions', async () => {
      // Create second agent
      const storage = new FileStorageProvider(TEST_DATA_DIR);
      await storage.initialize();
      
      // In the ephemeral agent model, agents don't need to be created
      const testAgent2 = {
        name: 'integration-test-agent-2',
        projectId: testProject.id
      };
      
      await storage.close();

      // Create sessions for both agents
      const loginResponse1 = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const loginResponse2 = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent2.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken1 = loginResponse1.body.data.sessionToken;
      const sessionToken2 = loginResponse2.body.data.sessionToken;

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Both sessions should work on both servers
      const session1Response = await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken1}`)
        .expect(200);

      const session2Response = await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken2}`)
        .expect(200);

      expect(session1Response.body.data.agent.name).toBe(testAgent.name);
      expect(session2Response.body.data.agent.name).toBe(testAgent2.name);

      // Logout one agent from server 1
      await request(app1)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${sessionToken1}`)
        .expect(200);

      // Verify only that session is invalidated
      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken1}`)
        .expect(401);

      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken2}`)
        .expect(200);
    });
  });

  describe('Error Handling in Multi-Pod Environment', () => {
    test('should handle storage corruption gracefully', async () => {
      // Create session
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Verify session works
      await request(app1)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      // Corrupt session file manually
      const sessionDir = path.join(TEST_DATA_DIR, 'sessions');
      const sessionFiles = await fs.readdir(sessionDir);
      if (sessionFiles.length > 0) {
        await fs.writeFile(path.join(sessionDir, sessionFiles[0]), 'corrupted data');
      }

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Session should be invalid due to corruption
      await request(app2)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(401);

      // Should be able to create new session
      const newLoginResponse = await request(app2)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      expect(newLoginResponse.body.success).toBe(true);
    });

    test('should handle concurrent session operations', async () => {
      // Create session
      const loginResponse = await request(app1)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Start server 2
      server2 = new TaskDriverHttpServer(createTestConfig());
      await server2.initialize();
      app2 = (server2 as any).app;

      // Perform concurrent operations on both servers
      const operations = [
        request(app1)
          .put('/api/auth/session')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ data: { operation: 'server1', timestamp: Date.now() } }),
        
        request(app2)
          .put('/api/auth/session')
          .set('Authorization', `Bearer ${sessionToken}`)
          .send({ data: { operation: 'server2', timestamp: Date.now() } }),
        
        request(app1)
          .get('/api/auth/session')
          .set('Authorization', `Bearer ${sessionToken}`),
        
        request(app2)
          .get('/api/auth/session')
          .set('Authorization', `Bearer ${sessionToken}`)
      ];

      // All operations should complete without errors
      const results = await Promise.allSettled(operations);
      
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Operation ${index} failed:`, result.reason);
        }
        expect(result.status).toBe('fulfilled');
      });
    });
  });
});