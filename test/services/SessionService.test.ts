import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SessionService } from '../../src/services/SessionService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * SessionService Tests
 * Tests comprehensive session management functionality including:
 * - Session creation and resumption
 * - Session token generation and validation
 * - Multi-session management
 * - Session cleanup and expiration
 * - Storage-layer persistence for multi-pod support
 */

const TEST_DATA_DIR = path.join(process.cwd(), 'test-session-data');

describe('SessionService', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let agentService: AgentService;
  let sessionService: SessionService;
  let testProject: any;
  let testAgent: any;

  beforeEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Initialize storage and services
    storage = new FileStorageProvider(TEST_DATA_DIR);
    await storage.initialize();

    projectService = new ProjectService(storage);
    agentService = new AgentService(storage, projectService, null as any);
    sessionService = new SessionService(storage, agentService, projectService, 60); // 60 second timeout

    // Create test project and agent
    testProject = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for session tests'
    });

    const agentResult = await agentService.registerAgent({
      projectId: testProject.id,
      name: 'test-agent',
      capabilities: ['test']
    });
    testAgent = agentResult.agent;
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
    
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
  });

  describe('Session Creation', () => {
    test('should create session successfully', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);

      expect(result.resumed).toBe(false);
      expect(result.session).toMatchObject({
        id: expect.any(String),
        agentId: testAgent.id,
        projectId: testProject.id,
        agentName: testAgent.name,
        createdAt: expect.any(Date),
        lastAccessedAt: expect.any(Date),
        expiresAt: expect.any(Date)
      });
      
      // Verify session token is a string  
      expect(typeof result.sessionToken).toBe('string');
      expect(result.sessionToken.length).toBeGreaterThan(0);
      
      // Verify session token is valid base64
      expect(() => Buffer.from(result.sessionToken, 'base64').toString()).not.toThrow();
    });

    test('should create session with custom TTL', async () => {
      const customTtl = 300; // 5 minutes
      const result = await sessionService.createSession(testAgent.name, testProject.id, {
        ttlSeconds: customTtl
      });

      const session = result.session;
      const expectedExpiry = new Date(session.createdAt.getTime() + customTtl * 1000);
      
      // Allow 1 second tolerance for test execution time
      expect(Math.abs(session.expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    test('should create session with custom data', async () => {
      const customData = { userId: '123', preferences: { theme: 'dark' } };
      const result = await sessionService.createSession(testAgent.name, testProject.id, {
        data: customData
      });

      expect(result.session.data).toEqual(customData);
    });

    test('should reject session creation for nonexistent agent', async () => {
      await expect(sessionService.createSession('nonexistent-agent', testProject.id))
        .rejects.toThrow('Agent nonexistent-agent not found');
    });

    test('should reject session creation for nonexistent project', async () => {
      await expect(sessionService.createSession(testAgent.name, 'nonexistent-project'))
        .rejects.toThrow('Agent test-agent not found in project nonexistent-project');
    });
  });

  describe('Session Resumption', () => {
    test('should resume existing session', async () => {
      // Create initial session
      const firstResult = await sessionService.createSession(testAgent.name, testProject.id);
      const originalSessionId = firstResult.session.id;

      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Attempt to resume
      const resumeResult = await sessionService.createSession(testAgent.name, testProject.id, {
        resumeExisting: true
      });

      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.session.id).toBe(originalSessionId);
      expect(resumeResult.session.lastAccessedAt.getTime()).toBeGreaterThan(
        firstResult.session.lastAccessedAt.getTime()
      );
    });

    test('should resume most recent session when multiple exist', async () => {
      // Create multiple sessions
      await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const secondResult = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Resume should get the most recent one
      const resumeResult = await sessionService.createSession(testAgent.name, testProject.id, {
        resumeExisting: true
      });

      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.session.id).toBe(secondResult.session.id);
    });

    test('should create new session when no existing sessions to resume', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id, {
        resumeExisting: true
      });

      expect(result.resumed).toBe(false);
      expect(result.session.id).toBeTruthy();
    });
  });

  describe('Duplicate Session Prevention', () => {
    test('should clean up existing sessions by default', async () => {
      // Create first session
      const firstResult = await sessionService.createSession(testAgent.name, testProject.id);
      
      // Create second session (should clean up first)
      const secondResult = await sessionService.createSession(testAgent.name, testProject.id);

      expect(secondResult.resumed).toBe(false);
      expect(secondResult.session.id).not.toBe(firstResult.session.id);

      // Verify first session is invalidated
      const firstSessionValid = await sessionService.authenticateSession(firstResult.sessionToken);
      expect(firstSessionValid).toBeNull();

      // Verify second session is valid
      const secondSessionValid = await sessionService.authenticateSession(secondResult.sessionToken);
      expect(secondSessionValid).toBeTruthy();
    });

    test('should allow multiple sessions when configured', async () => {
      const firstResult = await sessionService.createSession(testAgent.name, testProject.id);
      
      const secondResult = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });

      expect(secondResult.resumed).toBe(false);
      expect(secondResult.session.id).not.toBe(firstResult.session.id);

      // Both sessions should be valid
      const firstSessionValid = await sessionService.authenticateSession(firstResult.sessionToken);
      const secondSessionValid = await sessionService.authenticateSession(secondResult.sessionToken);
      
      expect(firstSessionValid).toBeTruthy();
      expect(secondSessionValid).toBeTruthy();
    });
  });

  describe('Session Authentication', () => {
    test('should authenticate valid session token', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      const session = await sessionService.authenticateSession(result.sessionToken);
      
      expect(session).toMatchObject({
        id: result.session.id,
        agentName: testAgent.name,
        projectId: testProject.id
      });
    });

    test('should reject invalid session token', async () => {
      const session = await sessionService.authenticateSession('invalid-token');
      expect(session).toBeNull();
    });

    test('should reject malformed session token', async () => {
      const session = await sessionService.authenticateSession('not-base64-at-all');
      expect(session).toBeNull();
    });

    test('should reject session token with invalid signature', async () => {
      // Create a valid session first
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      // Tamper with the token
      const originalToken = result.sessionToken;
      const decoded = Buffer.from(originalToken, 'base64').toString('utf8');
      const parts = decoded.split(':');
      parts[3] = 'tampered-signature';
      const tamperedToken = Buffer.from(parts.join(':')).toString('base64');
      
      const session = await sessionService.authenticateSession(tamperedToken);
      expect(session).toBeNull();
    });

    test('should update last accessed time on authentication', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      const originalLastAccessed = result.session.lastAccessedAt;
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Authenticate session
      await sessionService.authenticateSession(result.sessionToken);
      
      // Get updated session - need to account for date serialization
      const updatedSession = await sessionService.authenticateSession(result.sessionToken);
      const updatedTime = new Date(updatedSession!.lastAccessedAt).getTime();
      expect(updatedTime).toBeGreaterThan(originalLastAccessed.getTime());
    });
  });

  describe('Session Validation', () => {
    test('should validate session with agent and project info', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      const validation = await sessionService.validateSession(result.sessionToken);
      
      expect(validation).toMatchObject({
        session: expect.objectContaining({
          id: result.session.id
        }),
        agent: expect.objectContaining({
          name: testAgent.name,
          id: testAgent.id
        }),
        project: expect.objectContaining({
          name: testProject.name,
          id: testProject.id
        })
      });
    });

    test('should return null for invalid session', async () => {
      const validation = await sessionService.validateSession('invalid-token');
      expect(validation).toBeNull();
    });

    test('should clean up session with invalid agent reference', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      // Delete the agent to simulate invalid reference
      await agentService.deleteAgent(testAgent.id);
      
      const validation = await sessionService.validateSession(result.sessionToken);
      expect(validation).toBeNull();
      
      // Session should be cleaned up
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session).toBeNull();
    });
  });

  describe('Session Data Management', () => {
    test('should update session data', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      const newData = { counter: 42, settings: { theme: 'dark' } };
      const updatedSession = await sessionService.updateSessionData(result.sessionToken, newData);
      
      expect(updatedSession.data).toEqual(newData);
      
      // Verify persistence
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session!.data).toEqual(newData);
    });

    test('should extend session expiration', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      const originalExpiry = result.session.expiresAt;
      
      const extensionSeconds = 300; // 5 minutes
      const extendedSession = await sessionService.extendSession(result.sessionToken, extensionSeconds);
      
      expect(extendedSession.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
      
      // Should extend from current time or original expiry, whichever is later
      const expectedMinExpiry = Math.max(
        new Date().getTime() + extensionSeconds * 1000,
        originalExpiry.getTime() + extensionSeconds * 1000
      );
      
      expect(extendedSession.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry - 1000); // 1s tolerance
    });

    test('should reject extension of nonexistent session', async () => {
      await expect(sessionService.extendSession('invalid-token', 300))
        .rejects.toThrow('Invalid session token');
    });
  });

  describe('Session Cleanup', () => {
    test('should destroy session', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      await sessionService.destroySession(result.sessionToken);
      
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session).toBeNull();
    });

    test('should clean up sessions for specific agent', async () => {
      // Create multiple sessions for the agent
      const session1 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      
      const cleanedCount = await sessionService.cleanupSessionsForAgent(testAgent.name, testProject.id);
      expect(cleanedCount).toBe(2);
      
      // Both sessions should be invalid
      const session1Valid = await sessionService.authenticateSession(session1.sessionToken);
      const session2Valid = await sessionService.authenticateSession(session2.sessionToken);
      
      expect(session1Valid).toBeNull();
      expect(session2Valid).toBeNull();
    });

    test('should find active sessions for agent', async () => {
      await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      
      const activeSessions = await sessionService.findActiveSessionsForAgent(testAgent.name, testProject.id);
      expect(activeSessions.length).toBe(2);
      
      activeSessions.forEach(session => {
        expect(session).toMatchObject({
          agentName: testAgent.name,
          projectId: testProject.id
        });
      });
    });

    test('should clean up expired sessions', async () => {
      // Create a session with very short TTL
      const result = await sessionService.createSession(testAgent.name, testProject.id, {
        ttlSeconds: 1 // 1 second
      });
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const cleanedCount = await sessionService.cleanupExpiredSessions();
      expect(cleanedCount).toBe(1);
      
      // Session should be invalid
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session).toBeNull();
    });
  });

  describe('Token Security', () => {
    test('should generate unique tokens for different sessions', async () => {
      const session1 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      
      expect(session1.sessionToken).not.toBe(session2.sessionToken);
    });

    test('should include timestamp in token', async () => {
      const beforeTime = Date.now();
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      const afterTime = Date.now();
      
      // Decode token to verify timestamp
      const decoded = Buffer.from(result.sessionToken, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const timestamp = parseInt(parts[1]);
      
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    test('should include random component in token', async () => {
      const session1 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgent.name, testProject.id, {
        allowMultipleSessions: true
      });
      
      // Extract random components
      const decoded1 = Buffer.from(session1.sessionToken, 'base64').toString('utf8');
      const decoded2 = Buffer.from(session2.sessionToken, 'base64').toString('utf8');
      
      const random1 = decoded1.split(':')[2];
      const random2 = decoded2.split(':')[2];
      
      expect(random1).not.toBe(random2);
      expect(random1.length).toBe(32); // 16 bytes * 2 (hex)
      expect(random2.length).toBe(32);
    });
  });

  describe('Storage Persistence', () => {
    test('should persist sessions across service restarts', async () => {
      const result = await sessionService.createSession(testAgent.name, testProject.id);
      
      // Create new SessionService instance to simulate restart
      const newSessionService = new SessionService(storage, agentService, projectService, 60);
      
      const session = await newSessionService.authenticateSession(result.sessionToken);
      expect(session).toMatchObject({
        id: result.session.id,
        agentName: testAgent.name
      });
    });

    test('should maintain session data across service restarts', async () => {
      const customData = { persistent: true, value: 123 };
      const result = await sessionService.createSession(testAgent.name, testProject.id, {
        data: customData
      });
      
      // Create new SessionService instance
      const newSessionService = new SessionService(storage, agentService, projectService, 60);
      
      const session = await newSessionService.authenticateSession(result.sessionToken);
      expect(session!.data).toEqual(customData);
    });
  });
});