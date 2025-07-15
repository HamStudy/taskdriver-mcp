import { 
  Task,
  TaskResult,
  TaskAssignmentResult,
  AgentStatus
} from '../types/index.js';
import { StorageProvider } from '../storage/index.js';
import { ProjectService } from './ProjectService.js';
import { TaskService } from './TaskService.js';

/**
 * Service for lease-based task assignment to ephemeral agents
 * Agents are no longer persistent entities - they're just queue workers
 */
export class AgentService {
  constructor(
    private storage: StorageProvider,
    private projectService: ProjectService,
    private taskService: TaskService
  ) {}

  /**
   * Get the next available task for an agent (atomic lease-based assignment)
   * If agentName provided and has existing lease: resume that task
   * If agentName provided but no existing lease: assign new task
   * If no agentName: auto-generate one and assign task
   */
  async getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult> {
    // Validate project exists and is active
    await this.projectService.validateProjectAccess(projectId);

    // Use the atomic getNextTask operation from storage
    return await this.storage.getNextTask(projectId, agentName);
  }

  /**
   * Complete a task assignment
   */
  async completeTask(
    agentName: string, 
    projectId: string, 
    taskId: string, 
    result: TaskResult
  ): Promise<void> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    // Complete the task (this validates agent assignment internally)
    await this.storage.completeTask(taskId, agentName, result);
  }

  /**
   * Fail a task assignment
   */
  async failTask(
    agentName: string, 
    projectId: string, 
    taskId: string, 
    result: TaskResult,
    canRetry: boolean = true
  ): Promise<void> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    // Fail the task (this validates agent assignment internally)
    await this.storage.failTask(taskId, agentName, result, canRetry);
  }

  /**
   * List currently active agents (agents with leased tasks)
   * This is for monitoring/compatibility - no persistent agent storage
   */
  async listActiveAgents(projectId: string): Promise<AgentStatus[]> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    return await this.storage.listActiveAgents(projectId);
  }

  /**
   * Get status of a specific agent (if they have an active lease)
   */
  async getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    return await this.storage.getAgentStatus(agentName, projectId);
  }

  /**
   * Extend the lease on a task (for long-running operations)
   */
  async extendTaskLease(taskId: string, agentName: string, additionalMinutes: number): Promise<void> {
    // Get the task to validate agent assignment and get project
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.assignedTo !== agentName) {
      throw new Error(`Task ${taskId} is not assigned to agent ${agentName}`);
    }

    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not in running state`);
    }

    // Validate project exists
    await this.projectService.validateProjectAccess(task.projectId);

    // Extend the lease
    await this.storage.extendLease(taskId, additionalMinutes);
  }
}