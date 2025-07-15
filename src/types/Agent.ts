import { Task } from './Task.js';

// Agent is now just a runtime concept for tracking active task assignments
// No persistent storage - agents are ephemeral queue workers
export interface AgentTaskAssignment {
  agentName: string;
  projectId: string;
  taskId: string;
  assignedAt: Date;
  leaseExpiresAt: Date;
}

// Result of getting next task - includes lease information
export interface TaskAssignmentResult {
  task: Task | null;
  agentName: string;  // Generated if not provided
  leaseToken?: string;  // For lease renewal (optional feature)
}

// For backwards compatibility in some APIs that list "agents"
// This is just a view of currently active assignments
export interface AgentStatus {
  name: string;
  projectId: string;
  status: 'working' | 'idle';  // simplified - just working or idle
  currentTaskId?: string;
  assignedAt?: Date;
  leaseExpiresAt?: Date;
}