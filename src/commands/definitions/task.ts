/**
 * Task Management Commands
 */

import chalk from '../../utils/chalk.js';
import { CommandParameter, CommandResult, defineCommand, TaskTypes } from '../types.js';
import { Task } from '../../types/Task.js';
import { 
  parseJsonSafely 
} from '../utils.js';

// Task formatting helpers

/**
 * Formats the time difference between two dates.
 * @param start The start date.
 * @param end The end date.
 * @returns A string representing the time difference.
 */
export function formatTimeDifference(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();

  const seconds = Math.abs(Math.floor(diffMs / 1000));
  const onlySeconds = seconds % 60;
  const minutes = Math.floor(seconds / 60);
  const onlyMinutes = minutes % 60;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (hours > 48) {
    return `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 24) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ${onlyMinutes} min`;
  } else if (minutes > 10) {
    return `${minutes} min${minutes > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} min ${onlySeconds} sec`;
  } else {
    return `${seconds} sec`;
  }
}

export function formatRelativeTime(date: Date | undefined): string {
  if (!date) return 'unknown';

  const now = new Date();
  const then = new Date(date);
  const suffix = then > now ? 'from now' : 'ago';
  return `${formatTimeDifference(then, now)} ${suffix}`;
}

function formatLeaseStatus(task: Task): string {
  const now = new Date();
  
  if (task.status === 'completed') {
    return `done ${formatRelativeTime(task.completedAt || task.updatedAt)}`;
  } else if (task.status === 'failed') {
    return `failed ${formatRelativeTime(task.failedAt || task.updatedAt)}`;
  } else if (task.status === 'queued') {
    return `created ${formatRelativeTime(task.createdAt)}`;
  } else if (task.status === 'running' && task.leaseExpiresAt) {
    const leaseExpiry = new Date(task.leaseExpiresAt);
    const diffMs = leaseExpiry.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return chalk.red('<lease expired>');
    }
    
    const timeLeft = formatTimeDifference(now, leaseExpiry);
    
    return `running until ${timeLeft}`;
  } else {
    return `created ${formatRelativeTime(task.createdAt)}`;
  }
}

function getVisualWidth(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function padEndVisual(text: string, width: number): string {
  const visualWidth = getVisualWidth(text);
  const padding = Math.max(0, width - visualWidth);
  return text + ' '.repeat(padding);
}

function formatTaskStatus(status: string): string {
  if (!status) {
    return chalk.gray('UNKNOWN');
  }
  const colors: Record<string, (text: string) => string> = {
    queued: chalk.yellow,
    running: chalk.blue,
    completed: chalk.green,
    failed: chalk.red
  };
  return (colors[status] || chalk.gray)(status.toUpperCase());
}

function formatTask(task: Task & { typeName?: string }): string {
  let output = `\n${chalk.bold('Task:')} ${task.id}\n`;
  output += `${chalk.gray('Status:')} ${formatTaskStatus(task.status)}\n`;
  output += `${chalk.gray('Type ID:')} ${task.typeId}\n`;
  if (task.typeName) {
    output += `${chalk.gray('Type Name:')} ${task.typeName}\n`;
  }
  output += `${chalk.gray('Created:')} ${task.createdAt.toLocaleString()}\n`;

  if (task.assignedTo) {
    output += `${chalk.gray('Assigned to:')} ${task.assignedTo}\n`;
    output += `${chalk.gray('Assigned at:')} ${task.assignedAt?.toLocaleString()}\n`;
  }

  if (task.retryCount !== undefined) {
    output += `${chalk.gray('Retry count:')} ${task.retryCount}/${task.maxRetries || '?'}\n`;
  }

  if (task.description) {
    output += `\n${chalk.bold('Description:')}\n${task.description}\n`;
  }

  if (task.variables && Object.keys(task.variables).length > 0) {
    output += `\n${chalk.bold('Variables:')}\n`;
    for (const [key, value] of Object.entries(task.variables)) {
      output += `  ${key}: ${value}\n`;
    }
  }

  if (task.instructions) {
    output += `\n${chalk.bold('Instructions:')}\n${task.instructions}\n`;
  }

  return output;
}

function formatTaskList(tasks: (Task & { typeName?: string })[], pagination?: any): string {
  let output = `\n${chalk.bold('Tasks:')} (${tasks.length})\n`;
  
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} tasks`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  const taskIds = tasks.map(t => t.id.substring(0, 10));
  const typeNames = tasks.map(t => t.typeName || t.typeId || '-');
  const assignedTos = tasks.map(t => t.assignedTo || '-');
  const statusTimes = tasks.map(t => formatLeaseStatus(t));
  
  const taskIdWidth = Math.max(...taskIds.map(id => id.length), 'TASK ID'.length);
  const typeWidth = Math.max(...typeNames.map(type => type.length), 'TYPE'.length);
  const statusValues = ['queued', 'running', 'completed', 'failed'];
  const statusWidth = Math.max(...statusValues.map(s => s.toUpperCase().length), 'STATUS'.length);
  const assignedWidth = Math.max(...assignedTos.map(a => a.length), 'ASSIGNED TO'.length);
  const statusTimeWidth = Math.max(...statusTimes.map(st => getVisualWidth(st)), 'STATUS'.length);
  
  output += chalk.bold(
    'TASK ID'.padEnd(taskIdWidth) + ' | ' +
    'TYPE'.padEnd(typeWidth) + ' | ' +
    'STATUS'.padEnd(statusWidth) + ' | ' +
    'ASSIGNED TO'.padEnd(assignedWidth) + ' | ' +
    'STATUS'.padEnd(statusTimeWidth)
  ) + '\n';
  output += chalk.gray('-'.repeat(taskIdWidth + 3 + typeWidth + 3 + statusWidth + 3 + assignedWidth + 3 + statusTimeWidth)) + '\n';
  
  for (const task of tasks) {
    const taskId = task.id.substring(0, 10); 
    const taskType = task.typeName || task.typeId || '-';
    const status = formatTaskStatus(task.status);
    const assignedTo = task.assignedTo || '-';
    const statusTime = formatLeaseStatus(task);
    
    output += taskId.padEnd(taskIdWidth) + ' | ' +
              taskType.padEnd(typeWidth) + ' | ' +
              padEndVisual(status, statusWidth) + ' | ' +
              assignedTo.padEnd(assignedWidth) + ' | ' +
              padEndVisual(statusTime, statusTimeWidth) + '\n';
  }
  
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
  }
  
  return output;
}

function formatBulkCreateResults(data: any): string {
  let output = `\n${chalk.bold('Bulk Task Creation Results:')}\n`;
  output += `${chalk.gray('Total Created:')} ${chalk.green(data.totalCreated || 0)}\n`;
  output += `${chalk.gray('Total Skipped:')} ${chalk.yellow(data.totalSkipped || 0)}\n`;
  output += `${chalk.gray('Total Failed:')} ${chalk.red(data.totalFailed || 0)}\n`;
  
  if (data.tasks && data.tasks.length > 0) {
    output += `\n${chalk.bold('Created Tasks:')}\n`;
    for (const task of data.tasks.slice(0, 10)) {
      output += `  ${task.id} (${task.typeName || task.typeId})\n`;
    }
    if (data.tasks.length > 10) {
      output += `  ... and ${data.tasks.length - 10} more\n`;
    }
  }
  
  return output;
}

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
    name: 'type',
    type: 'string',
    description: 'Task type ID or name',
    alias: ['type-id', 't']
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
] as const satisfies CommandParameter[];

export const createTask = defineCommand({
  name: 'createTask',
  mcpName: 'create_task',
  cliName: 'create-task',
  description: 'Create a single work item/task for agents to execute. Use this for individual tasks, one-off work items, or when you need precise control over each task. For creating many similar tasks, consider using create_tasks_bulk with a task template instead.',
  parameters: createTaskParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const task = result.data;
    return formatTask(task!);
  },
  async handler(context, args) {
    // Find project
    const project = await context.storage.getProjectByNameOrId(args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    // Find task type or use first available
    let taskType;
    if (args.type) {
      taskType = await context.storage.getTaskTypeByNameOrId(project.id, args.type);
      if (!taskType) {
        return {
          success: false,
          error: `Task type '${args.type}' not found in project '${project.name}'`
        };
      }
    } else {
      // Get first available task type
      const taskTypes = await context.taskType.listTaskTypes(project.id);
      if (taskTypes.length === 0) {
        return {
          success: false,
          error: `No task types found in project '${project.name}'. Create a task type first.`
        };
      }
      taskType = taskTypes[0];
    }

    // TypeScript assertion: taskType is guaranteed to be defined here
    if (!taskType) {
      return {
        success: false,
        error: 'Task type is required but not found'
      };
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
      data: task,
      message: 'Task created successfully'
    } satisfies CommandResult<Task>;
  }
});

export type CreateTaskTypes = TaskTypes<typeof createTask>;

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
] as const satisfies CommandParameter[];

export const createTasksBulk = defineCommand({
  name: 'createTasksBulk',
  mcpName: 'create_tasks_bulk',
  cliName: 'create-tasks-bulk',
  description: 'Create many tasks at once from a JSON array - ideal for batch processing, breaking down large work into many similar tasks, or processing lists of items. Use this when you have many similar tasks to create (e.g., processing multiple files, analyzing multiple documents, or repeating work across datasets).',
  parameters: createTasksBulkParams,
  returnDataType: 'generic',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatBulkCreateResults(result.data!);
  },
  async handler(context, args) {
    // Find project
    const project = await context.storage.getProjectByNameOrId(args.projectId);
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
      data: result,
      message: `Bulk task creation completed: ${result.tasksCreated} created, ${result.errors.length} errors`
    };
  }
});

export type CreateTasksBulkTypes = TaskTypes<typeof createTasksBulk>;

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
    choices: ['queued', 'running', 'completed', 'failed', 'all'],
    alias: 's'
  },
  {
    name: 'type',
    type: 'string',
    description: 'Filter by task type ID or name',
    alias: ['type-id', 't']
  },
  {
    name: 'assignedTo',
    type: 'string',
    description: 'Filter by assigned agent',
    alias: ['assigned-to', 'a']
  },
  {
    name: 'includeCompleted',
    type: 'boolean',
    description: 'Include completed tasks',
    alias: ['include-completed', 'c'],
    default: false
  },
  {
    name: 'limit',
    type: 'number',
    description: 'Maximum number of tasks to return (0 = no limit)',
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
] as const satisfies CommandParameter[];

export const listTasks = defineCommand({
  name: 'listTasks',
  mcpName: 'list_tasks',
  cliName: 'list-tasks',
  description: 'List and filter tasks in a project by status, type, or assigned agent. By default, excludes completed tasks to focus on active work - use status="all" or includeCompleted=true to see completed tasks. Essential for workflow monitoring and progress tracking.',
  parameters: listTasksParams,
  returnDataType: 'list',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const tasks = result.data || [];
    const pagination = result.pagination;
    return formatTaskList(tasks, pagination);
  },
  async handler(context, args) {
    // Validate limit parameter
    if (args.limit !== undefined && args.limit < 0) {
      return {
        success: false,
        error: `Limit must be 0 or greater, got: ${args.limit}`
      };
    }

    // Find project
    const project = await context.storage.getProjectByNameOrId(args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    // Handle status filtering with new logic
    const includeCompleted = args.status === 'all' || args.status === 'completed' || args.includeCompleted;
    
    const filters = {
      status: args.status === 'all' ? undefined : args.status,
      typeId: args.type, // Convert type to typeId for storage layer
      assignedTo: args.assignedTo,
      limit: args.limit,
      offset: args.offset
    };

    // Get ALL tasks matching the filters (without pagination) to get true total
    const allTasksFilters = {
      status: filters.status,
      typeId: filters.typeId, 
      assignedTo: filters.assignedTo
      // No limit/offset for total count
    };
    const allTasks = await context.task.listTasks(project.id, allTasksFilters);
    
    // Filter out completed tasks unless specifically requested
    const filteredTasks = includeCompleted ? allTasks : allTasks.filter(task => task.status !== 'completed');
    const totalCount = filteredTasks.length;
    
    // Apply pagination to get the current page (unless limit is 0)
    const offset = filters.offset || 0;
    const limit = filters.limit === 0 ? undefined : (filters.limit || 50);
    const pagedTasks = limit ? filteredTasks.slice(offset, offset + limit) : filteredTasks.slice(offset);
    
    // Populate instructions for each task from templates if needed
    const tasksWithInstructions = await Promise.all(
      pagedTasks.map(async (task) => {
        const instructions = await context.task.getTaskInstructions(task.id);
        return {
          ...task,
          instructions
        };
      })
    );

    // Create pagination object
    const pagination = {
      total: totalCount,
      offset: offset,
      limit: limit || totalCount,
      rangeStart: totalCount > 0 ? offset + 1 : 0,
      rangeEnd: offset + tasksWithInstructions.length,
      hasMore: (offset + tasksWithInstructions.length) < totalCount
    };

    return {
      success: true,
      data: tasksWithInstructions,
      pagination,
      message: `Found ${tasksWithInstructions.length} tasks (${totalCount} total)`
    } satisfies CommandResult<Task[]>;
  }
});

export type ListTasksTypes = TaskTypes<typeof listTasks>;

// Get Task Command
const getTaskParams = [
  {
    name: 'taskId',
    type: 'string',
    description: 'Task ID',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const getTask = defineCommand({
  name: 'getTask',
  mcpName: 'get_task',
  cliName: 'get-task',
  description: 'Get detailed information about a specific task including its status, instructions, variables, assignment info, and execution history. Use this to check task details, verify task configuration, or troubleshoot task issues.',
  parameters: getTaskParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const task = result.data;
    return formatTask(task!);
  },
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

    // Return the task with populated instructions
    const taskWithInstructions = {
      ...task,
      instructions
    };

    return {
      success: true,
      data: taskWithInstructions
    };
  }
});

export type GetTaskTypes = TaskTypes<typeof getTask>;