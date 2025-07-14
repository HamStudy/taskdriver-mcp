export interface TaskType {
  id: string;
  name: string;
  projectId: string;
  template?: string;  // Template with variables like {{threadId}}
  variables?: string[];  // List of required variables
  duplicateHandling: 'ignore' | 'fail' | 'allow';  // How to handle duplicate variable combinations
  maxRetries: number;  // Maximum server-side retries for failed tasks
  leaseDurationMinutes: number;  // How long agents have to complete tasks
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskTypeCreateInput {
  name: string;
  projectId: string;
  template?: string;
  variables?: string[];
  duplicateHandling?: 'ignore' | 'fail' | 'allow';
  maxRetries?: number;  // Defaults to project setting
  leaseDurationMinutes?: number;  // Defaults to project setting
}

export interface TaskTypeUpdateInput {
  name?: string;
  template?: string;
  variables?: string[];
  duplicateHandling?: 'ignore' | 'fail' | 'allow';
  maxRetries?: number;
  leaseDurationMinutes?: number;
}