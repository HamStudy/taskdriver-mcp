import { 
  Project, 
  ProjectCreateInput, 
  ProjectUpdateInput,
  Task, 
  TaskCreateInput, 
  TaskUpdateInput, 
  TaskFilters,
  TaskResult,
  TaskInput,
  TaskType, 
  TaskTypeCreateInput, 
  TaskTypeUpdateInput,
  TaskAssignmentResult,
  AgentStatus,
  Session,
  SessionCreateInput,
  SessionUpdateInput
} from '../types/index.js';

/**
 * Storage provider interface for TaskDriver
 * All implementations must provide atomic operations for task assignment
 */
export interface StorageProvider {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Project operations
  createProject(input: ProjectCreateInput): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project>;
  listProjects(includeClosed?: boolean): Promise<Project[]>;
  deleteProject(projectId: string): Promise<void>;

  // Task Type operations
  createTaskType(input: TaskTypeCreateInput): Promise<TaskType>;
  getTaskType(typeId: string): Promise<TaskType | null>;
  updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType>;
  listTaskTypes(projectId: string): Promise<TaskType[]>;
  deleteTaskType(typeId: string): Promise<void>;

  // Task operations
  createTask(input: TaskCreateInput): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  updateTask(taskId: string, input: TaskUpdateInput): Promise<Task>;
  listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>;
  deleteTask(taskId: string): Promise<void>;
  
  // CRITICAL: Lease-based task assignment (atomic operations)
  // These MUST be atomic across all providers to prevent race conditions
  getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult>;
  completeTask(taskId: string, agentName: string, result: TaskResult): Promise<void>;
  failTask(taskId: string, agentName: string, result: TaskResult, canRetry?: boolean): Promise<void>;
  
  // Agent status operations (for monitoring/compatibility)
  // These work with the lease data, no persistent agent storage
  listActiveAgents(projectId: string): Promise<AgentStatus[]>;
  getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null>;
  
  // Lease management operations
  findExpiredLeases(): Promise<Task[]>;
  requeueTask(taskId: string): Promise<void>;
  extendLease(taskId: string, additionalMinutes: number): Promise<void>;
  
  
  // Utility operations
  findDuplicateTask(projectId: string, typeId: string, variables?: Record<string, string>): Promise<Task | null>;
  getTaskHistory(taskId: string): Promise<Task[]>;
  
  // Session management operations (for HTTP server mode)
  createSession(input: SessionCreateInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, input: SessionUpdateInput): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]>;
  cleanupExpiredSessions(): Promise<number>;
  
  // Health and metrics
  healthCheck(): Promise<{ healthy: boolean; message?: string }>;
  getMetrics(): Promise<Record<string, number>>;
}

/**
 * Base class for storage providers with common functionality
 */
export abstract class BaseStorageProvider implements StorageProvider {
  protected initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.doInitialize();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    await this.doClose();
    this.initialized = false;
  }

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Storage provider not initialized. Call initialize() first.');
    }
  }

  // Abstract methods that implementations must provide
  protected abstract doInitialize(): Promise<void>;
  protected abstract doClose(): Promise<void>;

  // All interface methods must be implemented by concrete classes
  abstract createProject(input: ProjectCreateInput): Promise<Project>;
  abstract getProject(projectId: string): Promise<Project | null>;
  abstract updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project>;
  abstract listProjects(includeClosed?: boolean): Promise<Project[]>;
  abstract deleteProject(projectId: string): Promise<void>;

  abstract createTaskType(input: TaskTypeCreateInput): Promise<TaskType>;
  abstract getTaskType(typeId: string): Promise<TaskType | null>;
  abstract updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType>;
  abstract listTaskTypes(projectId: string): Promise<TaskType[]>;
  abstract deleteTaskType(typeId: string): Promise<void>;

  abstract createTask(input: TaskCreateInput): Promise<Task>;
  abstract getTask(taskId: string): Promise<Task | null>;
  abstract updateTask(taskId: string, input: TaskUpdateInput): Promise<Task>;
  abstract listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>;
  abstract deleteTask(taskId: string): Promise<void>;

  // CRITICAL: Lease-based task assignment (atomic operations)
  abstract getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult>;
  abstract completeTask(taskId: string, agentName: string, result: TaskResult): Promise<void>;
  abstract failTask(taskId: string, agentName: string, result: TaskResult, canRetry?: boolean): Promise<void>;
  
  // Agent status operations (for monitoring/compatibility)
  abstract listActiveAgents(projectId: string): Promise<AgentStatus[]>;
  abstract getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null>;

  abstract findExpiredLeases(): Promise<Task[]>;
  abstract requeueTask(taskId: string): Promise<void>;
  abstract extendLease(taskId: string, additionalMinutes: number): Promise<void>;


  abstract findDuplicateTask(projectId: string, typeId: string, variables?: Record<string, string>): Promise<Task | null>;
  abstract getTaskHistory(taskId: string): Promise<Task[]>;

  abstract createSession(input: SessionCreateInput): Promise<Session>;
  abstract getSession(sessionId: string): Promise<Session | null>;
  abstract updateSession(sessionId: string, input: SessionUpdateInput): Promise<Session>;
  abstract deleteSession(sessionId: string): Promise<void>;
  abstract findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]>;
  abstract cleanupExpiredSessions(): Promise<number>;

  abstract healthCheck(): Promise<{ healthy: boolean; message?: string }>;
  abstract getMetrics(): Promise<Record<string, number>>;
}