/**
 * Agent Management Commands
 * 
 * Note: Agents are now ephemeral queue workers, not persistent entities.
 * Most traditional "agent management" is unnecessary - agents just get tasks from the queue.
 */

import chalk from 'chalk';
import { CommandParameter, defineCommand, TaskTypes } from '../types.js';
import { Task } from '../../types/Task.js';
import { AgentStatus } from '../../types/Agent.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId,
  parseJsonSafely 
} from '../utils.js';

// Formatting helper functions

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

function formatTask(task: Task): string {
  let output = `\n${chalk.bold('Task:')} ${task.id}\n`;
  output += `${chalk.gray('Status:')} ${formatTaskStatus(task.status)}\n`;
  output += `${chalk.gray('Type ID:')} ${task.typeId}\n`;
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

function formatAgentList(agents: AgentStatus[]): string {
  let output = `\n${chalk.bold('Agents:')} (${agents.length})\n\n`;
  
  const maxNameWidth = Math.max(...agents.map(a => a.name.length), 8);
  
  output += chalk.bold(
    'NAME'.padEnd(maxNameWidth) + ' | ' +
    'STATUS'.padEnd(10) + ' | ' +
    'LAST SEEN'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 30)) + '\n';
  
  for (const agent of agents) {
    const status = agent.status === 'idle' ? chalk.green(agent.status) : 
                   agent.status === 'working' ? chalk.blue(agent.status) :
                   chalk.gray(agent.status);
    const lastSeen = agent.assignedAt ? agent.assignedAt.toLocaleDateString() : 'Never';
    
    output += agent.name.padEnd(maxNameWidth) + ' | ' +
              status.padEnd(10) + ' | ' +
              lastSeen + '\n';
  }
  
  return output;
}

function formatTaskCompletion(data: { taskId: string; agentName: string; result: string; outputs?: any }): string {
  let output = `\n${chalk.bold('Task Completed:')}\n`;
  output += `${chalk.gray('Task ID:')} ${data.taskId}\n`;
  output += `${chalk.gray('Agent:')} ${data.agentName}\n`;
  if (data.result) {
    output += `\n${chalk.bold('Result:')}\n${data.result}\n`;
  }
  if (data.outputs) {
    output += `\n${chalk.bold('Outputs:')}\n${JSON.stringify(data.outputs, null, 2)}\n`;
  }
  return output;
}

function formatTaskFailure(data: { taskId: string; agentName: string; error: string; willRetry: boolean; retryCount?: number }): string {
  let output = `\n${chalk.bold('Task Failed:')}\n`;
  output += `${chalk.gray('Task ID:')} ${data.taskId}\n`;
  output += `${chalk.gray('Agent:')} ${data.agentName}\n`;
  if (data.error) {
    output += `\n${chalk.bold('Error:')}\n${chalk.red(data.error)}\n`;
  }
  if (data.willRetry) {
    output += `\n${chalk.yellow('Task will be retried automatically.')}\n`;
  }
  return output;
}

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
] as const satisfies CommandParameter[];

export const getNextTask = defineCommand({
  name: 'getNextTask',
  mcpName: 'get_next_task',
  cliName: 'get-next-task',
  description: 'Get the next available task from the project queue. If agentName is provided and has an existing task lease, that task is resumed. Otherwise assigns a new task. Agent names are only used for reconnection after disconnects.\n\n⚠️ IMPORTANT: Always call get_project first to obtain project instructions and context that agents need to understand their role and objectives. The list_projects tool only shows basic project information - you need get_project for complete instructions.',
  parameters: getNextTaskParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const task = result.data;
    if (!task) {
      return `\n${chalk.yellow('No tasks available')}\n`;
    }
    return formatTask(task);
  },
  discoverability: {
    triggerKeywords: ['get', 'next', 'task', 'assign', 'work', 'queue', 'pull', 'fetch', 'receive'],
    userIntentPatterns: ['I need work to do', 'Get me the next task', 'What should I work on next', 'Pull from task queue'],
    useWhen: ['Agent is ready to work on tasks', 'Need to resume interrupted work', 'Starting work session'],
    typicalPredecessors: ['get_project', 'create_task', 'create_tasks_bulk', 'complete_task', 'fail_task'],
    typicalSuccessors: ['complete_task', 'fail_task', 'extend_task_lease'],
    workflowPatterns: ['agent-work-loop', 'task-processing-workflow'],
    prerequisites: ['Project exists with queued tasks', 'Agent ready to work', 'Project instructions obtained via get_project'],
    expectedOutcomes: ['Task with full instructions', 'Task lease for exclusive access', 'Agent name for reconnection'],
    errorGuidance: ['Check if project has available tasks', 'Verify project exists', 'Call get_project first to understand project instructions'],
    antiPatterns: ['Getting tasks without calling get_project first', 'Getting tasks without ability to work on them', 'Multiple agents using same name simultaneously']
  },
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
        data: null,
        agentName: result.agentName,
        error: 'No tasks available for assignment'
      };
    }

    // Get full instructions for the assigned task
    const instructions = await context.task.getTaskInstructions(result.task.id);

    // Return the task with populated instructions as data, agentName as CommandResult field
    const taskWithInstructions = {
      ...result.task,
      instructions
    };

    return {
      success: true,
      data: taskWithInstructions,
      agentName: result.agentName,
      message: 'Task assigned successfully'
    };
  }
});

// List Active Agents Command (for monitoring - shows agents with active leases)
const listActiveAgentsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export type GetNextTaskTypes = TaskTypes<typeof getNextTask>;

export const listActiveAgents = defineCommand({
  name: 'listActiveAgents',
  mcpName: 'list_active_agents',
  cliName: 'list-active-agents',
  description: 'List agents currently working on tasks (agents with active task leases). This is for monitoring purposes - agents are ephemeral and only appear here when actively working.',
  parameters: listActiveAgentsParams,
  returnDataType: 'list',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const agents = result.data || [];
    return formatAgentList(agents);
  },
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
      data: agents
    };
  }
});

export type ListActiveAgentsTypes = TaskTypes<typeof listActiveAgents>;

// Complete Task Command
const completeTaskParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name (from get_next_task response)',
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
    description: 'Task result (or @path/to/file.txt to read from file)',
    required: true,
    positional: true
  },
  {
    name: 'outputs',
    type: 'string',
    description: 'Optional structured outputs as JSON string',
    alias: 'o'
  }
] as const satisfies CommandParameter[];

export const completeTask = defineCommand({
  name: 'completeTask',
  mcpName: 'complete_task',
  cliName: 'complete-task',
  description: 'Mark a task as completed with results and optional structured outputs. This releases the task lease and makes the agent available for new work.',
  parameters: completeTaskParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatTaskCompletion(result.data!);
  },
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

    // Get the updated task to return its status with populated instructions
    const updatedTask = await context.task.getTask(args.taskId);
    if (!updatedTask) {
      return {
        success: false,
        error: `Task ${args.taskId} not found after completion`
      };
    }

    const instructions = await context.task.getTaskInstructions(args.taskId);
    const taskWithInstructions = {
      ...updatedTask,
      instructions
    };

    return {
      success: true,
      data: taskWithInstructions,
      agentName: args.agentName,
      message: 'Task completed successfully'
    };
  }
});

export type CompleteTaskTypes = TaskTypes<typeof completeTask>;

// Fail Task Command
const failTaskParams = [
  {
    name: 'agentName',
    type: 'string',
    description: 'Agent name (from get_next_task response)',
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
    description: 'Error message describing why the task failed',
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
] as const satisfies CommandParameter[];

export const failTask = defineCommand({
  name: 'failTask',
  mcpName: 'fail_task',
  cliName: 'fail-task',
  description: 'Mark a task as failed with error details and retry options. This releases the task lease and either requeues the task for retry or marks it permanently failed.',
  parameters: failTaskParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatTaskFailure(result.data!);
  },
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

    // Get the updated task to return its status with populated instructions
    const updatedTask = await context.task.getTask(args.taskId);
    if (!updatedTask) {
      return {
        success: false,
        error: `Task ${args.taskId} not found after failure`
      };
    }

    const instructions = await context.task.getTaskInstructions(args.taskId);
    const taskWithInstructions = {
      ...updatedTask,
      instructions
    };

    return {
      success: true,
      data: taskWithInstructions,
      agentName: args.agentName,
      message: 'Task marked as failed'
    };
  }
});

export type FailTaskTypes = TaskTypes<typeof failTask>;

// Extend Lease Command (for long-running tasks)
const extendLeaseParams = [
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
] as const satisfies CommandParameter[];

export const extendLease = defineCommand({
  name: 'extendLease',
  mcpName: 'extend_lease',
  cliName: 'extend-lease',
  description: 'Extend the lease on a running task by additional minutes. Use this for long-running operations to prevent the task from being reassigned to other agents.',
  parameters: extendLeaseParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const task = result.data;
    return `\n${chalk.bold('Lease Extended:')}\n${chalk.gray('Task ID:')} ${task?.id || 'Unknown'}\n${chalk.gray('New Expires At:')} ${task?.leaseExpiresAt || 'Unknown'}\n`;
  },
  async handler(context, args) {
    await context.lease.extendTaskLease(args.taskId, args.minutes);

    // Get updated task to return with populated instructions
    const updatedTask = await context.task.getTask(args.taskId);
    if (!updatedTask) {
      return {
        success: false,
        error: `Task ${args.taskId} not found after lease extension`
      };
    }

    const instructions = await context.task.getTaskInstructions(args.taskId);
    const taskWithInstructions = {
      ...updatedTask,
      instructions
    };

    return {
      success: true,
      data: taskWithInstructions,
      message: `Task lease extended by ${args.minutes} minutes`
    };
  }
});

export type ExtendLeaseTypes = TaskTypes<typeof extendLease>;

// Peek Next Task Command (for scripting - check if tasks available without assigning)
const peekNextTaskParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const peekNextTask = defineCommand({
  name: 'peekNextTask',
  mcpName: 'peek_next_task',
  cliName: 'peek-next-task',
  description: 'Check if tasks are available in the project queue without assigning them. Returns success if tasks are available, error if queue is empty. Perfect for bash scripts: "while peek-next-task project; do launch_agent; done"',
  parameters: peekNextTaskParams,
  returnDataType: 'generic',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return `\n${chalk.bold('Queue Status:')}\n${chalk.gray('Available Tasks:')} ${result.data?.availableTasks || 0}\n`;
  },
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
          availableTasks: 0
        },
        error: 'No tasks available in queue'
      };
    }

    return {
      success: true,
      data: {
        projectId: project.id,
        availableTasks: availableCount
      },
      message: `${availableCount} task${availableCount === 1 ? '' : 's'} available in queue`
    };
  }
});

export type PeekNextTaskTypes = TaskTypes<typeof peekNextTask>;