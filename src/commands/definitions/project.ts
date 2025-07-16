/**
 * Project Management Commands
 */

import chalk from 'chalk';
import { CommandParameter, defineCommand, TaskTypes } from '../types.js';
import { Project, ProjectStatus } from '../../types/Project.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId 
} from '../utils.js';

// Formatting helpers

function getVisualWidth(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length;
}

function padEndVisual(text: string, width: number): string {
  const visualWidth = getVisualWidth(text);
  const padding = Math.max(0, width - visualWidth);
  return text + ' '.repeat(padding);
}

function formatProject(project: Project, verbose: boolean = true): string {
  let output = `\n${chalk.bold('Project:')} ${project.name}\n`;
  output += `${chalk.gray('ID:')} ${project.id}\n`;
  output += `${chalk.gray('Status:')} ${project.status === 'active' ? chalk.green('ACTIVE') : chalk.yellow(project.status?.toUpperCase() || 'UNKNOWN')}\n`;
  output += `${chalk.gray('Description:')} ${project.description}\n`;
  output += `${chalk.gray('Created:')} ${project.createdAt.toLocaleString()}\n`;
  
  output += `${chalk.gray('Updated:')} ${project.updatedAt.toLocaleString()}\n`;
  
  if (project.instructions) {
    if (verbose) {
      output += `\n${chalk.bold('Instructions:')}\n${project.instructions}\n`;
    } else {
      output += `\n${chalk.bold('Instructions:')} ${project.instructions.length} characters\n`;
    }
  }
  
  if (project.config) {
    output += `\n${chalk.bold('Configuration:')}\n`;
    output += `  Max Retries: ${project.config.defaultMaxRetries || 'Not set'}\n`;
    output += `  Lease Duration: ${project.config.defaultLeaseDurationMinutes || 'Not set'} minutes\n`;
    output += `  Reaper Interval: ${project.config.reaperIntervalMinutes || 'Not set'} minutes\n`;
  }
  
  if (project.stats) {
    output += `\n${chalk.bold('Statistics:')}\n`;
    output += `  Total Tasks: ${project.stats.totalTasks || 0}\n`;
    output += `  Completed: ${chalk.green(project.stats.completedTasks || 0)}\n`;
    output += `  Failed: ${chalk.red(project.stats.failedTasks || 0)}\n`;
    output += `  Queued: ${chalk.yellow(project.stats.queuedTasks || 0)}\n`;
    output += `  Running: ${chalk.blue(project.stats.runningTasks || 0)}\n`;
  }
  
  return output;
}

function formatProjectList(projects: Project[], pagination?: any): string {
  let output = `\n${chalk.bold('Projects:')} (${projects.length})\n`;
  
  if (pagination) {
    output += chalk.gray(`Showing ${pagination.rangeStart}-${pagination.rangeEnd} of ${pagination.total} projects`);
    if (pagination.hasMore) {
      output += chalk.gray(' (more available)');
    }
    output += '\n';
  }
  
  output += '\n';
  
  const names = projects.map(p => p.name);
  const statuses = projects.map(p => p.status?.toUpperCase() || 'UNKNOWN');
  const taskCounts = projects.map(p => p.stats ? `${p.stats.totalTasks}` : '0');
  const descriptions = projects.map(p => p.description || 'No description');
  
  const nameWidth = Math.max(...names.map(n => n.length), 'NAME'.length);
  const statusWidth = Math.max(...statuses.map(s => s.length), 'STATUS'.length);
  const tasksWidth = Math.max(...taskCounts.map(t => t.length), 'TASKS'.length);
  const descriptionWidth = Math.max(...descriptions.map(d => d.length), 'DESCRIPTION'.length);
  
  output += chalk.bold(
    'NAME'.padEnd(nameWidth) + ' | ' +
    'STATUS'.padEnd(statusWidth) + ' | ' +
    'TASKS'.padEnd(tasksWidth) + ' | ' +
    'DESCRIPTION'.padEnd(descriptionWidth)
  ) + '\n';
  output += chalk.gray('-'.repeat(nameWidth + 3 + statusWidth + 3 + tasksWidth + 3 + descriptionWidth)) + '\n';
  
  for (const project of projects) {
    const status = project.status === 'active' ? chalk.green('ACTIVE') : chalk.yellow(project.status?.toUpperCase() || 'UNKNOWN');
    const tasks = project.stats ? `${project.stats.totalTasks}` : '0';
    const description = project.description || 'No description';
    
    output += project.name.padEnd(nameWidth) + ' | ' +
              padEndVisual(status, statusWidth) + ' | ' +
              tasks.padEnd(tasksWidth) + ' | ' +
              description.padEnd(descriptionWidth) + '\n';
  }
  
  if (pagination && pagination.limit < pagination.total) {
    const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    output += '\n' + chalk.gray(`Page ${currentPage} of ${totalPages}`);
  }
  
  return output;
}

function formatStats(data: any): string {
  let output = `\n${chalk.bold('Statistics for Project:')} ${data.projectName || 'Unknown'}\n`;
  
  if (data.stats) {
    const stats = data.stats;
    
    if (stats.totalRunningTasks !== undefined) {
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

// Create Project Command
const createProjectParams = [
  {
    name: 'name',
    type: 'string',
    description: 'Project name',
    required: true,
    positional: true
  },
  {
    name: 'description',
    type: 'string', 
    description: 'Project description (or @path/to/file.txt to read from file)',
    required: true,
    positional: true
  },
  {
    name: 'instructions',
    type: 'string',
    description: 'Project instructions for agents (or @path/to/file.txt)',
    alias: 'i'
  },
  {
    name: 'maxRetries',
    type: 'number',
    description: 'Default maximum retries for tasks',
    alias: ['max-retries', 'r'],
    default: 3
  },
  {
    name: 'leaseDuration',
    type: 'number',
    description: 'Default lease duration in minutes',
    alias: ['lease-duration', 'l'],
    default: 1.5
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full instructions in output (CLI only)',
    alias: 'v',
    default: false
  }
] as const satisfies CommandParameter[];

export const createProject = defineCommand({
  name: 'createProject',
  mcpName: 'create_project',
  cliName: 'create-project',
  description: 'Create a new project workspace for organizing tasks and agents. Use this when starting a new workflow, breaking down complex work into manageable pieces, or organizing tasks by domain/topic. Projects contain task types (templates), tasks (work items), and agents (workers).',
  parameters: createProjectParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const project = result.data!;
    let output = `Project Details:
  ID: ${project.id}
  Name: ${project.name}
  Status: ${project.status}
  Description: ${project.description}
  Created: ${new Date(project.createdAt).toLocaleString()}`;
    
    if (project.instructions) {
      if (args.verbose) {
        output += `\n  Instructions: ${project.instructions}`;
      } else {
        output += `\n  Instructions: ${project.instructions.length} characters`;
      }
    }
    
    return output;
  },
  discoverability: {
    triggerKeywords: ['create', 'new', 'project', 'workspace', 'organize', 'start', 'begin', 'initialize'],
    userIntentPatterns: ['I want to start a new project', 'Create a workspace for tasks', 'Set up a new workflow'],
    useWhen: ['Starting a new workflow or initiative', 'Need to organize tasks by domain or topic', 'Setting up a structured work environment'],
    typicalPredecessors: ['system initialization', 'planning phase'],
    typicalSuccessors: ['create_task_type', 'create_task', 'get_next_task'],
    workflowPatterns: ['project-setup-workflow', 'task-organization-workflow'],
    prerequisites: ['Clear project requirements', 'Defined project scope'],
    expectedOutcomes: ['Project ID for subsequent operations', 'Workspace ready for task types and tasks'],
    errorGuidance: ['Check for duplicate project names', 'Verify required parameters are provided'],
    antiPatterns: ['Creating projects for single tasks', 'Using when project already exists']
  },
  async handler(context, args) {
    const description = readContentFromFileOrValue(args.description);
    const instructions = args.instructions ? readContentFromFileOrValue(args.instructions) : undefined;
    
    const project = await context.project.createProject({
      name: args.name,
      description,
      instructions,
      config: {
        defaultMaxRetries: args.maxRetries,
        defaultLeaseDurationMinutes: args.leaseDuration,
        reaperIntervalMinutes: 1
      }
    });

    return {
      success: true,
      data: project,
      message: 'Project created successfully'
    };
  }
});

export type CreateProjectTypes = TaskTypes<typeof createProject>;

// List Projects Command
const listProjectsParams = [
  {
    name: 'status',
    type: 'string',
    description: 'Filter by project status',
    choices: ['active', 'closed', 'all'],
    default: 'active'
  },
  {
    name: 'includeClosed',
    type: 'boolean',
    description: 'Include closed projects',
    alias: ['include-closed', 'c'],
    default: false
  },
  {
    name: 'limit',
    type: 'number',
    description: 'Maximum number of projects to return',
    default: 100
  },
  {
    name: 'offset',
    type: 'number',
    description: 'Number of projects to skip',
    default: 0
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full instructions in output (CLI only)',
    alias: 'v',
    default: false
  }
] as const satisfies CommandParameter[];

export const listProjects = defineCommand({
  name: 'listProjects',
  mcpName: 'list_projects',
  cliName: 'list-projects',
  description: 'List all projects with filtering options. Use this to find existing projects, check project status, or get an overview of all workspaces. Helpful for discovering what projects already exist before creating new ones.\n\n📋 NOTE: This tool only provides basic project information (name, status, task counts). To get complete project instructions and context needed for working with tasks, use get_project after identifying the project you want to work with.',
  parameters: listProjectsParams,
  returnDataType: 'list',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const projects = result.data || [];
    return formatProjectList(projects);
  },
  async handler(context, args) {
    // Apply defaults for undefined parameters
    const status = args.status ?? 'active';
    const includeClosed = status === 'all' || status === 'closed' || args.includeClosed;
    const allProjects = await context.project.listProjects(includeClosed);
    
    // Apply client-side filtering and pagination
    let filteredProjects = allProjects;
    if (status !== 'all') {
      filteredProjects = allProjects.filter(p => p.status === status);
    }
    
    const offset = args.offset || 0;
    const limit = args.limit || 100;
    const projects = filteredProjects.slice(offset, offset + limit);

    return {
      success: true,
      data: projects,
      message: `Found ${projects.length} projects`
    };
  }
});

export type ListProjectsTypes = TaskTypes<typeof listProjects>;

// Get Project Command
const getProjectParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full instructions in output (CLI only)',
    alias: 'v',
    default: false
  }
] as const satisfies CommandParameter[];

export const getProject = defineCommand({
  name: 'getProject',
  mcpName: 'get_project',
  cliName: 'get-project',
  description: 'Get detailed information about a specific project including instructions, configuration, statistics, and metadata. Returns project instructions that agents need to understand their role and objectives. Use this to understand project settings, check task counts, or verify project configuration before creating tasks.',
  parameters: getProjectParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const project = result.data!;
    return formatProject(project, args.verbose);
  },
  async handler(context, args) {
    // Find project by name or ID
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    return {
      success: true,
      data: project
    };
  }
});

export type GetProjectTypes = TaskTypes<typeof getProject>;

// Update Project Command
const updateProjectParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  },
  {
    name: 'description',
    type: 'string',
    description: 'New project description (or @path/to/file.txt)',
    alias: 'd'
  },
  {
    name: 'instructions',
    type: 'string',
    description: 'New project instructions (or @path/to/file.txt)',
    alias: 'i'
  },
  {
    name: 'status',
    type: 'string',
    description: 'Project status',
    choices: ['active', 'closed'],
    alias: 's'
  },
  {
    name: 'maxRetries',
    type: 'number',
    description: 'Default maximum retries for tasks',
    alias: ['max-retries', 'r']
  },
  {
    name: 'leaseDuration',
    type: 'number',
    description: 'Default lease duration in minutes',
    alias: ['lease-duration', 'l']
  },
  {
    name: 'verbose',
    type: 'boolean',
    description: 'Show full instructions in output (CLI only)',
    alias: 'v',
    default: false
  }
] as const satisfies CommandParameter[];

export const updateProject = defineCommand({
  name: 'updateProject',
  mcpName: 'update_project',
  cliName: 'update-project',
  description: 'Update project properties such as description, instructions, status, or configuration. Use this to modify project settings, close completed projects, or update instructions for agents working on the project.',
  parameters: updateProjectParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    const project = result.data!;
    return formatProject(project, args.verbose);
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

    const updates: any = {};
    if (args.description) updates.description = readContentFromFileOrValue(args.description);
    if (args.instructions) updates.instructions = readContentFromFileOrValue(args.instructions);
    if (args.status) updates.status = args.status;
    if (args.maxRetries !== undefined || args.leaseDuration !== undefined) {
      updates.config = { ...project.config };
      if (args.maxRetries !== undefined) updates.config.defaultMaxRetries = args.maxRetries;
      if (args.leaseDuration !== undefined) updates.config.defaultLeaseDurationMinutes = args.leaseDuration;
    }

    const updatedProject = await context.project.updateProject(project.id, updates);

    return {
      success: true,
      data: updatedProject,
      message: 'Project updated successfully'
    };
  }
});

export type UpdateProjectTypes = TaskTypes<typeof updateProject>;

// Get Project Stats Command
const getProjectStatsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const getProjectStats = defineCommand({
  name: 'getProjectStats',
  mcpName: 'get_project_stats',
  cliName: 'get-project-stats',
  description: 'Get comprehensive project statistics including task counts, completion rates, agent activity, and performance metrics. Use this to monitor progress, track completion status, or generate reports on project health and activity.',
  parameters: getProjectStatsParams,
  returnDataType: 'stats',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatStats(result.data!);
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

    const stats = await context.project.getProjectStatus(project.id);

    return {
      success: true,
      data: {
        projectName: project.name,
        stats
      }
    };
  }
});

export type GetProjectStatsTypes = TaskTypes<typeof getProjectStats>;