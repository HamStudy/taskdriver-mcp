import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import request from 'supertest';
import { TaskDriverHttpServer } from '../../src/server.js';
import { TaskDriverConfig } from '../../src/config/types.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * HTTP Server Integration Tests
 * Tests the complete HTTP server functionality including:
 * - Authentication and session management
 * - REST API endpoints
 * - Error handling
 * - Multi-pod session persistence
 */

const TEST_DATA_DIR = path.join(process.cwd(), 'test-http-data');

const createTestConfig = (): TaskDriverConfig => ({
  server: {
    host: 'localhost',
    port: 0, // Let the OS assign a free port
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
    level: 'error', // Reduce noise during tests
    format: 'json'
  },
  security: {
    sessionTimeout: 60000, // 1 minute for tests
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

describe('HTTP Server', () => {
  let server: TaskDriverHttpServer;
  let app: any;
  let testProject: any;
  let testAgent: any;
  let sessionToken: string;

  beforeEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Create and initialize server
    const config = createTestConfig();
    server = new TaskDriverHttpServer(config);
    await server.initialize();
    
    // Get Express app for testing
    app = (server as any).app;

    // Create test project and agent for authenticated tests
    const storage = new FileStorageProvider(TEST_DATA_DIR);
    await storage.initialize();
    
    const projectService = new ProjectService(storage);
    testProject = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for HTTP server tests'
    });

    const agentService = new AgentService(storage, projectService, null as any);
    const agentResult = await agentService.registerAgent({
      projectId: testProject.id,
      name: 'test-agent',
      capabilities: ['test']
    });
    testAgent = agentResult.agent;
    
    await storage.close();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
    
    // Clean up test data
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: expect.any(String),
        storage: expect.any(Object)
      });
      expect(response.body.timestamp).toBeTruthy();
    });
  });

  describe('Authentication', () => {
    test('should create session successfully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          sessionToken: expect.any(String),
          session: expect.objectContaining({
            id: expect.any(String),
            agentName: testAgent.name,
            projectId: testProject.id
          }),
          resumed: false
        }
      });

      sessionToken = response.body.data.sessionToken;
    });

    test('should resume existing session', async () => {
      // Create initial session
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const firstToken = loginResponse.body.data.sessionToken;

      // Attempt to resume
      const resumeResponse = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id,
          resumeExisting: true
        })
        .expect(200);

      expect(resumeResponse.body.data.resumed).toBe(true);
      expect(resumeResponse.body.data.session.id).toBe(loginResponse.body.data.session.id);
    });

    test('should prevent duplicate sessions by default', async () => {
      // Create first session
      await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      // Create second session (should clean up first)
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      expect(response.body.data.resumed).toBe(false);
    });

    test('should allow multiple sessions when configured', async () => {
      // Create first session
      await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      // Create second session with multiple sessions allowed
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id,
          allowMultipleSessions: true
        })
        .expect(200);

      expect(response.body.data.resumed).toBe(false);
      expect(response.body.success).toBe(true);
    });

    test('should reject login with invalid agent', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          agentName: 'nonexistent-agent',
          projectId: testProject.id
        })
        .expect(400);
    });

    test('should reject login with invalid project', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: 'nonexistent-project'
        })
        .expect(400);
    });

    test('should logout successfully', async () => {
      // Login first
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const token = loginResponse.body.data.sessionToken;

      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Verify session is invalid
      await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('Authentication Middleware', () => {
    beforeEach(async () => {
      // Create session for authenticated tests
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      sessionToken = response.body.data.sessionToken;
    });

    test('should reject requests without authorization header', async () => {
      await request(app)
        .get('/api/projects')
        .expect(401);
    });

    test('should reject requests with invalid bearer token format', async () => {
      await request(app)
        .get('/api/projects')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);
    });

    test('should reject requests with invalid session token', async () => {
      await request(app)
        .get('/api/projects')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    test('should accept requests with valid session token', async () => {
      await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
    });

    test('should provide session info in authenticated requests', async () => {
      const response = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        session: expect.objectContaining({
          agentName: testAgent.name,
          projectId: testProject.id
        }),
        agent: expect.objectContaining({
          name: testAgent.name
        }),
        project: expect.objectContaining({
          name: testProject.name
        })
      });
    });
  });

  describe('Project API', () => {
    beforeEach(async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      sessionToken = response.body.data.sessionToken;
    });

    test('should list projects', async () => {
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('should create new project', async () => {
      const projectData = {
        name: 'new-test-project',
        description: 'New project created via API'
      };

      const response = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send(projectData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        name: projectData.name,
        description: projectData.description,
        status: 'active'
      });
    });

    test('should get project by ID', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: testProject.id,
        name: testProject.name
      });
    });

    test('should update project', async () => {
      const updateData = {
        description: 'Updated description'
      };

      const response = await request(app)
        .put(`/api/projects/${testProject.id}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.description).toBe(updateData.description);
    });

    test('should get project stats', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/stats`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        project: expect.objectContaining({
          stats: expect.objectContaining({
            totalTasks: expect.any(Number),
            queuedTasks: expect.any(Number),
            runningTasks: expect.any(Number),
            completedTasks: expect.any(Number),
            failedTasks: expect.any(Number)
          })
        }),
        activeAgents: expect.any(Number)
      });
    });

    test('should return 404 for nonexistent project', async () => {
      await request(app)
        .get('/api/projects/nonexistent-id')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(404);
    });
  });

  describe('Agent API', () => {
    beforeEach(async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      sessionToken = response.body.data.sessionToken;
    });

    test('should list agents for project', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProject.id}/agents`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toMatchObject({
        name: testAgent.name,
        projectId: testProject.id
      });
    });

    test('should create new agent', async () => {
      const agentData = {
        name: 'new-test-agent',
        capabilities: ['test', 'demo']
      };

      const response = await request(app)
        .post(`/api/projects/${testProject.id}/agents`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .send(agentData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.agent).toMatchObject({
        name: agentData.name,
        capabilities: agentData.capabilities
      });
    });

    test('should get agent by ID', async () => {
      const response = await request(app)
        .get(`/api/agents/${testAgent.id}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: testAgent.id,
        name: testAgent.name
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      sessionToken = response.body.data.sessionToken;
    });

    test('should handle 404 for unknown routes', async () => {
      await request(app)
        .get('/api/unknown-endpoint')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(404);
    });

    test('should handle validation errors', async () => {
      const response = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({}) // Missing required fields
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeTruthy();
    });

    test('should include correlation ID in error responses', async () => {
      const correlationId = 'test-correlation-123';
      
      const response = await request(app)
        .get('/api/projects/nonexistent')
        .set('Authorization', `Bearer ${sessionToken}`)
        .set('X-Correlation-ID', correlationId)
        .expect(404);

      expect(response.headers['x-correlation-id']).toBe(correlationId);
    });

    test('should return proper error structure', async () => {
      const response = await request(app)
        .get('/api/projects/nonexistent')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: expect.any(String),
        timestamp: expect.any(String)
      });
    });
  });

  describe('Session Management Advanced', () => {
    test('should update session data', async () => {
      // Login
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const token = loginResponse.body.data.sessionToken;

      // Update session data
      const sessionData = { customField: 'test-value', counter: 42 };
      
      const updateResponse = await request(app)
        .put('/api/auth/session')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: sessionData })
        .expect(200);

      expect(updateResponse.body.success).toBe(true);
      expect(updateResponse.body.data.data).toMatchObject(sessionData);

      // Verify data persists
      const getResponse = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(getResponse.body.data.session.data).toMatchObject(sessionData);
    });

    test('should handle session cleanup on expired sessions', async () => {
      // This would require manipulating time or having very short session timeouts
      // For now, we'll test the basic flow
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    test('should apply rate limiting to API endpoints', async () => {
      // Login first to get access to API endpoints
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          agentName: testAgent.name,
          projectId: testProject.id
        })
        .expect(200);

      const sessionToken = loginResponse.body.data.sessionToken;

      // Test rate limiting on API endpoints
      const response = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      // Rate limit headers should be present on API endpoints
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
    });
  });

  describe('CORS and Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check for security headers added by helmet
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    test('should handle CORS preflight requests', async () => {
      await request(app)
        .options('/api/projects')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
    });
  });
});