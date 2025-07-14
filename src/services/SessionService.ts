import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { 
  Session, 
  SessionCreateInput, 
  SessionUpdateInput,
  Agent,
  Project
} from '../types/index.js';
import type { StorageProvider } from '../storage/StorageProvider.js';
import { AgentService } from './AgentService.js';
import { ProjectService } from './ProjectService.js';

/**
 * Service for managing HTTP sessions with authentication
 * Provides session-based authentication for HTTP server mode
 */
export class SessionService {
  constructor(
    private storage: StorageProvider,
    private agentService: AgentService,
    private projectService: ProjectService,
    private sessionTimeoutSeconds: number = 3600 // 1 hour default
  ) {}

  /**
   * Create a new session for an agent
   * Handles duplicate session prevention and session resumption
   */
  async createSession(
    agentName: string, 
    projectId: string, 
    options?: { 
      ttlSeconds?: number; 
      data?: Record<string, any>; 
      allowMultipleSessions?: boolean;
      resumeExisting?: boolean;
    }
  ): Promise<{ session: Session; sessionToken: string; resumed?: boolean }> {
    // Verify agent exists
    const agent = await this.agentService.getAgentStatus(agentName, projectId);
    if (!agent) {
      throw new Error(`Agent ${agentName} not found in project ${projectId}`);
    }

    // Verify project exists
    const project = await this.projectService.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Check for existing sessions for this agent
    const existingSessions = await this.findActiveSessionsForAgent(agentName, projectId);
    
    if (existingSessions.length > 0) {
      if (options?.resumeExisting) {
        // Resume the most recent session
        const sortedSessions = existingSessions.sort((a, b) => 
          new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
        );
        const latestSession = sortedSessions[0];
        
        if (!latestSession) {
          throw new Error('No sessions found for resumption');
        }
        
        // Extend the session
        const extendedSession = await this.extendSession(
          this.generateSessionToken(latestSession.id), 
          options?.ttlSeconds || this.sessionTimeoutSeconds
        );
        
        return { 
          session: extendedSession, 
          sessionToken: this.generateSessionToken(extendedSession.id),
          resumed: true 
        };
      } else if (!options?.allowMultipleSessions) {
        // Clean up existing sessions and create a new one
        await this.cleanupSessionsForAgent(agentName, projectId);
      }
    }

    const ttlSeconds = options?.ttlSeconds || this.sessionTimeoutSeconds;
    
    const session = await this.storage.createSession({
      agentId: agent.id,
      projectId,
      agentName: agent.name,
      ttlSeconds,
      data: options?.data || {}
    });

    // Generate a secure session token (different from session ID for security)
    const sessionToken = this.generateSessionToken(session.id);

    return { session, sessionToken, resumed: false };
  }

  /**
   * Authenticate a session token and return session info
   */
  async authenticateSession(sessionToken: string): Promise<Session | null> {
    try {
      const sessionId = this.extractSessionId(sessionToken);
      const session = await this.storage.getSession(sessionId);
      
      if (!session) {
        return null;
      }

      // Update last accessed time
      await this.storage.updateSession(sessionId, {
        lastAccessedAt: new Date()
      });

      return session;
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate session token format and extract session ID
   */
  async validateSession(sessionToken: string): Promise<{
    session: Session;
    agent: Agent;
    project: Project;
  } | null> {
    const session = await this.authenticateSession(sessionToken);
    if (!session) {
      return null;
    }

    // Get agent and project info
    const [agent, project] = await Promise.all([
      session.agentId ? this.agentService.getAgent(session.agentId) : null,
      session.projectId ? this.projectService.getProject(session.projectId) : null
    ]);

    if (!agent || !project) {
      // Session references invalid agent or project, clean it up
      await this.destroySession(sessionToken);
      return null;
    }

    return { session, agent, project };
  }

  /**
   * Update session data
   */
  async updateSessionData(
    sessionToken: string, 
    data: Record<string, any>
  ): Promise<Session> {
    const sessionId = this.extractSessionId(sessionToken);
    return await this.storage.updateSession(sessionId, { data });
  }

  /**
   * Extend session expiration
   */
  async extendSession(
    sessionToken: string, 
    additionalSeconds: number
  ): Promise<Session> {
    const sessionId = this.extractSessionId(sessionToken);
    const session = await this.storage.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }

    const newExpiresAt = new Date(
      Math.max(
        new Date().getTime() + additionalSeconds * 1000,
        new Date(session.expiresAt).getTime() + additionalSeconds * 1000
      )
    );

    return await this.storage.updateSession(sessionId, {
      expiresAt: newExpiresAt
    });
  }

  /**
   * Destroy a session
   */
  async destroySession(sessionToken: string): Promise<void> {
    try {
      const sessionId = this.extractSessionId(sessionToken);
      await this.storage.deleteSession(sessionId);
    } catch (error) {
      // Ignore errors when destroying sessions
    }
  }

  /**
   * Find active sessions for a specific agent
   */
  async findActiveSessionsForAgent(agentName: string, projectId: string): Promise<Session[]> {
    return await this.storage.findSessionsByAgent(agentName, projectId);
  }

  /**
   * Clean up all sessions for a specific agent
   */
  async cleanupSessionsForAgent(agentName: string, projectId: string): Promise<number> {
    const sessions = await this.findActiveSessionsForAgent(agentName, projectId);
    let cleanedCount = 0;
    
    for (const session of sessions) {
      try {
        await this.storage.deleteSession(session.id);
        cleanedCount++;
      } catch (error) {
        // Continue cleaning even if one fails
      }
    }
    
    return cleanedCount;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    return await this.storage.cleanupExpiredSessions();
  }

  /**
   * Generate a secure session token
   */
  private generateSessionToken(sessionId: string): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    const payload = `${sessionId}:${timestamp}:${random}`;
    
    // Create HMAC signature (in production, use a secret key from config)
    const secret = process.env.SESSION_SECRET || 'taskdriver-session-secret';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return Buffer.from(`${payload}:${signature}`).toString('base64');
  }

  /**
   * Extract session ID from token and verify signature
   */
  private extractSessionId(sessionToken: string): string {
    try {
      const decoded = Buffer.from(sessionToken, 'base64').toString('utf8');
      const parts = decoded.split(':');
      
      if (parts.length !== 4) {
        throw new Error('Invalid token format');
      }

      const [sessionId, timestamp, random, signature] = parts;
      
      if (!sessionId || !timestamp || !random || !signature) {
        throw new Error('Invalid token format - missing components');
      }
      const payload = `${sessionId}:${timestamp}:${random}`;
      
      // Verify signature
      const secret = process.env.SESSION_SECRET || 'taskdriver-session-secret';
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        throw new Error('Invalid token signature');
      }

      return sessionId;
    } catch (error) {
      throw new Error('Invalid session token');
    }
  }
}