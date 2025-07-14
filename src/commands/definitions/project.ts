/**
 * Project Management Commands
 */

import { CommandDefinition } from '../types.js';
import { 
  readContentFromFileOrValue, 
  findProjectByNameOrId 
} from '../utils.js';

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
    default: 10
  }
] as const;

export const createProject: CommandDefinition<typeof createProjectParams> = {
  name: 'createProject',
  mcpName: 'create_project',
  cliName: 'create-project',
  description: 'Create a new project',
  parameters: createProjectParams,
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
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
        config: project.config
      },
      message: 'Project created successfully'
    };
  }
};

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
  }
] as const;

export const listProjects: CommandDefinition<typeof listProjectsParams> = {
  name: 'listProjects',
  mcpName: 'list_projects',
  cliName: 'list-projects',
  description: 'List all projects',
  parameters: listProjectsParams,
  async handler(context, args) {
    const includeClosed = args.status === 'all' || args.status === 'closed' || args.includeClosed;
    const allProjects = await context.project.listProjects(includeClosed);
    
    // Apply client-side filtering and pagination
    let filteredProjects = allProjects;
    if (args.status !== 'all') {
      filteredProjects = allProjects.filter(p => p.status === args.status);
    }
    
    const projects = filteredProjects.slice(args.offset, args.offset + args.limit);

    return {
      success: true,
      data: projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        stats: p.stats
      }))
    };
  }
};

// Get Project Command
const getProjectParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const getProject: CommandDefinition<typeof getProjectParams> = {
  name: 'getProject',
  mcpName: 'get_project',
  cliName: 'get-project',
  description: 'Get project details',
  parameters: getProjectParams,
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
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        config: project.config,
        stats: project.stats
      }
    };
  }
};

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
  }
] as const;

export const updateProject: CommandDefinition<typeof updateProjectParams> = {
  name: 'updateProject',
  mcpName: 'update_project',
  cliName: 'update-project',
  description: 'Update project properties',
  parameters: updateProjectParams,
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
      data: {
        id: updatedProject.id,
        name: updatedProject.name,
        description: updatedProject.description,
        status: updatedProject.status,
        updatedAt: updatedProject.updatedAt,
        config: updatedProject.config
      },
      message: 'Project updated successfully'
    };
  }
};

// Get Project Stats Command
const getProjectStatsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const getProjectStats: CommandDefinition<typeof getProjectStatsParams> = {
  name: 'getProjectStats',
  mcpName: 'get_project_stats',
  cliName: 'get-project-stats',
  description: 'Get project statistics',
  parameters: getProjectStatsParams,
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
        projectId: project.id,
        projectName: project.name,
        stats
      }
    };
  }
};