export interface Agent {
  id: string;
  name: string;
  projectId: string;
  sessionId?: string;
  status: 'idle' | 'working' | 'disabled';
  currentTaskId?: string;
  apiKey?: string;  // Authentication token for this agent
  apiKeyHash?: string;  // Hashed version stored in database
  lastSeen: Date;
  connectedAt?: Date;
  createdAt: Date;
  capabilities?: string[];  // Optional: what task types this agent can handle
}

export interface AgentCreateInput {
  name?: string;  // Auto-generated if not provided
  projectId: string;
  capabilities?: string[];
  apiKeyHash?: string;  // For internal use during creation
}

export interface AgentUpdateInput {
  name?: string;
  status?: Agent['status'];
  currentTaskId?: string;
  lastSeen?: Date;
  capabilities?: string[];
}

export interface AgentRegistrationResult {
  agent: Agent;
  apiKey: string;
}