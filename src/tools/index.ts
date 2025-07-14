/**
 * TaskDriver MCP Tools
 * 
 * This module defines all the MCP tools that LLM agents can use to interact
 * with the TaskDriver system for task orchestration and management.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Project Management Tools
 */
export const createProjectTool: Tool = {
  name: 'create_project',
  description: 'Create a new project for organizing tasks and agents',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name (alphanumeric, hyphens, underscores only)'
      },
      description: {
        type: 'string',
        description: 'Project description'
      },
      config: {
        type: 'object',
        description: 'Optional project configuration',
        properties: {
          defaultMaxRetries: {
            type: 'number',
            description: 'Default max retries for tasks in this project',
            minimum: 0,
            maximum: 10
          },
          defaultLeaseDurationMinutes: {
            type: 'number',
            description: 'Default lease duration in minutes for tasks',
            minimum: 1,
            maximum: 1440
          },
          reaperIntervalMinutes: {
            type: 'number',
            description: 'Reaper interval in minutes for cleaning up expired tasks',
            minimum: 1,
            maximum: 60
          }
        }
      }
    },
    required: ['name', 'description']
  }
};

export const listProjectsTool: Tool = {
  name: 'list_projects',
  description: 'List all projects with optional filtering',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'closed', 'all'],
        description: 'Filter projects by status (default: active)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of projects to return',
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: 'number',
        description: 'Number of projects to skip',
        minimum: 0
      }
    }
  }
};

export const getProjectTool: Tool = {
  name: 'get_project',
  description: 'Get detailed information about a specific project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      }
    },
    required: ['projectId']
  }
};

export const updateProjectTool: Tool = {
  name: 'update_project',
  description: 'Update project properties',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      description: {
        type: 'string',
        description: 'New project description'
      },
      status: {
        type: 'string',
        enum: ['active', 'closed'],
        description: 'Project status'
      },
      config: {
        type: 'object',
        description: 'Project configuration updates',
        properties: {
          defaultMaxRetries: {
            type: 'number',
            minimum: 0,
            maximum: 10
          },
          defaultLeaseDurationMinutes: {
            type: 'number',
            minimum: 1,
            maximum: 1440
          },
          reaperIntervalMinutes: {
            type: 'number',
            minimum: 1,
            maximum: 60
          }
        }
      }
    },
    required: ['projectId']
  }
};

/**
 * Task Type Management Tools
 */
export const createTaskTypeTool: Tool = {
  name: 'create_task_type',
  description: 'Create a new task type template for a project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      name: {
        type: 'string',
        description: 'Task type name (alphanumeric, hyphens, underscores only)'
      },
      template: {
        type: 'string',
        description: 'Task instruction template with {{variable}} placeholders'
      },
      variables: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'List of variable names used in the template'
      },
      duplicateHandling: {
        type: 'string',
        enum: ['ignore', 'fail', 'allow'],
        description: 'How to handle duplicate tasks (default: allow)'
      },
      maxRetries: {
        type: 'number',
        description: 'Maximum retry attempts for tasks of this type',
        minimum: 0,
        maximum: 10
      },
      leaseDurationMinutes: {
        type: 'number',
        description: 'Lease duration in minutes for tasks of this type',
        minimum: 1,
        maximum: 1440
      }
    },
    required: ['projectId', 'name']
  }
};

export const listTaskTypesTool: Tool = {
  name: 'list_task_types',
  description: 'List all task types for a project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      }
    },
    required: ['projectId']
  }
};

/**
 * Task Management Tools
 */
export const createTaskTool: Tool = {
  name: 'create_task',
  description: 'Create a new task for execution',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      typeId: {
        type: 'string',
        description: 'Task type ID (UUID)'
      },
      instructions: {
        type: 'string',
        description: 'Task instructions (can contain template variables)'
      },
      variables: {
        type: 'object',
        description: 'Key-value pairs for template variable substitution',
        additionalProperties: {
          type: 'string'
        }
      },
      batchId: {
        type: 'string',
        description: 'Optional batch ID for grouping related tasks'
      }
    },
    required: ['projectId', 'typeId', 'instructions']
  }
};

export const listTasksTool: Tool = {
  name: 'list_tasks',
  description: 'List tasks with optional filtering',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
        description: 'Filter by task status'
      },
      assignedTo: {
        type: 'string',
        description: 'Filter by assigned agent name'
      },
      batchId: {
        type: 'string',
        description: 'Filter by batch ID'
      },
      typeId: {
        type: 'string',
        description: 'Filter by task type ID'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of tasks to return',
        minimum: 1,
        maximum: 1000
      },
      offset: {
        type: 'number',
        description: 'Number of tasks to skip',
        minimum: 0
      }
    },
    required: ['projectId']
  }
};

export const getTaskTool: Tool = {
  name: 'get_task',
  description: 'Get detailed information about a specific task',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      taskId: {
        type: 'string',
        description: 'Task ID (UUID)'
      }
    },
    required: ['projectId', 'taskId']
  }
};

/**
 * Agent Management Tools
 */
export const registerAgentTool: Tool = {
  name: 'register_agent',
  description: 'Register a new agent for task execution',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      name: {
        type: 'string',
        description: 'Agent name (optional, will be auto-generated if not provided)'
      },
      capabilities: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'List of capabilities or task types this agent can handle'
      }
    },
    required: ['projectId']
  }
};

export const listAgentsTool: Tool = {
  name: 'list_agents',
  description: 'List all agents for a project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      }
    },
    required: ['projectId']
  }
};

/**
 * Task Execution Tools
 */
export const assignTaskTool: Tool = {
  name: 'assign_task',
  description: 'Assign a queued task to an agent for execution',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      agentName: {
        type: 'string',
        description: 'Agent name requesting task assignment'
      },
      capabilities: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Agent capabilities for task matching'
      }
    },
    required: ['projectId', 'agentName']
  }
};

export const completeTaskTool: Tool = {
  name: 'complete_task',
  description: 'Mark a task as completed with results',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      taskId: {
        type: 'string',
        description: 'Task ID (UUID)'
      },
      result: {
        type: 'string',
        description: 'Task execution result'
      },
      outputs: {
        type: 'object',
        description: 'Structured task outputs',
        additionalProperties: true
      }
    },
    required: ['projectId', 'taskId', 'result']
  }
};

export const failTaskTool: Tool = {
  name: 'fail_task',
  description: 'Mark a task as failed with error information',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      },
      taskId: {
        type: 'string',
        description: 'Task ID (UUID)'
      },
      error: {
        type: 'string',
        description: 'Error message or description'
      },
      canRetry: {
        type: 'boolean',
        description: 'Whether the task can be retried (default: true)'
      }
    },
    required: ['projectId', 'taskId', 'error']
  }
};

/**
 * Status and Monitoring Tools
 */
export const getProjectStatsTool: Tool = {
  name: 'get_project_stats',
  description: 'Get project statistics and status overview',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (UUID)'
      }
    },
    required: ['projectId']
  }
};

export const healthCheckTool: Tool = {
  name: 'health_check',
  description: 'Check the health status of the TaskDriver system',
  inputSchema: {
    type: 'object',
    properties: {}
  }
};

// Lease Management Tools

export const extendTaskLeaseTool: Tool = {
  name: 'extend_task_lease',
  description: 'Extend the lease duration for a running task to give an agent more time',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to extend the lease for'
      },
      extensionMinutes: {
        type: 'number',
        description: 'Number of minutes to extend the lease by',
        minimum: 1,
        maximum: 1440
      }
    },
    required: ['taskId', 'extensionMinutes']
  }
};

export const getLeaseStatsTool: Tool = {
  name: 'get_lease_stats',
  description: 'Get lease and task statistics for a project to monitor system health',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the project to get lease statistics for'
      }
    },
    required: ['projectId']
  }
};

export const cleanupExpiredLeasesTool: Tool = {
  name: 'cleanup_expired_leases',
  description: 'Manually trigger cleanup of expired task leases for a project',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'ID of the project to cleanup expired leases for'
      }
    },
    required: ['projectId']
  }
};

/**
 * All available tools
 */
export const allTools: Tool[] = [
  // Project Management
  createProjectTool,
  listProjectsTool,
  getProjectTool,
  updateProjectTool,
  
  // Task Type Management
  createTaskTypeTool,
  listTaskTypesTool,
  
  // Task Management
  createTaskTool,
  listTasksTool,
  getTaskTool,
  
  // Agent Management
  registerAgentTool,
  listAgentsTool,
  
  // Task Execution
  assignTaskTool,
  completeTaskTool,
  failTaskTool,
  
  // Status and Monitoring
  getProjectStatsTool,
  healthCheckTool,

  // Lease Management
  extendTaskLeaseTool,
  getLeaseStatsTool,
  cleanupExpiredLeasesTool
];