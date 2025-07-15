/**
 * Agent Management Commands
 * 
 * Note: Agents are now ephemeral queue workers, not persistent entities.
 * Most traditional "agent management" is unnecessary - agents just get tasks from the queue.
 */

import { CommandDefinition } from '../types.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId,
  parseJsonSafely 
} from '../utils.js';

// Get Next Task Command (replaces the old assign_task)
const getNextTaskParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name (optional - will be auto-generated if not provided)',
    required: false,
    positional: true
  }
] as const;

export const getNextTask: CommandDefinition<typeof getNextTaskParams> = {
  name: 'getNextTask',
  mcpName: 'get_next_task',
  cliName: 'get-next-task',
  description: 'Get the next available task from the project queue. If agentName is provided and has an existing task lease, that task is resumed. Otherwise assigns a new task. Agent names are only used for reconnection after disconnects.',
  parameters: getNextTaskParams,
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

    const result = await context.agent.getNextTask(project.id, args.agentName);

    if (!result.task) {
      return {
        success: false,
        data: {
          task: null,
          agentName: result.agentName
        },
        error: 'No tasks available for assignment'
      };
    }

    // Get full instructions for the assigned task
    const instructions = await context.task.getTaskInstructions(result.task.id);

    return {
      success: true,
      data: {
        task: {
          id: result.task.id,
          projectId: result.task.projectId,
          typeId: result.task.typeId,
          instructions: instructions,
          assignedTo: result.task.assignedTo,
          assignedAt: result.task.assignedAt,
          leaseExpiresAt: result.task.leaseExpiresAt,
          variables: result.task.variables,
          retryCount: result.task.retryCount
        },
        agentName: result.agentName
      },
      message: 'Task assigned successfully'
    };
  }
};

// List Active Agents Command (for monitoring - shows agents with active leases)
const listActiveAgentsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const listActiveAgents: CommandDefinition<typeof listActiveAgentsParams> = {
  name: 'listActiveAgents',
  mcpName: 'list_active_agents',
  cliName: 'list-active-agents',
  description: 'List agents currently working on tasks (agents with active task leases). This is for monitoring purposes - agents are ephemeral and only appear here when actively working.',
  parameters: listActiveAgentsParams,
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

    const agents = await context.agent.listActiveAgents(project.id);

    return {
      success: true,
      data: agents.map(a => ({
        name: a.name,
        projectId: a.projectId,
        status: a.status,
        currentTaskId: a.currentTaskId,
        assignedAt: a.assignedAt,
        leaseExpiresAt: a.leaseExpiresAt
      }))
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
  description: 'Mark a task as completed with results and optional structured outputs. This releases the task lease and makes the agent available for new work.',
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
      output: resultContent,
      metadata: outputs
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
  description: 'Mark a task as failed with error details and retry options. This releases the task lease and either requeues the task for retry or marks it permanently failed.',
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

// Extend Lease Command (for long-running tasks)
const extendLeaseParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name',
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
    name: 'minutes',
    type: 'number',
    description: 'Additional minutes to extend the lease',
    required: true,
    positional: true
  }
] as const;

export const extendLease: CommandDefinition<typeof extendLeaseParams> = {
  name: 'extendLease',
  mcpName: 'extend_task_lease',
  cliName: 'extend-lease',
  description: 'Extend the lease on a running task by additional minutes. Use this for long-running operations to prevent the task from being reassigned to other agents.',
  parameters: extendLeaseParams,
  async handler(context, args) {
    await context.agent.extendTaskLease(args.taskId, args.agentName, args.minutes);

    // Get the updated task to return the new lease expiry
    const updatedTask = await context.task.getTask(args.taskId);

    return {
      success: true,
      data: {
        taskId: args.taskId,
        agentName: args.agentName,
        leaseExpiresAt: updatedTask?.leaseExpiresAt,
        extendedBy: args.minutes
      },
      message: `Task lease extended by ${args.minutes} minutes`
    };
  }
};

// Peek Next Task Command (for scripting - check if tasks available without assigning)
const peekNextTaskParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const peekNextTask: CommandDefinition<typeof peekNextTaskParams> = {
  name: 'peekNextTask',
  mcpName: 'peek_next_task',
  cliName: 'peek-next-task',
  description: 'Check if tasks are available in the project queue without assigning them. Returns success if tasks are available, error if queue is empty. Perfect for bash scripts: "while peek-next-task project; do launch_agent; done"',
  parameters: peekNextTaskParams,
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

    // Check if any tasks are available (queued status)
    const tasks = await context.task.listTasks(project.id, { status: 'queued' });
    const availableCount = tasks.length;

    if (availableCount === 0) {
      return {
        success: false,
        data: {
          projectId: project.id,
          tasksAvailable: 0
        },
        error: 'No tasks available in queue'
      };
    }

    return {
      success: true,
      data: {
        projectId: project.id,
        tasksAvailable: availableCount
      },
      message: `${availableCount} task${availableCount === 1 ? '' : 's'} available in queue`
    };
  }
};