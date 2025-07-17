export interface Task {
  id: string;
  projectId: string;
  typeId: string;
  description: string;  // Human-readable description
  instructions?: string;  // Final instructions (only for non-template tasks)
  variables?: Record<string, string>;  // Variable values
  status: 'queued' | 'running' | 'completed' | 'failed';
  assignedTo?: string;  // Agent name
  leaseExpiresAt?: Date;  // When current lease expires (for running tasks)
  retryCount: number;  // Number of times this task has been retried
  maxRetries: number;  // Maximum retries allowed (from task type or project default)
  createdAt: Date;
  updatedAt?: Date;
  assignedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  result?: TaskResult;
  attempts: TaskAttempt[];
}

export interface TaskAttempt {
  id: string;
  agentName: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  explanation?: string;
  failureReason?: 'agent_reported' | 'timeout' | 'server_error';
  leaseExpiresAt?: Date;  // When this attempt's lease expires
  result?: TaskResult;
}

export interface TaskCreateInput {
  projectId: string;
  typeId: string;
  id?: string;  // Optional custom task ID
  description?: string;  // Optional human-readable description
  instructions?: string;  // Only for non-template tasks
  variables?: Record<string, string>;
}

export interface TaskUpdateInput {
  status?: Task['status'];
  assignedTo?: string;
  leaseExpiresAt?: Date;
  retryCount?: number;
}

export interface TaskFilters {
  status?: Task['status'];
  assignedTo?: string;
  typeId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  explanation?: string;
  duration?: number;
  metadata?: Record<string, any>;
  canRetry?: boolean;  // Only for failed tasks
}

export interface TaskInput {
  type: string;
  instructions?: string;
  vars?: Record<string, string>;
  id?: string;
  description?: string;
}
