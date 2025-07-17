/**
 * Task Type Management Commands
 */

import chalk from '../../utils/chalk.js';
import { CommandParameter, defineCommand, TaskTypes } from '../types.js';
import { TaskType } from '../../types/TaskType.js';
import { 
  readContentFromFileOrValue 
} from '../utils.js';

// Task type interfaces

// Helper function for formatting task types list
function formatTaskTypesList(taskTypes: TaskType[], pagination?: any): string {
  let output = `\n${chalk.bold('Task Types:')} (${taskTypes.length})\n`;
  
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} task types`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  if (taskTypes.length === 0) {
    output += chalk.gray('No task types found.\n');
    return output;
  }
  
  const maxNameWidth = Math.max(...taskTypes.map((tt: TaskType) => tt.name.length), 'NAME'.length);
  const maxTemplateWidth = Math.min(50, Math.max(...taskTypes.map((tt: TaskType) => (tt.template || '').length), 'TEMPLATE'.length));
  
  output += chalk.bold(
    'NAME'.padEnd(maxNameWidth) + ' | ' +
    'TEMPLATE'.padEnd(maxTemplateWidth) + ' | ' +
    'VARIABLES'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 3 + maxTemplateWidth + 3 + 20)) + '\n';
  
  for (const taskType of taskTypes) {
    const template = taskType.template ? (taskType.template.length > 47 ? taskType.template.substring(0, 47) + '...' : taskType.template) : '-';
    const variables = taskType.variables && taskType.variables.length > 0 ? taskType.variables.join(', ') : '-';
    
    output += taskType.name.padEnd(maxNameWidth) + ' | ' +
              template.padEnd(maxTemplateWidth) + ' | ' +
              variables + '\n';
  }
  
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
  }
  
  return output;
}

// Helper function for formatting a single task type
function formatTaskType(taskType: TaskType): string {
  let output = `\n${chalk.bold('Task Type Details:')} ${taskType.name}\n`;
  output += `${chalk.gray('ID:')} ${taskType.id}\n`;
  output += `${chalk.gray('Project:')} ${taskType.projectId}\n`;
  if (taskType.template) {
    output += `\n${chalk.bold('Template:')}\n${taskType.template}\n`;
  }
  if (taskType.variables && taskType.variables.length > 0) {
    output += `\n${chalk.bold('Variables:')}\n`;
    for (const variable of taskType.variables) {
      output += `  ${variable}\n`;
    }
  }
  output += `\n${chalk.bold('Configuration:')}\n`;
  output += `${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}\n`;
  if (taskType.maxRetries !== undefined) {
    output += `${chalk.gray('Max Retries:')} ${taskType.maxRetries}\n`;
  }
  if (taskType.leaseDurationMinutes !== undefined) {
    output += `${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes\n`;
  }
  output += `${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}\n`;
  if (taskType.updatedAt) {
    output += `${chalk.gray('Updated:')} ${new Date(taskType.updatedAt).toLocaleString()}\n`;
  }
  return output;
}

// Create Task Type Command
const createTaskTypeParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'name',
    type: 'string',
    description: 'Task type name',
    required: true,
    positional: true
  },
  {
    name: 'template',
    type: 'string',
    description: 'Task template with variables like {{variable}} (or @path/to/file.txt)',
    alias: 't',
    default: ''
  },
  {
    name: 'variables',
    type: 'array',
    description: 'Template variables (space-separated)',
    alias: ['vars', 'v'],
    default: []
  },
  {
    name: 'duplicateHandling',
    type: 'string',
    description: 'How to handle duplicate tasks',
    alias: ['duplicate-handling', 'd'],
    choices: ['allow', 'ignore', 'fail'],
    default: 'allow'
  },
  {
    name: 'maxRetries',
    type: 'number',
    description: 'Maximum retry attempts',
    alias: ['max-retries', 'r']
  },
  {
    name: 'leaseDurationMinutes',
    type: 'number',
    description: 'Lease duration in minutes',
    alias: ['lease-duration', 'l']
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full template in output (CLI only)',
    alias: 'v',
    default: false
  }
] as const satisfies CommandParameter[];

export const createTaskType = defineCommand({
  name: 'createTaskType',
  mcpName: 'create_task_type',
  cliName: 'create-task-type',
  description: 'Create a reusable task template/type with variables for generating multiple similar tasks. Use this when you need to repeat the same type of work with different inputs (e.g., "Analyze {{document}} for {{purpose}}"). Essential for batch processing and workflow automation.',
  parameters: createTaskTypeParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const taskType = result.data!;
    let output = `\n${chalk.bold('Task Type Created:')} ${taskType.name}\n`;
    output += `${chalk.gray('ID:')} ${taskType.id}\n`;
    output += `${chalk.gray('Project:')} ${taskType.projectId}\n`;
    if (taskType.template) {
      if (args.verbose) {
        output += `${chalk.gray('Template:')} ${taskType.template}\n`;
      } else {
        output += `${chalk.gray('Template:')} ${taskType.template.length} characters\n`;
      }
    }
    if (taskType.variables && taskType.variables.length > 0) {
      output += `${chalk.gray('Variables:')} ${taskType.variables.join(', ')}\n`;
    }
    output += `${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}\n`;
    if (taskType.maxRetries !== undefined) {
      output += `${chalk.gray('Max Retries:')} ${taskType.maxRetries}\n`;
    }
    if (taskType.leaseDurationMinutes !== undefined) {
      output += `${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes\n`;
    }
    output += `${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}\n`;
    return output;
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

    const template = args.template ? readContentFromFileOrValue(args.template) : args.template;
    
    const taskType = await context.taskType.createTaskType({
      projectId: project.id,
      name: args.name,
      template,
      ...(args.variables && args.variables.length > 0 && { variables: args.variables }),
      duplicateHandling: args.duplicateHandling,
      maxRetries: args.maxRetries,
      leaseDurationMinutes: args.leaseDurationMinutes
    });

    return {
      success: true,
      data: taskType,
      message: 'Task type created successfully'
    };
  }
});

export type CreateTaskTypeTypes = TaskTypes<typeof createTaskType>;

// List Task Types Command
const listTaskTypesParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'limit',
    type: 'number',
    description: 'Maximum number of task types to return',
    alias: 'l',
    default: 50
  },
  {
    name: 'offset',
    type: 'number',
    description: 'Number of task types to skip',
    alias: 'o',
    default: 0
  }
] as const satisfies CommandParameter[];

export const listTaskTypes = defineCommand({
  name: 'listTaskTypes',
  mcpName: 'list_task_types',
  cliName: 'list-task-types',
  description: 'List all task templates/types in a project. Use this to see what task templates are available, find existing templates before creating new ones, or understand the types of work that can be automated in this project.',
  parameters: listTaskTypesParams,
  returnDataType: 'list',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const taskTypes = result.data || [];
    return formatTaskTypesList(taskTypes);
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

    const allTaskTypes = await context.taskType.listTaskTypes(project.id);
    
    // Apply pagination
    const offset = args.offset || 0;
    const limit = args.limit || 50;
    const taskTypes = allTaskTypes.slice(offset, offset + limit);
    
    const totalCount = allTaskTypes.length;
    const rangeStart = totalCount > 0 ? offset + 1 : 0;
    const rangeEnd = offset + taskTypes.length;
    const hasMore = rangeEnd < totalCount;

    return {
      success: true,
      data: taskTypes,
      message: `Found ${taskTypes.length} task types`
    };
  }
});

export type ListTaskTypesTypes = TaskTypes<typeof listTaskTypes>;

// Get Task Type Command
const getTaskTypeParams = [
  {
    name: 'taskTypeId',
    type: 'string',
    description: 'Task type ID',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const getTaskType = defineCommand({
  name: 'getTaskType',
  mcpName: 'get_task_type',
  cliName: 'get-task-type',
  description: 'Get detailed information about a specific task template/type including its template structure, variables, and configuration. Use this to understand how to create tasks from this template or verify template settings.',
  parameters: getTaskTypeParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const taskType = result.data!;
    return formatTaskType(taskType);
  },
  async handler(context, args) {
    const taskType = await context.taskType.getTaskType(args.taskTypeId);
    if (!taskType) {
      return {
        success: false,
        error: `Task type '${args.taskTypeId}' not found`
      };
    }

    return {
      success: true,
      data: taskType
    };
  }
});

export type GetTaskTypeTypes = TaskTypes<typeof getTaskType>;

// Update Task Type Command
const updateTaskTypeParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'taskType',
    type: 'string',
    description: 'Task type ID or name to update',
    required: true,
    positional: true
  },
  {
    name: 'template',
    type: 'string',
    description: 'New task template with variables like {{variable}} (or @path/to/file.txt)',
    alias: 't'
  },
  {
    name: 'variables',
    type: 'array',
    description: 'New template variables (space-separated)',
    alias: ['vars', 'v']
  },
  {
    name: 'duplicateHandling',
    type: 'string',
    description: 'How to handle duplicate tasks',
    alias: ['duplicate-handling', 'd'],
    choices: ['allow', 'ignore', 'fail']
  },
  {
    name: 'maxRetries',
    type: 'number',
    description: 'Maximum retries for tasks of this type',
    alias: ['max-retries', 'r']
  },
  {
    name: 'leaseDurationMinutes',
    type: 'number',
    description: 'Lease duration in minutes',
    alias: ['lease-duration', 'l']
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full template in output (CLI only)',
    alias: 'verbose-flag',
    default: false
  }
] as const satisfies CommandParameter[];

export const updateTaskType = defineCommand({
  name: 'updateTaskType',
  mcpName: 'update_task_type',
  cliName: 'update-task-type',
  description: 'Update an existing task type template, variables, or configuration. Use this to modify task instructions, add/remove variables, change retry settings, or adjust lease duration for a task type.',
  parameters: updateTaskTypeParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const taskType = result.data!;
    let output = `\n${chalk.bold('Task Type Updated:')} ${taskType.name}\n`;
    output += `${chalk.gray('ID:')} ${taskType.id}\n`;
    output += `${chalk.gray('Project:')} ${taskType.projectId}\n`;
    if (taskType.template) {
      if (args.verbose) {
        output += `${chalk.gray('Template:')} ${taskType.template}\n`;
      } else {
        output += `${chalk.gray('Template:')} ${taskType.template.length} characters\n`;
      }
    }
    if (taskType.variables && taskType.variables.length > 0) {
      output += `${chalk.gray('Variables:')} ${taskType.variables.join(', ')}\n`;
    }
    output += `${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}\n`;
    if (taskType.maxRetries !== undefined) {
      output += `${chalk.gray('Max Retries:')} ${taskType.maxRetries}\n`;
    }
    if (taskType.leaseDurationMinutes !== undefined) {
      output += `${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes\n`;
    }
    output += `${chalk.gray('Updated:')} ${new Date(taskType.updatedAt!).toLocaleString()}\n`;
    return output;
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

    // Find task type by name or ID
    const taskTypes = await context.taskType.listTaskTypes(project.id);
    const taskType = taskTypes.find(tt => tt.id === args.taskType || tt.name === args.taskType);
    if (!taskType) {
      return {
        success: false,
        error: `Task type '${args.taskType}' not found in project '${project.name}'`
      };
    }

    // Build update object with only provided fields
    const updates: any = {};
    
    if (args.template !== undefined) {
      updates.template = readContentFromFileOrValue(args.template);
    }
    
    if (args.variables !== undefined) {
      updates.variables = args.variables;
    }
    
    if (args.duplicateHandling !== undefined) {
      updates.duplicateHandling = args.duplicateHandling;
    }
    
    if (args.maxRetries !== undefined) {
      updates.maxRetries = args.maxRetries;
    }
    
    if (args.leaseDurationMinutes !== undefined) {
      updates.leaseDurationMinutes = args.leaseDurationMinutes;
    }

    // Check if any updates were provided
    if (Object.keys(updates).length === 0) {
      return {
        success: false,
        error: 'No updates provided. Specify at least one field to update (template, variables, duplicateHandling, maxRetries, leaseDurationMinutes)'
      };
    }

    try {
      await context.taskType.updateTaskType(taskType.id, updates);
      
      // Get the updated task type
      const updatedTaskType = await context.taskType.getTaskType(taskType.id);
      
      if (!updatedTaskType) {
        return {
          success: false,
          error: 'Task type not found after update'
        };
      }
      
      return {
        success: true,
        data: updatedTaskType,
        message: `Task type '${updatedTaskType.name}' updated successfully`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to update task type: ${error.message}`
      };
    }
  }
});

export type UpdateTaskTypeTypes = TaskTypes<typeof updateTaskType>;