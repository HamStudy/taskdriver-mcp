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
 * Format time as relative (e.g., "2 hours ago", "3 days ago")
 */
function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  } else {
    return `${seconds} sec${seconds > 1 ? 's' : ''} ago`;
  }
}

/**
 * Strip ANSI color codes to get visual width
 */
function getVisualWidth(text: string): number {
  // Remove ANSI escape sequences
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

/**
 * Pad text to width, accounting for ANSI color codes
 */
function padEndVisual(text: string, width: number): string {
  const visualWidth = getVisualWidth(text);
  const padding = Math.max(0, width - visualWidth);
  return text + ' '.repeat(padding);
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
      text: chalk.red(`❌ Error: ${result.error || 'Command failed'}`),
      exitCode: 1
    };
  }

  // Success case - format based on command type
  let output = '';
  
  if (result.message) {
    output += chalk.green(`✅ ${result.message}`) + '\n';
  }

  // For successful results, check for data property first, then fall back to result itself
  const dataToFormat = result.data || result;
  if (dataToFormat && typeof dataToFormat === 'object') {
    output += formatData(dataToFormat, commandName);
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
  // Handle specific data properties first
  if (data.project) {
    // Single project result - add success message for create-project
    let output = '';
    if (commandName.includes('create-project')) {
      output += chalk.green('✅ Project created successfully') + '\n';
    }
    output += formatProject(data.project);
    return output;
  }

  if (data.projects) {
    // Project list result
    if (data.projects.length === 0) {
      return chalk.gray('No projects found');
    }
    return `Found ${data.projects.length} projects` + '\n' + formatProjectList(data.projects, data.pagination);
  }

  if (data.tasks) {
    // Task list result  
    if (data.tasks.length === 0) {
      return chalk.gray('No tasks found');
    }
    return `Found ${data.tasks.length} tasks` + '\n' + formatTaskList(data.tasks, data.pagination);
  }

  if (data.taskTypes) {
    // Task type list result  
    if (data.taskTypes.length === 0) {
      return chalk.gray('No task types found');
    }
    return `Found ${data.taskTypes.length} task types` + '\n' + formatTaskTypeList(data.taskTypes, data.pagination);
  }

  if (data.status && (data.timestamp || data.storage || commandName.includes('health'))) {
    // Health check result - more specific detection
    return formatHealthCheck(data);
  }

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
  output += `${chalk.gray('Status:')} ${project.status === 'active' ? chalk.green(project.status.toUpperCase()) : chalk.yellow(project.status.toUpperCase())}\n`;
  output += `${chalk.gray('Description:')} ${project.description || 'No description'}\n`;
  output += `${chalk.gray('Created:')} ${new Date(project.createdAt).toLocaleString()}\n`;

  if (project.instructions) {
    output += `\n${chalk.bold('Instructions:')}\n${project.instructions}\n`;
  }

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
  return (colors[status] || chalk.gray)(status.toUpperCase());
}

/**
 * Format project list
 */
function formatProjectList(projects: any[], pagination?: any): string {
  let output = `\n${chalk.bold('Projects:')} (${projects.length})\n`;
  
  // Add pagination info if provided
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} projects`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  // Calculate dynamic column widths based on actual data
  const names = projects.map(p => p.name);
  const statuses = projects.map(p => p.status.toUpperCase());
  const taskCounts = projects.map(p => p.stats ? `${p.stats.totalTasks}` : '0');
  const descriptions = projects.map(p => p.description || 'No description');
  
  const nameWidth = Math.max(...names.map(n => n.length), 'NAME'.length);
  const statusWidth = Math.max(...statuses.map(s => s.length), 'STATUS'.length);
  const tasksWidth = Math.max(...taskCounts.map(t => t.length), 'TASKS'.length);
  const descriptionWidth = Math.max(...descriptions.map(d => d.length), 'DESCRIPTION'.length);
  
  // Header
  output += chalk.bold(
    'NAME'.padEnd(nameWidth) + ' | ' +
    'STATUS'.padEnd(statusWidth) + ' | ' +
    'TASKS'.padEnd(tasksWidth) + ' | ' +
    'DESCRIPTION'.padEnd(descriptionWidth)
  ) + '\n';
  output += chalk.gray('-'.repeat(nameWidth + 3 + statusWidth + 3 + tasksWidth + 3 + descriptionWidth)) + '\n';
  
  for (const project of projects) {
    const status = project.status === 'active' ? chalk.green('ACTIVE') : chalk.yellow(project.status.toUpperCase());
    const tasks = project.stats ? `${project.stats.totalTasks}` : '0';
    const description = project.description || 'No description';
    
    output += project.name.padEnd(nameWidth) + ' | ' +
              padEndVisual(status, statusWidth) + ' | ' +
              tasks.padEnd(tasksWidth) + ' | ' +
              description.padEnd(descriptionWidth) + '\n';
  }
  
  // Add page info at the end if pagination exists and has a meaningful limit
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
  }
  
  return output;
}

/**
 * Format task list
 */
function formatTaskList(tasks: any[], pagination?: any): string {
  let output = `\n${chalk.bold('Tasks:')} (${tasks.length})\n`;
  
  // Add pagination info if provided
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} tasks`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  // Calculate dynamic column widths based on actual data
  const taskIds = tasks.map(t => t.id.substring(0, 10));
  const typeNames = tasks.map(t => t.typeName || t.typeId || '-');
  const assignedTos = tasks.map(t => t.assignedTo || '-');
  const createdTimes = tasks.map(t => formatRelativeTime(t.createdAt));
  
  const taskIdWidth = Math.max(...taskIds.map(id => id.length), 'TASK ID'.length);
  const typeWidth = Math.max(...typeNames.map(type => type.length), 'TYPE'.length);
  // Calculate status width based on actual status values (without chalk formatting)
  const statusValues = ['queued', 'running', 'completed', 'failed'];
  const statusWidth = Math.max(...statusValues.map(s => s.toUpperCase().length), 'STATUS'.length);
  const assignedWidth = Math.max(...assignedTos.map(a => a.length), 'ASSIGNED TO'.length);
  const createdWidth = Math.max(...createdTimes.map(c => c.length), 'CREATED'.length);
  
  // Header
  output += chalk.bold(
    'TASK ID'.padEnd(taskIdWidth) + ' | ' +
    'TYPE'.padEnd(typeWidth) + ' | ' +
    'STATUS'.padEnd(statusWidth) + ' | ' +
    'ASSIGNED TO'.padEnd(assignedWidth) + ' | ' +
    'CREATED'.padEnd(createdWidth)
  ) + '\n';
  output += chalk.gray('-'.repeat(taskIdWidth + 3 + typeWidth + 3 + statusWidth + 3 + assignedWidth + 3 + createdWidth)) + '\n';
  
  for (const task of tasks) {
    const taskId = task.id.substring(0, 10); 
    const taskType = task.typeName || task.typeId || '-';
    const status = formatTaskStatus(task.status);
    const assignedTo = task.assignedTo || '-';
    const created = formatRelativeTime(task.createdAt);
    
    output += taskId.padEnd(taskIdWidth) + ' | ' +
              taskType.padEnd(typeWidth) + ' | ' +
              padEndVisual(status, statusWidth) + ' | ' +
              assignedTo.padEnd(assignedWidth) + ' | ' +
              created.padEnd(createdWidth) + '\n';
  }
  
  // Add page info at the end if pagination exists and has a meaningful limit
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
  }
  
  return output;
}

/**
 * Format task type list
 */
function formatTaskTypeList(taskTypes: any[], pagination?: any): string {
  let output = `\n${chalk.bold('Task Types:')} (${taskTypes.length})\n`;
  
  // Add pagination info if provided
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} task types`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  // Calculate dynamic column widths based on actual data
  const names = taskTypes.map(tt => tt.name);
  const templates = taskTypes.map(tt => tt.template ? 'Yes' : 'No');
  const variables = taskTypes.map(tt => tt.variables ? tt.variables.join(', ') : '-');
  const duplicateHandlings = taskTypes.map(tt => tt.duplicateHandling || 'allow');
  
  const nameWidth = Math.max(...names.map(n => n.length), 'NAME'.length);
  const templateWidth = Math.max(...templates.map(t => t.length), 'TEMPLATE'.length);
  const variablesWidth = Math.max(...variables.map(v => v.length), 'VARIABLES'.length);
  const duplicateWidth = Math.max(...duplicateHandlings.map(d => d.length), 'DUPLICATE HANDLING'.length);
  
  // Header
  output += chalk.bold(
    'NAME'.padEnd(nameWidth) + ' | ' +
    'TEMPLATE'.padEnd(templateWidth) + ' | ' +
    'VARIABLES'.padEnd(variablesWidth) + ' | ' +
    'DUPLICATE HANDLING'.padEnd(duplicateWidth)
  ) + '\n';
  output += chalk.gray('-'.repeat(nameWidth + 3 + templateWidth + 3 + variablesWidth + 3 + duplicateWidth)) + '\n';
  
  for (const taskType of taskTypes) {
    const hasTemplate = taskType.template ? chalk.green('Yes') : chalk.gray('No');
    const vars = taskType.variables ? taskType.variables.join(', ') : '-';
    const duplicateHandling = taskType.duplicateHandling || 'allow';
    
    output += taskType.name.padEnd(nameWidth) + ' | ' +
              padEndVisual(hasTemplate, templateWidth) + ' | ' +
              vars.padEnd(variablesWidth) + ' | ' +
              duplicateHandling.padEnd(duplicateWidth) + '\n';
  }
  
  // Add page info at the end if pagination exists and has a meaningful limit
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
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
    'LAST SEEN'
  ) + '\n';
  output += chalk.gray('-'.repeat(maxNameWidth + 30)) + '\n';
  
  for (const agent of agents) {
    const status = agent.status === 'idle' ? chalk.green(agent.status) : 
                   agent.status === 'working' ? chalk.blue(agent.status) :
                   chalk.gray(agent.status);
    const lastSeen = agent.lastSeen ? new Date(agent.lastSeen).toLocaleDateString() : 'Never';
    
    output += agent.name.padEnd(maxNameWidth) + ' | ' +
              status.padEnd(10) + ' | ' +
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
  
  if (data.timestamp) {
    output += `${chalk.gray('Timestamp:')} ${new Date(data.timestamp).toLocaleString()}\n`;
  }

  if (data.storage) {
    output += `\n${chalk.bold('Storage:')}\n`;
    // Handle both storage.healthy boolean and storage.status string formats
    const isHealthy = data.storage.healthy === true || data.storage.status === 'healthy';
    const storageStatus = isHealthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy');
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