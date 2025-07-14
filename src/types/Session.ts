/**
 * Session management types for HTTP server mode
 */

export interface Session {
  id: string;
  agentId?: string;
  projectId?: string;
  agentName?: string;
  createdAt: Date;
  lastAccessedAt: Date;
  expiresAt: Date;
  data: Record<string, any>;
}

export interface SessionCreateInput {
  agentId?: string;
  projectId?: string;
  agentName?: string;
  data?: Record<string, any>;
  ttlSeconds?: number;
}

export interface SessionUpdateInput {
  lastAccessedAt?: Date;
  expiresAt?: Date;
  data?: Record<string, any>;
}

export interface AuthenticatedRequest {
  sessionId: string;
  session: Session;
  agentId?: string;
  projectId?: string;
}