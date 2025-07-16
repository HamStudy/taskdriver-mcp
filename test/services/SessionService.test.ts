import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SessionService } from '../../src/services/SessionService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
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
 * 
 * NOTE: Updated for new lease-based agent model where agents are ephemeral
 * and only exist when they have active task leases. Tests create tasks
 * and establish agent leases rather than registering persistent agents.
 */

const TEST_DATA_DIR = path.join(process.cwd(), 'test-session-data');

describe('SessionService', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let taskService: TaskService;
  let taskTypeService: TaskTypeService;
  let agentService: AgentService;
  let sessionService: SessionService;
  let testProject: any;
  let testTaskType: any;
  let testAgentName: string;

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
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);
    sessionService = new SessionService(storage, agentService, projectService, 60); // 60 second timeout

    // Create test project
    testProject = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for session tests'
    });

    // Create a task type for testing
    testTaskType = await taskTypeService.createTaskType({
      projectId: testProject.id,
      name: 'test-task-type',
      template: 'Test instruction for task'
    });

    // Set agent name that will be used for testing
    testAgentName = 'test-agent';
  });

  // Helper function to establish an agent lease (create task and assign to agent)
  async function establishAgentLease(agentName: string = testAgentName) {
    // Create a task
    const task = await taskService.createTask({
      projectId: testProject.id,
      typeId: testTaskType.id,
      variables: {}
    });

    // Assign the task to the agent (this creates the lease)
    const assignment = await agentService.getNextTask(testProject.id, agentName);
    
    return { task, assignment };
  }

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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);

      expect(result.resumed).toBe(false);
      expect(result.session).toMatchObject({
        id: expect.any(String),
        agentId: testAgentName,
        projectId: testProject.id,
        agentName: testAgentName,
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const customTtl = 300; // 5 minutes
      const result = await sessionService.createSession(testAgentName, testProject.id, {
        ttlSeconds: customTtl
      });

      const session = result.session;
      const expectedExpiry = new Date(session.createdAt.getTime() + customTtl * 1000);
      
      // Allow 1 second tolerance for test execution time
      expect(Math.abs(session.expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(1000);
    });

    test('should create session with custom data', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const customData = { userId: '123', preferences: { theme: 'dark' } };
      const result = await sessionService.createSession(testAgentName, testProject.id, {
        data: customData
      });

      expect(result.session.data).toEqual(customData);
    });

    test('should allow session creation for agent without active lease', async () => {
      // In the ephemeral agent model, agents don't need to exist in storage before creating sessions
      // Sessions can be created for any agent name as long as the project exists
      const result = await sessionService.createSession('nonexistent-agent', testProject.id);
      
      expect(result.resumed).toBe(false);
      expect(result.session).toMatchObject({
        id: expect.any(String),
        agentId: 'nonexistent-agent',
        projectId: testProject.id,
        agentName: 'nonexistent-agent',
        createdAt: expect.any(Date),
        lastAccessedAt: expect.any(Date),
        expiresAt: expect.any(Date)
      });
      
      expect(typeof result.sessionToken).toBe('string');
      expect(result.sessionToken.length).toBeGreaterThan(0);
    });

    test('should reject session creation for nonexistent project', async () => {
      await expect(sessionService.createSession(testAgentName, 'nonexistent-project'))
        .rejects.toThrow('Project nonexistent-project not found');
    });
  });

  describe('Session Resumption', () => {
    test('should resume existing session', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create initial session
      const firstResult = await sessionService.createSession(testAgentName, testProject.id);
      const originalSessionId = firstResult.session.id;

      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      // Attempt to resume
      const resumeResult = await sessionService.createSession(testAgentName, testProject.id, {
        resumeExisting: true
      });

      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.session.id).toBe(originalSessionId);
      expect(resumeResult.session.lastAccessedAt.getTime()).toBeGreaterThan(
        firstResult.session.lastAccessedAt.getTime()
      );
    });

    test('should resume most recent session when multiple exist', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create multiple sessions
      await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const secondResult = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Resume should get the most recent one
      const resumeResult = await sessionService.createSession(testAgentName, testProject.id, {
        resumeExisting: true
      });

      expect(resumeResult.resumed).toBe(true);
      expect(resumeResult.session.id).toBe(secondResult.session.id);
    });

    test('should create new session when no existing sessions to resume', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id, {
        resumeExisting: true
      });

      expect(result.resumed).toBe(false);
      expect(result.session.id).toBeTruthy();
    });
  });

  describe('Duplicate Session Prevention', () => {
    test('should clean up existing sessions by default', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create first session
      const firstResult = await sessionService.createSession(testAgentName, testProject.id);
      
      // Create second session (should clean up first)
      const secondResult = await sessionService.createSession(testAgentName, testProject.id);

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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const firstResult = await sessionService.createSession(testAgentName, testProject.id);
      
      const secondResult = await sessionService.createSession(testAgentName, testProject.id, {
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      const session = await sessionService.authenticateSession(result.sessionToken);
      
      expect(session).toMatchObject({
        id: result.session.id,
        agentName: testAgentName,
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create a valid session first
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
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
      // Establish agent lease first
      const { assignment } = await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      const validation = await sessionService.validateSession(result.sessionToken);
      
      expect(validation).toMatchObject({
        session: expect.objectContaining({
          id: result.session.id
        }),
        agent: expect.objectContaining({
          name: testAgentName
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

    test('should handle session validation when agent lease expires', async () => {
      // Establish agent lease first
      const { assignment } = await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      // Complete the task to make the agent lease expire (simulates agent becoming invalid)
      await agentService.completeTask(testAgentName, testProject.id, assignment.task.id, {
        success: true,
        output: 'Test completed'
      });
      
      const validation = await sessionService.validateSession(result.sessionToken);
      // In the new lease model, the session might still be valid even if agent has no active lease
      // The agent reference becomes null but the session isn't automatically cleaned up
      expect(validation).toMatchObject({
        session: expect.objectContaining({
          id: result.session.id
        }),
        agent: null, // No active agent lease
        project: expect.objectContaining({
          name: testProject.name,
          id: testProject.id
        })
      });
    });
  });

  describe('Session Data Management', () => {
    test('should update session data', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      const newData = { counter: 42, settings: { theme: 'dark' } };
      const updatedSession = await sessionService.updateSessionData(result.sessionToken, newData);
      
      expect(updatedSession.data).toEqual(newData);
      
      // Verify persistence
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session!.data).toEqual(newData);
    });

    test('should extend session expiration', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      await sessionService.destroySession(result.sessionToken);
      
      const session = await sessionService.authenticateSession(result.sessionToken);
      expect(session).toBeNull();
    });

    test('should clean up sessions for specific agent', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create multiple sessions for the agent
      const session1 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      
      const cleanedCount = await sessionService.cleanupSessionsForAgent(testAgentName, testProject.id);
      expect(cleanedCount).toBe(2);
      
      // Both sessions should be invalid
      const session1Valid = await sessionService.authenticateSession(session1.sessionToken);
      const session2Valid = await sessionService.authenticateSession(session2.sessionToken);
      
      expect(session1Valid).toBeNull();
      expect(session2Valid).toBeNull();
    });

    test('should find active sessions for agent', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      
      const activeSessions = await sessionService.findActiveSessionsForAgent(testAgentName, testProject.id);
      expect(activeSessions.length).toBe(2);
      
      activeSessions.forEach(session => {
        expect(session).toMatchObject({
          agentName: testAgentName,
          projectId: testProject.id
        });
      });
    });

    test('should clean up expired sessions', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      // Create a session with very short TTL
      const result = await sessionService.createSession(testAgentName, testProject.id, {
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
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const session1 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      
      expect(session1.sessionToken).not.toBe(session2.sessionToken);
    });

    test('should include timestamp in token', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const beforeTime = Date.now();
      const result = await sessionService.createSession(testAgentName, testProject.id);
      const afterTime = Date.now();
      
      // Decode token to verify timestamp
      const decoded = Buffer.from(result.sessionToken, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const timestamp = parseInt(parts[1]);
      
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    test('should generate unique session tokens for security', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const session1 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      const session2 = await sessionService.createSession(testAgentName, testProject.id, {
        allowMultipleSessions: true
      });
      
      // Verify tokens are unique (security requirement)
      expect(session1.sessionToken).not.toBe(session2.sessionToken);
      
      // Verify tokens are non-empty and properly formatted
      expect(session1.sessionToken).toBeTruthy();
      expect(session2.sessionToken).toBeTruthy();
      expect(typeof session1.sessionToken).toBe('string');
      expect(typeof session2.sessionToken).toBe('string');
    });
  });

  describe('Storage Persistence', () => {
    test('should persist sessions across service restarts', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const result = await sessionService.createSession(testAgentName, testProject.id);
      
      // Create new SessionService instance to simulate restart
      const newSessionService = new SessionService(storage, agentService, projectService, 60);
      
      const session = await newSessionService.authenticateSession(result.sessionToken);
      expect(session).toMatchObject({
        id: result.session.id,
        agentName: testAgentName
      });
    });

    test('should maintain session data across service restarts', async () => {
      // Establish agent lease first
      await establishAgentLease(testAgentName);
      
      const customData = { persistent: true, value: 123 };
      const result = await sessionService.createSession(testAgentName, testProject.id, {
        data: customData
      });
      
      // Create new SessionService instance
      const newSessionService = new SessionService(storage, agentService, projectService, 60);
      
      const session = await newSessionService.authenticateSession(result.sessionToken);
      expect(session!.data).toEqual(customData);
    });
  });
});