/**
 * Task Type Management Commands
 */

import { CommandDefinition } from '../types.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId 
} from '../utils.js';

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
  }
] as const;

export const createTaskType: CommandDefinition<typeof createTaskTypeParams> = {
  name: 'createTaskType',
  mcpName: 'create_task_type',
  cliName: 'create-task-type',
  description: 'Create a reusable task template/type with variables for generating multiple similar tasks. Use this when you need to repeat the same type of work with different inputs (e.g., "Analyze {{document}} for {{purpose}}"). Essential for batch processing and workflow automation.',
  parameters: createTaskTypeParams,
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
      data: {
        id: taskType.id,
        name: taskType.name,
        projectId: taskType.projectId,
        template: taskType.template,
        variables: taskType.variables,
        duplicateHandling: taskType.duplicateHandling,
        maxRetries: taskType.maxRetries,
        leaseDurationMinutes: taskType.leaseDurationMinutes,
        createdAt: taskType.createdAt
      },
      message: 'Task type created successfully'
    };
  }
};

// List Task Types Command
const listTaskTypesParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const listTaskTypes: CommandDefinition<typeof listTaskTypesParams> = {
  name: 'listTaskTypes',
  mcpName: 'list_task_types',
  cliName: 'list-task-types',
  description: 'List all task templates/types in a project. Use this to see what task templates are available, find existing templates before creating new ones, or understand the types of work that can be automated in this project.',
  parameters: listTaskTypesParams,
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

    const taskTypes = await context.taskType.listTaskTypes(project.id);

    return {
      success: true,
      data: taskTypes.map(tt => ({
        id: tt.id,
        name: tt.name,
        projectId: tt.projectId,
        template: tt.template,
        variables: tt.variables,
        duplicateHandling: tt.duplicateHandling,
        maxRetries: tt.maxRetries,
        leaseDurationMinutes: tt.leaseDurationMinutes,
        createdAt: tt.createdAt
      }))
    };
  }
};

// Get Task Type Command
const getTaskTypeParams = [
  {
    name: 'taskTypeId',
    type: 'string',
    description: 'Task type ID',
    required: true,
    positional: true
  }
] as const;

export const getTaskType: CommandDefinition<typeof getTaskTypeParams> = {
  name: 'getTaskType',
  mcpName: 'get_task_type',
  cliName: 'get-task-type',
  description: 'Get detailed information about a specific task template/type including its template structure, variables, and configuration. Use this to understand how to create tasks from this template or verify template settings.',
  parameters: getTaskTypeParams,
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
      data: {
        id: taskType.id,
        name: taskType.name,
        projectId: taskType.projectId,
        template: taskType.template,
        variables: taskType.variables,
        duplicateHandling: taskType.duplicateHandling,
        maxRetries: taskType.maxRetries,
        leaseDurationMinutes: taskType.leaseDurationMinutes,
        createdAt: taskType.createdAt,
        updatedAt: taskType.updatedAt
      }
    };
  }
};