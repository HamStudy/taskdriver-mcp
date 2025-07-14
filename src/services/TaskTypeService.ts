import { 
  TaskType, 
  TaskTypeCreateInput, 
  TaskTypeUpdateInput 
} from '../types/index.js';
import { StorageProvider } from '../storage/index.js';
import { validate, createTaskTypeSchema, extractVariablesFromTemplate, validateTemplateVariables } from '../utils/validation.js';
import { ProjectService } from './ProjectService.js';

/**
 * Service for managing task types
 */
export class TaskTypeService {
  constructor(
    private storage: StorageProvider,
    private projectService: ProjectService
  ) {}

  /**
   * Create a new task type
   */
  async createTaskType(input: TaskTypeCreateInput): Promise<TaskType> {
    const validatedInput = validate(createTaskTypeSchema, input);

    // Validate project exists and is active
    const project = await this.projectService.validateProjectAccess(validatedInput.projectId);

    // Auto-detect variables from template if not provided
    let variables = validatedInput.variables;
    if (!variables) {
      variables = extractVariablesFromTemplate(validatedInput.template);
    } else {
      // Validate that provided variables match template variables
      const validation = validateTemplateVariables(validatedInput.template, variables);
      if (!validation.isValid) {
        throw new Error(`Template variables validation failed. Missing variables: ${validation.missingVariables.join(', ')}. Extra variables: ${validation.extraVariables.join(', ')}`);
      }
    }

    // Apply project defaults if not specified
    const taskTypeInput: TaskTypeCreateInput = {
      ...validatedInput,
      variables,
      maxRetries: validatedInput.maxRetries ?? project.config.defaultMaxRetries,
      leaseDurationMinutes: validatedInput.leaseDurationMinutes ?? project.config.defaultLeaseDurationMinutes,
    };

    // Check for duplicate task type names within the project
    const existingTaskTypes = await this.storage.listTaskTypes(validatedInput.projectId);
    const duplicate = existingTaskTypes.find(tt => tt.name === validatedInput.name);
    if (duplicate) {
      throw new Error(`Task type with name '${validatedInput.name}' already exists in project`);
    }

    return this.storage.createTaskType(taskTypeInput);
  }

  /**
   * Get a task type by ID
   */
  async getTaskType(typeId: string): Promise<TaskType | null> {
    return this.storage.getTaskType(typeId);
  }

  /**
   * Update a task type
   */
  async updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType> {
    const taskType = await this.storage.getTaskType(typeId);
    if (!taskType) {
      throw new Error(`Task type ${typeId} not found`);
    }

    // Validate project is still active
    await this.projectService.validateProjectAccess(taskType.projectId);

    // Check for duplicate names if name is being changed
    if (input.name && input.name !== taskType.name) {
      const existingTaskTypes = await this.storage.listTaskTypes(taskType.projectId);
      const duplicate = existingTaskTypes.find(tt => tt.name === input.name && tt.id !== typeId);
      if (duplicate) {
        throw new Error(`Task type with name '${input.name}' already exists in project`);
      }
    }

    return this.storage.updateTaskType(typeId, input);
  }

  /**
   * List task types for a project
   */
  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);

    return this.storage.listTaskTypes(projectId);
  }

  /**
   * Delete a task type
   */
  async deleteTaskType(typeId: string): Promise<void> {
    const taskType = await this.storage.getTaskType(typeId);
    if (!taskType) {
      throw new Error(`Task type ${typeId} not found`);
    }

    // Check if there are any tasks using this type
    const tasks = await this.storage.listTasks(taskType.projectId, { typeId });
    if (tasks.length > 0) {
      throw new Error(`Cannot delete task type ${typeId}: ${tasks.length} tasks are using this type`);
    }

    return this.storage.deleteTaskType(typeId);
  }

  /**
   * Validate that a task type exists and belongs to the specified project
   */
  async validateTaskType(typeId: string, projectId: string): Promise<TaskType> {
    const taskType = await this.storage.getTaskType(typeId);
    if (!taskType) {
      throw new Error(`Task type ${typeId} not found`);
    }

    if (taskType.projectId !== projectId) {
      throw new Error(`Task type ${typeId} does not belong to project ${projectId}`);
    }

    return taskType;
  }
}