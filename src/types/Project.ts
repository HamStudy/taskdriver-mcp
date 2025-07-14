export interface Project {
  id: string;
  name: string;
  description: string;
  instructions?: string;
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
  config: {
    defaultMaxRetries: number;  // Default retry count for new task types
    defaultLeaseDurationMinutes: number;  // Default lease duration for new task types
    reaperIntervalMinutes: number;  // How often to check for expired leases
  };
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    queuedTasks: number;
    runningTasks: number;
  };
}

export interface ProjectCreateInput {
  name: string;
  description: string;
  instructions?: string;
  config?: Partial<Project['config']>;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  instructions?: string;
  status?: Project['status'];
  config?: Partial<Project['config']>;
}

export interface ProjectStatus {
  project: Project;
  queueDepth: number;
  activeAgents: number;
  recentActivity: {
    tasksCompletedLastHour: number;
    tasksFailedLastHour: number;
    averageTaskDuration: number;
  };
}