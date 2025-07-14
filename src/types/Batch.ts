export interface BatchStatus {
  batchId: string;
  projectId: string;
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  createdAt: Date;
}

export interface BatchCreateResult {
  batchId: string;
  tasksCreated: number;
  duplicatesSkipped?: number;
  errors?: string[];
}