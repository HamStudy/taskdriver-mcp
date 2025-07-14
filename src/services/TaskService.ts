import { v4 as uuidv4 } from 'uuid';
import { 
  Task, 
  TaskCreateInput, 
  TaskUpdateInput, 
  TaskFilters,
  TaskInput,
  BatchStatus,
  BatchCreateResult
} from '../types/index.js';
import { StorageProvider } from '../storage/index.js';
import { 
  validate, 
  createTaskSchema, 
  taskFiltersSchema 
} from '../utils/validation.js';
import { 
  replaceTemplateVariables, 
  validateTemplateVariables 
} from '../utils/index.js';
import { ProjectService } from './ProjectService.js';
import { TaskTypeService } from './TaskTypeService.js';
import { LeaseService } from './LeaseService.js';

/**
 * Service for managing tasks
 */
export class TaskService {
  private leaseService: LeaseService;

  constructor(
    private storage: StorageProvider,
    private projectService: ProjectService,
    private taskTypeService: TaskTypeService
  ) {
    this.leaseService = new LeaseService(storage);
  }

  /**
   * Create a new task
   */
  async createTask(input: TaskCreateInput): Promise<Task> {
    const validatedInput = validate(createTaskSchema, input);

    // Validate project and task type
    await this.projectService.validateProjectAccess(validatedInput.projectId);
    const taskType = await this.taskTypeService.validateTaskType(
      validatedInput.typeId, 
      validatedInput.projectId
    );

    // Process template variables if template is defined
    let finalInstructions = validatedInput.instructions;
    if (taskType.template) {
      const variables = validatedInput.variables || {};
      
      // Validate all required variables are provided
      const validation = validateTemplateVariables(taskType.template, variables);
      if (!validation.valid) {
        throw new Error(
          `Missing required template variables: ${validation.missing.join(', ')}`
        );
      }

      // Replace template variables in the template, not the provided instructions
      finalInstructions = replaceTemplateVariables(taskType.template, variables);
    }

    const taskInput: TaskCreateInput = {
      ...validatedInput,
      instructions: finalInstructions,
    };

    return this.storage.createTask(taskInput);
  }

  /**
   * Create multiple tasks in bulk
   */
  async createTasksBulk(projectId: string, tasks: TaskInput[]): Promise<BatchCreateResult> {
    // Validate project exists and is active
    await this.projectService.validateProjectAccess(projectId);

    if (tasks.length === 0) {
      throw new Error('Cannot create bulk tasks: no tasks provided');
    }

    if (tasks.length > 1000) {
      throw new Error('Cannot create bulk tasks: maximum 1000 tasks per batch');
    }

    // Validate all task types exist and belong to this project
    const taskTypeIds = [...new Set(tasks.map(t => t.typeId))];
    const taskTypes = new Map<string, any>();
    
    for (const typeId of taskTypeIds) {
      const taskType = await this.taskTypeService.validateTaskType(typeId, projectId);
      taskTypes.set(typeId, taskType);
    }

    // Process each task and validate template variables
    const processedTasks: TaskCreateInput[] = [];
    const errors: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      try {
        const task = tasks[i];
        if (!task) {
          throw new Error(`Task ${i}: Task is undefined`);
        }
        
        const taskType = taskTypes.get(task.typeId);
        if (!taskType) {
          throw new Error(`Task ${i}: Task type ${task.typeId} not found`);
        }
        
        let finalInstructions = task.instructions;
        if (taskType.template) {
          const variables = task.variables || {};
          const validation = validateTemplateVariables(taskType.template, variables);
          if (!validation.valid) {
            throw new Error(
              `Task ${i}: Missing required template variables: ${validation.missing.join(', ')}`
            );
          }
          finalInstructions = replaceTemplateVariables(taskType.template, variables);
        }

        processedTasks.push({
          projectId,
          typeId: task.typeId,
          instructions: finalInstructions,
          variables: task.variables,
        });
      } catch (error: any) {
        errors.push(`Task ${i}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Bulk task creation failed:\n${errors.join('\n')}`);
    }

    return this.storage.createTasksBulk(projectId, processedTasks);
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    return this.storage.getTask(taskId);
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return this.storage.updateTask(taskId, input);
  }

  /**
   * List tasks for a project with optional filters
   */
  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    return this.storage.listTasks(projectId, filters);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === 'running') {
      throw new Error(`Cannot delete task ${taskId}: task is currently running`);
    }

    return this.storage.deleteTask(taskId);
  }

  /**
   * Get task history and attempts
   */
  async getTaskHistory(taskId: string): Promise<Task[]> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return this.storage.getTaskHistory(taskId);
  }

  /**
   * Get batch status by batch ID
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    return this.storage.getBatchStatus(batchId);
  }

  /**
   * Get the next available task for an agent (used by AgentService)
   */
  async getNextTaskForAgent(projectId: string, agentName: string): Promise<Task | null> {
    // Clean up expired leases before assigning new tasks
    await this.leaseService.cleanupExpiredLeases(projectId);
    
    // This delegates to the storage provider's atomic assignTask operation
    return this.storage.assignTask(projectId, agentName);
  }

  /**
   * Find duplicate tasks based on task type's duplicate handling
   */
  async findDuplicateTask(
    projectId: string, 
    typeId: string, 
    variables?: Record<string, string>
  ): Promise<Task | null> {
    return this.storage.findDuplicateTask(projectId, typeId, variables);
  }

  /**
   * Validate that a task exists and get it
   */
  async validateTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }

  /**
   * Validate that a task belongs to a specific agent
   */
  async validateTaskAssignment(taskId: string, agentName: string): Promise<Task> {
    const task = await this.validateTask(taskId);
    
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not currently running`);
    }

    if (task.assignedTo !== agentName) {
      throw new Error(`Task ${taskId} is not assigned to agent ${agentName}`);
    }

    return task;
  }

  /**
   * Extend a task lease (for agents that need more time)
   */
  async extendTaskLease(taskId: string, extensionMinutes: number): Promise<void> {
    return this.leaseService.extendTaskLease(taskId, extensionMinutes);
  }

  /**
   * Get lease statistics for a project
   */
  async getLeaseStats(projectId: string): Promise<{
    totalRunningTasks: number;
    expiredTasks: number;
    tasksByStatus: Record<string, number>;
  }> {
    return this.leaseService.getLeaseStats(projectId);
  }

  /**
   * Manually trigger lease cleanup for a project
   */
  async cleanupExpiredLeases(projectId: string): Promise<{
    reclaimedTasks: number;
    cleanedAgents: number;
  }> {
    return this.leaseService.cleanupExpiredLeases(projectId);
  }
}