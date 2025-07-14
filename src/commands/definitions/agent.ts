/**
 * Agent Management Commands
 */

import { CommandDefinition } from '../types.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId,
  parseJsonSafely 
} from '../utils.js';

// Register Agent Command
const registerAgentParams = [
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
    description: 'Agent name',
    required: true,
    positional: true
  },
  {
    name: 'capabilities',
    type: 'array',
    description: 'Agent capabilities (space-separated)',
    alias: ['caps', 'c'],
    default: []
  }
] as const;

export const registerAgent: CommandDefinition<typeof registerAgentParams> = {
  name: 'registerAgent',
  mcpName: 'register_agent',
  cliName: 'register-agent',
  description: 'Register a new agent',
  parameters: registerAgentParams,
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

    const result = await context.agent.registerAgent({
      projectId: project.id,
      name: args.name,
      capabilities: args.capabilities
    });

    return {
      success: true,
      data: {
        id: result.agent.id,
        name: result.agent.name,
        projectId: result.agent.projectId,
        capabilities: result.agent.capabilities,
        status: result.agent.status,
        createdAt: result.agent.createdAt,
        apiKey: result.apiKey
      },
      message: 'Agent registered successfully'
    };
  }
};

// List Agents Command
const listAgentsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const listAgents: CommandDefinition<typeof listAgentsParams> = {
  name: 'listAgents',
  mcpName: 'list_agents',
  cliName: 'list-agents',
  description: 'List agents for a project',
  parameters: listAgentsParams,
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

    const agents = await context.agent.listAgents(project.id);

    return {
      success: true,
      data: agents.map(a => ({
        id: a.id,
        name: a.name,
        projectId: a.projectId,
        capabilities: a.capabilities,
        status: a.status,
        lastSeen: a.lastSeen,
        createdAt: a.createdAt
      }))
    };
  }
};

// Assign Task (Get Next Task) Command
const assignTaskParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name',
    required: true,
    positional: true
  },
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'capabilities',
    type: 'array',
    description: 'Agent capabilities (space-separated)',
    alias: ['caps', 'c'],
    default: []
  }
] as const;

export const assignTask: CommandDefinition<typeof assignTaskParams> = {
  name: 'assignTask',
  mcpName: 'assign_task',
  cliName: 'get-next-task',
  description: 'Get next task for agent (assign task)',
  parameters: assignTaskParams,
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

    const task = await context.agent.getNextTask(args.agentName, project.id);

    if (!task) {
      return {
        success: true,
        data: null,
        message: 'No tasks available for assignment'
      };
    }

    // Get full instructions for the assigned task
    const instructions = await context.task.getTaskInstructions(task.id);

    return {
      success: true,
      data: {
        task: {
          id: task.id,
          projectId: task.projectId,
          typeId: task.typeId,
          instructions: instructions,
          assignedTo: task.assignedTo,
          assignedAt: task.assignedAt,
          leaseExpiresAt: task.leaseExpiresAt,
          variables: task.variables,
          retryCount: task.retryCount
        }
      },
      message: 'Task assigned successfully'
    };
  }
};

// Complete Task Command
const completeTaskParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name',
    required: true,
    positional: true
  },
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'taskId',
    type: 'string',
    description: 'Task ID',
    required: true,
    positional: true
  },
  {
    name: 'result',
    type: 'string',
    description: 'Task result (or @path/to/file.txt)',
    required: true,
    positional: true
  },
  {
    name: 'outputs',
    type: 'string',
    description: 'Structured outputs as JSON string',
    alias: 'o'
  }
] as const;

export const completeTask: CommandDefinition<typeof completeTaskParams> = {
  name: 'completeTask',
  mcpName: 'complete_task',
  cliName: 'complete-task',
  description: 'Complete a task',
  parameters: completeTaskParams,
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

    const resultContent = readContentFromFileOrValue(args.result);
    let outputs;
    if (args.outputs) {
      outputs = parseJsonSafely(args.outputs, 'outputs JSON');
    }

    const taskResult = {
      success: true,
      result: resultContent,
      outputs
    };

    await context.agent.completeTask(args.agentName, project.id, args.taskId, taskResult);

    // Get the updated task to return its status
    const updatedTask = await context.task.getTask(args.taskId);

    return {
      success: true,
      data: {
        id: args.taskId,
        status: updatedTask?.status,
        result: resultContent,
        outputs
      },
      message: 'Task completed successfully'
    };
  }
};

// Fail Task Command
const failTaskParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name',
    required: true,
    positional: true
  },
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'taskId',
    type: 'string',
    description: 'Task ID',
    required: true,
    positional: true
  },
  {
    name: 'error',
    type: 'string',
    description: 'Error message',
    required: true,
    positional: true
  },
  {
    name: 'canRetry',
    type: 'boolean',
    description: 'Whether the task can be retried',
    alias: ['can-retry', 'r'],
    default: true
  }
] as const;

export const failTask: CommandDefinition<typeof failTaskParams> = {
  name: 'failTask',
  mcpName: 'fail_task',
  cliName: 'fail-task',
  description: 'Fail a task',
  parameters: failTaskParams,
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

    const taskResult = {
      success: false,
      error: args.error
    };

    await context.agent.failTask(args.agentName, project.id, args.taskId, taskResult, args.canRetry);

    // Get the updated task to return its status
    const updatedTask = await context.task.getTask(args.taskId);

    return {
      success: true,
      data: {
        id: args.taskId,
        status: updatedTask?.status,
        error: args.error,
        retryCount: updatedTask?.retryCount,
        canRetry: args.canRetry
      },
      message: 'Task marked as failed'
    };
  }
};