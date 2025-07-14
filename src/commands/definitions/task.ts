/**
 * Task Management Commands
 */

import { CommandDefinition } from '../types.js';
import { 
  findProjectByNameOrId, 
  findTaskTypeByNameOrId,
  parseJsonSafely 
} from '../utils.js';

// Create Task Command
const createTaskParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'typeId',
    type: 'string',
    description: 'Task type ID or name',
    alias: ['type', 't']
  },
  {
    name: 'instructions',
    type: 'string',
    description: 'Task instructions (required for non-template tasks)',
    alias: 'i'
  },
  {
    name: 'id',
    type: 'string',
    description: 'Custom task ID'
  },
  {
    name: 'description',
    type: 'string',
    description: 'Human-readable task description',
    alias: 'd'
  },
  {
    name: 'variables',
    type: 'string',
    description: 'Variables as JSON string for template tasks',
    alias: ['vars']
  }
] as const;

export const createTask: CommandDefinition<typeof createTaskParams> = {
  name: 'createTask',
  mcpName: 'create_task',
  cliName: 'create-task',
  description: 'Create a new task',
  parameters: createTaskParams,
  async handler(context, args) {
    // Find project
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    // Get task types for the project
    const taskTypes = await context.taskType.listTaskTypes(project.id);
    if (taskTypes.length === 0) {
      return {
        success: false,
        error: `No task types found in project '${project.name}'. Create a task type first.`
      };
    }

    // Find task type or use first available
    let taskType;
    if (args.typeId) {
      taskType = findTaskTypeByNameOrId(taskTypes, args.typeId);
      if (!taskType) {
        return {
          success: false,
          error: `Task type '${args.typeId}' not found in project '${project.name}'`
        };
      }
    } else {
      taskType = taskTypes[0];
    }

    // Handle template vs non-template tasks
    let finalInstructions = '';
    let variables;
    
    if (taskType.template) {
      // Template task - parse variables
      if (args.variables) {
        variables = parseJsonSafely(args.variables, 'variables JSON');
      }
    } else {
      // Non-template task - require instructions
      if (!args.instructions) {
        return {
          success: false,
          error: 'Instructions are required when using task type without template'
        };
      }
      finalInstructions = args.instructions;
      if (args.variables) {
        variables = parseJsonSafely(args.variables, 'variables JSON');
      }
    }

    const task = await context.task.createTask({
      projectId: project.id,
      typeId: taskType.id,
      id: args.id,
      description: args.description,
      instructions: finalInstructions,
      variables
    });

    return {
      success: true,
      data: {
        id: task.id,
        projectId: task.projectId,
        typeId: task.typeId,
        instructions: task.instructions,
        status: task.status,
        createdAt: task.createdAt,
        variables: task.variables
      },
      message: 'Task created successfully'
    };
  }
};

// Create Tasks Bulk Command
const createTasksBulkParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'tasks',
    type: 'string', // Use string for CLI (will be JSON), array will be handled differently for MCP
    description: 'JSON string or file path with array of task objects (use @file.json to read from file)',
    required: true,
    positional: true
  }
] as const;

export const createTasksBulk: CommandDefinition<typeof createTasksBulkParams> = {
  name: 'createTasksBulk',
  mcpName: 'create_tasks_bulk',
  cliName: 'create-tasks-bulk',
  description: 'Create multiple tasks from JSON array',
  parameters: createTasksBulkParams,
  async handler(context, args) {
    // Find project
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    // Handle tasks input
    let tasks;
    if (typeof args.tasks === 'string') {
      // For CLI: either direct JSON string or already read from file by CLI handler
      tasks = parseJsonSafely(args.tasks, 'tasks JSON');
    } else if (Array.isArray(args.tasks)) {
      // For MCP: direct array
      tasks = args.tasks;
    } else {
      return {
        success: false,
        error: 'Tasks must be a JSON string or array'
      };
    }

    if (!Array.isArray(tasks)) {
      return {
        success: false,
        error: 'Tasks must be an array'
      };
    }

    const result = await context.task.createTasksBulk(project.id, tasks);

    return {
      success: true,
      data: {
        tasksCreated: result.tasksCreated,
        errors: result.errors,
        createdTasks: result.createdTasks.map(t => ({
          id: t.id,
          typeId: t.typeId,
          status: t.status,
          createdAt: t.createdAt
        }))
      },
      message: `Bulk task creation completed: ${result.tasksCreated} created, ${result.errors.length} errors`
    };
  }
};

// List Tasks Command
const listTasksParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'status',
    type: 'string',
    description: 'Filter by task status',
    choices: ['queued', 'running', 'completed', 'failed'],
    alias: 's'
  },
  {
    name: 'typeId',
    type: 'string',
    description: 'Filter by task type ID',
    alias: ['type-id', 't']
  },
  {
    name: 'assignedTo',
    type: 'string',
    description: 'Filter by assigned agent',
    alias: ['assigned-to', 'a']
  },
  {
    name: 'limit',
    type: 'number',
    description: 'Maximum number of tasks to return',
    alias: 'l',
    default: 50
  },
  {
    name: 'offset',
    type: 'number',
    description: 'Number of tasks to skip',
    alias: 'o',
    default: 0
  }
] as const;

export const listTasks: CommandDefinition<typeof listTasksParams> = {
  name: 'listTasks',
  mcpName: 'list_tasks',
  cliName: 'list-tasks',
  description: 'List tasks for a project',
  parameters: listTasksParams,
  async handler(context, args) {
    // Find project
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    const filters = {
      status: args.status,
      typeId: args.typeId,
      assignedTo: args.assignedTo,
      limit: args.limit,
      offset: args.offset
    };

    const tasks = await context.task.listTasks(project.id, filters);

    return {
      success: true,
      data: tasks.map(t => ({
        id: t.id,
        typeId: t.typeId,
        status: t.status,
        assignedTo: t.assignedTo,
        retryCount: t.retryCount,
        createdAt: t.createdAt
      }))
    };
  }
};

// Get Task Command
const getTaskParams = [
  {
    name: 'taskId',
    type: 'string',
    description: 'Task ID',
    required: true,
    positional: true
  }
] as const;

export const getTask: CommandDefinition<typeof getTaskParams> = {
  name: 'getTask',
  mcpName: 'get_task',
  cliName: 'get-task',
  description: 'Get task details',
  parameters: getTaskParams,
  async handler(context, args) {
    const task = await context.task.getTask(args.taskId);
    if (!task) {
      return {
        success: false,
        error: `Task '${args.taskId}' not found`
      };
    }

    // Get full instructions (interpolated from template if needed)
    const instructions = await context.task.getTaskInstructions(args.taskId);

    return {
      success: true,
      data: {
        id: task.id,
        projectId: task.projectId,
        typeId: task.typeId,
        instructions: instructions,
        status: task.status,
        assignedTo: task.assignedTo,
        createdAt: task.createdAt,
        assignedAt: task.assignedAt,
        completedAt: task.completedAt,
        variables: task.variables,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        leaseExpiresAt: task.leaseExpiresAt,
        result: task.result
      }
    };
  }
};