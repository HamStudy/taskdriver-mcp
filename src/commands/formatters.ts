/**
 * Output formatters for CLI commands
 * Supports both human-readable and JSON formats
 */

import chalk from 'chalk';

export type OutputFormat = 'human' | 'json';

export interface FormattedOutput {
  text: string;
  exitCode: number;
}

/**
 * Format command result for display
 */
export function formatCommandResult(
  result: any, 
  commandName: string, 
  format: OutputFormat = 'human'
): FormattedOutput {
  if (format === 'json') {
    return {
      text: JSON.stringify(result, null, 2),
      exitCode: result.success ? 0 : 1
    };
  }

  // Human-readable format
  if (!result.success) {
    return {
      text: chalk.red(`❌ ${result.error || 'Command failed'}`),
      exitCode: 1
    };
  }

  // Success case - format based on command type
  let output = '';
  
  if (result.message) {
    output += chalk.green(`✅ ${result.message}`) + '\n';
  }

  if (result.data) {
    output += formatData(result.data, commandName);
  }

  return {
    text: output.trim(),
    exitCode: 0
  };
}

/**
 * Format data based on command type
 */
function formatData(data: any, commandName: string): string {
  // Handle array data (lists)
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return chalk.gray('No items found');
    }
    
    if (commandName.includes('list-projects')) {
      return formatProjectList(data);
    } else if (commandName.includes('list-tasks')) {
      return formatTaskList(data);
    } else if (commandName.includes('list-task-types')) {
      return formatTaskTypeList(data);
    } else if (commandName.includes('list-agents')) {
      return formatAgentList(data);
    } else {
      return formatGenericList(data);
    }
  }

  // Handle single object data
  if (commandName.includes('stats')) {
    return formatStats(data);
  } else if (commandName.includes('health-check')) {
    return formatHealthCheck(data);
  } else if (commandName.includes('get-project') || commandName.includes('create-project')) {
    return formatProject(data);
  } else if (commandName.includes('get-task') || commandName.includes('create-task')) {
    return formatTask(data);
  } else if (commandName.includes('get-task-type') || commandName.includes('create-task-type')) {
    return formatTaskType(data);
  } else if (commandName.includes('register-agent')) {
    return formatAgent(data);
  } else {
    return formatGenericObject(data);
  }
}

/**
 * Format project data
 */
function formatProject(project: any): string {
  let output = `\n${chalk.bold.blue(project.name)} (${project.id})\n`;
  output += `${chalk.gray('Status:')} ${project.status === 'active' ? chalk.green(project.status) : chalk.yellow(project.status)}\n`;
  output += `${chalk.gray('Description:')} ${project.description || 'No description'}\n`;
  output += `${chalk.gray('Created:')} ${new Date(project.createdAt).toLocaleString()}\n`;

  if (project.config) {
    output += `\n${chalk.bold('Configuration:')}\n`;
    output += `  Max Retries: ${project.config.defaultMaxRetries}\n`;
    output += `  Lease Duration: ${project.config.defaultLeaseDurationMinutes} minutes\n`;
    output += `  Reaper Interval: ${project.config.reaperIntervalMinutes} minutes\n`;
  }

  if (project.stats) {
    output += `\n${chalk.bold('Statistics:')}\n`;
    output += `  Total Tasks: ${project.stats.totalTasks}\n`;
    output += `  Completed: ${chalk.green(project.stats.completedTasks)}\n`;
    output += `  Failed: ${chalk.red(project.stats.failedTasks)}\n`;
    output += `  Queued: ${chalk.yellow(project.stats.queuedTasks)}\n`;
    output += `  Running: ${chalk.blue(project.stats.runningTasks)}\n`;
  }

  return output;
}

/**
 * Format task data
 */
function formatTask(task: any): string {
  let output = `\n${chalk.bold('Task:')} ${task.id}\n`;
  output += `${chalk.gray('Status:')} ${formatTaskStatus(task.status)}\n`;
  output += `${chalk.gray('Type ID:')} ${task.typeId}\n`;
  output += `${chalk.gray('Created:')} ${new Date(task.createdAt).toLocaleString()}\n`;

  if (task.assignedTo) {
    output += `${chalk.gray('Assigned to:')} ${task.assignedTo}\n`;
    output += `${chalk.gray('Assigned at:')} ${new Date(task.assignedAt).toLocaleString()}\n`;
  }

  if (task.retryCount !== undefined) {
    output += `${chalk.gray('Retry count:')} ${task.retryCount}/${task.maxRetries || '?'}\n`;
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

/**
 * Format task status with colors
 */
function formatTaskStatus(status: string): string {
  const colors: Record<string, any> = {
    queued: chalk.yellow,
    running: chalk.blue,
    completed: chalk.green,
    failed: chalk.red
  };
  return (colors[status] || chalk.gray)(status);
}

/**
 * Format project list
 */
function formatProjectList(projects: any[]): string {
  let output = `\n${chalk.bold('Projects:')} (${projects.length})\n\n`;
  
  const maxNameWidth = Math.max(...projects.map(p => p.name.length), 8);
  
  // Header
  output += chalk.bold(
    'NAME'.padEnd(maxNameWidth) + ' | ' +
    'STATUS'.padEnd(8) + ' | ' +
    'TASKS'.padEnd(8) + ' | ' +
    'DESCRIPTION'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 8 + 8 + 30)) + '\n';
  
  for (const project of projects) {
    const status = project.status === 'active' ? chalk.green('active') : chalk.yellow(project.status);
    const tasks = project.stats ? `${project.stats.totalTasks}` : '0';
    const description = (project.description || 'No description').substring(0, 40);
    
    output += project.name.padEnd(maxNameWidth) + ' | ' +
              status.padEnd(8) + ' | ' +
              tasks.padEnd(8) + ' | ' +
              description + '\n';
  }
  
  return output;
}

/**
 * Format task list
 */
function formatTaskList(tasks: any[]): string {
  let output = `\n${chalk.bold('Tasks:')} (${tasks.length})\n\n`;
  
  // Header
  output += chalk.bold(
    'TASK ID'.padEnd(12) + ' | ' +
    'STATUS'.padEnd(12) + ' | ' +
    'ASSIGNED TO'.padEnd(15) + ' | ' +
    'CREATED'
  ) + '\n';
  output += chalk.gray('-'.repeat(70)) + '\n';
  
  for (const task of tasks) {
    const taskId = task.id.substring(0, 10) + '..';
    const status = formatTaskStatus(task.status);
    const assignedTo = (task.assignedTo || '-').substring(0, 13);
    const created = new Date(task.createdAt).toLocaleDateString();
    
    output += taskId.padEnd(12) + ' | ' +
              status.padEnd(12) + ' | ' +
              assignedTo.padEnd(15) + ' | ' +
              created + '\n';
  }
  
  return output;
}

/**
 * Format task type list
 */
function formatTaskTypeList(taskTypes: any[]): string {
  let output = `\n${chalk.bold('Task Types:')} (${taskTypes.length})\n\n`;
  
  const maxNameWidth = Math.max(...taskTypes.map(tt => tt.name.length), 8);
  
  // Header
  output += chalk.bold(
    'NAME'.padEnd(maxNameWidth) + ' | ' +
    'TEMPLATE'.padEnd(10) + ' | ' +
    'VARIABLES'.padEnd(15) + ' | ' +
    'DUPLICATE HANDLING'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 50)) + '\n';
  
  for (const taskType of taskTypes) {
    const hasTemplate = taskType.template ? chalk.green('Yes') : chalk.gray('No');
    const variables = taskType.variables ? taskType.variables.join(', ').substring(0, 13) : '-';
    const duplicateHandling = taskType.duplicateHandling || 'allow';
    
    output += taskType.name.padEnd(maxNameWidth) + ' | ' +
              hasTemplate.padEnd(10) + ' | ' +
              variables.padEnd(15) + ' | ' +
              duplicateHandling + '\n';
  }
  
  return output;
}

/**
 * Format agent list
 */
function formatAgentList(agents: any[]): string {
  let output = `\n${chalk.bold('Agents:')} (${agents.length})\n\n`;
  
  const maxNameWidth = Math.max(...agents.map(a => a.name.length), 8);
  
  // Header
  output += chalk.bold(
    'NAME'.padEnd(maxNameWidth) + ' | ' +
    'STATUS'.padEnd(10) + ' | ' +
    'CAPABILITIES'.padEnd(20) + ' | ' +
    'LAST SEEN'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 50)) + '\n';
  
  for (const agent of agents) {
    const status = agent.status === 'idle' ? chalk.green(agent.status) : 
                   agent.status === 'working' ? chalk.blue(agent.status) :
                   chalk.gray(agent.status);
    const capabilities = agent.capabilities ? agent.capabilities.join(', ').substring(0, 18) : '-';
    const lastSeen = agent.lastSeen ? new Date(agent.lastSeen).toLocaleDateString() : 'Never';
    
    output += agent.name.padEnd(maxNameWidth) + ' | ' +
              status.padEnd(10) + ' | ' +
              capabilities.padEnd(20) + ' | ' +
              lastSeen + '\n';
  }
  
  return output;
}

/**
 * Format task type data
 */
function formatTaskType(taskType: any): string {
  let output = `\n${chalk.bold('Task Type:')} ${taskType.name}\n`;
  output += `${chalk.gray('ID:')} ${taskType.id}\n`;
  output += `${chalk.gray('Project ID:')} ${taskType.projectId}\n`;
  output += `${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}\n`;
  output += `${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}\n`;

  if (taskType.maxRetries !== undefined) {
    output += `${chalk.gray('Max Retries:')} ${taskType.maxRetries}\n`;
  }

  if (taskType.leaseDurationMinutes !== undefined) {
    output += `${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes\n`;
  }

  if (taskType.variables && taskType.variables.length > 0) {
    output += `\n${chalk.bold('Variables:')}\n`;
    for (const variable of taskType.variables) {
      output += `  • ${variable}\n`;
    }
  }

  if (taskType.template) {
    output += `\n${chalk.bold('Template:')}\n${taskType.template}\n`;
  }

  return output;
}

/**
 * Format agent data
 */
function formatAgent(agent: any): string {
  let output = `\n${chalk.bold('Agent:')} ${agent.name}\n`;
  output += `${chalk.gray('ID:')} ${agent.id}\n`;
  output += `${chalk.gray('Status:')} ${agent.status === 'idle' ? chalk.green(agent.status) : chalk.blue(agent.status)}\n`;
  output += `${chalk.gray('Created:')} ${new Date(agent.createdAt).toLocaleString()}\n`;

  if (agent.capabilities && agent.capabilities.length > 0) {
    output += `\n${chalk.bold('Capabilities:')}\n`;
    for (const capability of agent.capabilities) {
      output += `  • ${capability}\n`;
    }
  }

  if (agent.apiKey) {
    output += `\n${chalk.bold.yellow('API Key:')} ${agent.apiKey}\n`;
    output += chalk.yellow('⚠️  Store this API key securely - it will not be shown again!\n');
  }

  return output;
}

/**
 * Format health check data
 */
function formatHealthCheck(data: any): string {
  const statusColor = data.status === 'healthy' ? chalk.green : chalk.red;
  let output = `\n${chalk.bold('System Status:')} ${statusColor(data.status.toUpperCase())}\n`;
  output += `${chalk.gray('Timestamp:')} ${new Date(data.timestamp).toLocaleString()}\n`;

  if (data.storage) {
    output += `\n${chalk.bold('Storage:')}\n`;
    const storageStatus = data.storage.healthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy');
    output += `  Status: ${storageStatus}\n`;
    if (data.storage.message) {
      output += `  Message: ${data.storage.message}\n`;
    }
  }

  return output;
}

/**
 * Format statistics data
 */
function formatStats(data: any): string {
  let output = `\n${chalk.bold('Statistics for Project:')} ${data.projectName || 'Unknown'}\n`;
  
  if (data.stats) {
    const stats = data.stats;
    
    if (stats.totalRunningTasks !== undefined) {
      // Lease stats
      output += `\n${chalk.bold('Lease Statistics:')}\n`;
      output += `  Running Tasks: ${chalk.blue(stats.totalRunningTasks)}\n`;
      output += `  Expired Tasks: ${chalk.red(stats.expiredTasks)}\n`;
      
      if (stats.tasksByStatus) {
        output += `\n${chalk.bold('Tasks by Status:')}\n`;
        for (const [status, count] of Object.entries(stats.tasksByStatus)) {
          output += `  ${status}: ${count}\n`;
        }
      }
    } else if (stats.project && stats.project.stats) {
      // New format with nested project stats
      const projectStats = stats.project.stats;
      output += `\n${chalk.bold('Project Statistics:')}\n`;
      output += `  Total Tasks: ${projectStats.totalTasks || 0}\n`;
      output += `  Completed: ${chalk.green(projectStats.completedTasks || 0)}\n`;
      output += `  Failed: ${chalk.red(projectStats.failedTasks || 0)}\n`;
      output += `  Queued: ${chalk.yellow(projectStats.queuedTasks || 0)}\n`;
      output += `  Running: ${chalk.blue(projectStats.runningTasks || 0)}\n`;
      
      output += `\n${chalk.bold('System Statistics:')}\n`;
      output += `  Queue Depth: ${stats.queueDepth || 0}\n`;
      output += `  Active Agents: ${stats.activeAgents || 0}\n`;
      
      if (stats.recentActivity) {
        output += `\n${chalk.bold('Recent Activity:')}\n`;
        output += `  Tasks Completed (Last Hour): ${stats.recentActivity.tasksCompletedLastHour || 0}\n`;
        output += `  Tasks Failed (Last Hour): ${stats.recentActivity.tasksFailedLastHour || 0}\n`;
        output += `  Average Task Duration: ${stats.recentActivity.averageTaskDuration || 0}ms\n`;
      }
    } else {
      // Legacy format - project stats directly
      output += `\n${chalk.bold('Project Statistics:')}\n`;
      output += `  Total Tasks: ${stats.totalTasks || 0}\n`;
      output += `  Completed: ${chalk.green(stats.completedTasks || 0)}\n`;
      output += `  Failed: ${chalk.red(stats.failedTasks || 0)}\n`;
      output += `  Queued: ${chalk.yellow(stats.queuedTasks || 0)}\n`;
      output += `  Running: ${chalk.blue(stats.runningTasks || 0)}\n`;
    }
  }

  return output;
}

/**
 * Format generic list
 */
function formatGenericList(items: any[]): string {
  return `\nFound ${items.length} items:\n` + 
         items.map((item, i) => `${i + 1}. ${JSON.stringify(item)}`).join('\n');
}

/**
 * Format generic object
 */
function formatGenericObject(obj: any): string {
  return JSON.stringify(obj, null, 2);
}