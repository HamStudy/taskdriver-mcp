/**
 * TaskDriver MCP Tool Handlers
 * 
 * This module implements the actual functionality for each MCP tool.
 * Handlers receive tool arguments and return results or throw errors.
 */

import { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ProjectService } from '../services/ProjectService.js';
import { TaskService } from '../services/TaskService.js';
import { TaskTypeService } from '../services/TaskTypeService.js';
import { AgentService } from '../services/AgentService.js';
import { StorageProvider } from '../storage/StorageProvider.js';
import { validate, isValidationError } from '../utils/validation.js';
import * as validation from '../utils/validation.js';

export class ToolHandlers {
  private projectService: ProjectService;
  private taskService: TaskService;
  private taskTypeService: TaskTypeService;
  private agentService: AgentService;

  constructor(private storage: StorageProvider) {
    this.projectService = new ProjectService(storage);
    this.taskTypeService = new TaskTypeService(storage, this.projectService);
    this.taskService = new TaskService(storage, this.projectService, this.taskTypeService);
    this.agentService = new AgentService(storage, this.projectService, this.taskService);
  }

  /**
   * Handle tool calls
   */
  async handleToolCall(request: CallToolRequest): Promise<CallToolResult> {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Project Management
        case 'create_project':
          return await this.createProject(args);
        case 'list_projects':
          return await this.listProjects(args);
        case 'get_project':
          return await this.getProject(args);
        case 'update_project':
          return await this.updateProject(args);

        // Task Type Management
        case 'create_task_type':
          return await this.createTaskType(args);
        case 'list_task_types':
          return await this.listTaskTypes(args);

        // Task Management
        case 'create_task':
          return await this.createTask(args);
        case 'list_tasks':
          return await this.listTasks(args);
        case 'get_task':
          return await this.getTask(args);

        // Agent Management
        case 'register_agent':
          return await this.registerAgent(args);
        case 'list_agents':
          return await this.listAgents(args);

        // Task Execution
        case 'assign_task':
          return await this.assignTask(args);
        case 'complete_task':
          return await this.completeTask(args);
        case 'fail_task':
          return await this.failTask(args);

        // Status and Monitoring
        case 'get_project_stats':
          return await this.getProjectStats(args);
        case 'health_check':
          return await this.healthCheck(args);

        // Lease Management
        case 'extend_task_lease':
          return await this.extendTaskLease(args);
        case 'get_lease_stats':
          return await this.getLeaseStats(args);
        case 'cleanup_expired_leases':
          return await this.cleanupExpiredLeases(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // Convert validation errors to user-friendly messages
      if (isValidationError(error)) {
        return {
          content: [
            {
              type: 'text',
              text: `Validation Error: ${(error as Error).message}`
            }
          ],
          isError: true
        };
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error occurred');
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Project Management Handlers
   */
  private async createProject(args: any): Promise<CallToolResult> {
    const input = validate(validation.createProjectSchema, args);
    const project = await this.projectService.createProject(input);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            project: {
              id: project.id,
              name: project.name,
              description: project.description,
              status: project.status,
              createdAt: project.createdAt,
              config: project.config
            }
          }, null, 2)
        }
      ]
    };
  }

  private async listProjects(args: any): Promise<CallToolResult> {
    const { status = 'active', limit = 100, offset = 0 } = args || {};
    const includeClosed = status === 'all' || status === 'closed';
    const allProjects = await this.projectService.listProjects(includeClosed);
    
    // Apply client-side filtering and pagination since the service doesn't support it
    let filteredProjects = allProjects;
    if (status !== 'all') {
      filteredProjects = allProjects.filter(p => p.status === status);
    }
    
    const projects = filteredProjects.slice(offset, offset + limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            projects: projects.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              status: p.status,
              createdAt: p.createdAt,
              updatedAt: p.updatedAt,
              stats: p.stats
            }))
          }, null, 2)
        }
      ]
    };
  }

  private async getProject(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const project = await this.projectService.getProject(projectId);
    
    if (!project) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Project not found'
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            project: {
              id: project.id,
              name: project.name,
              description: project.description,
              status: project.status,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              config: project.config,
              stats: project.stats
            }
          }, null, 2)
        }
      ]
    };
  }

  private async updateProject(args: any): Promise<CallToolResult> {
    const { projectId, ...updates } = args;
    const project = await this.projectService.updateProject(projectId, updates);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            project: {
              id: project.id,
              name: project.name,
              description: project.description,
              status: project.status,
              updatedAt: project.updatedAt,
              config: project.config
            }
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Task Type Management Handlers
   */
  private async createTaskType(args: any): Promise<CallToolResult> {
    const input = validate(validation.createTaskTypeSchema, args);
    const taskType = await this.taskTypeService.createTaskType(input);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            taskType: {
              id: taskType.id,
              name: taskType.name,
              projectId: taskType.projectId,
              template: taskType.template,
              variables: taskType.variables,
              duplicateHandling: taskType.duplicateHandling,
              maxRetries: taskType.maxRetries,
              leaseDurationMinutes: taskType.leaseDurationMinutes,
              createdAt: taskType.createdAt
            }
          }, null, 2)
        }
      ]
    };
  }

  private async listTaskTypes(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const taskTypes = await this.taskTypeService.listTaskTypes(projectId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            taskTypes: taskTypes.map(tt => ({
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
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Task Management Handlers
   */
  private async createTask(args: any): Promise<CallToolResult> {
    const input = validate(validation.createTaskSchema, args);
    const task = await this.taskService.createTask(input);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            task: {
              id: task.id,
              projectId: task.projectId,
              typeId: task.typeId,
              instructions: task.instructions,
              status: task.status,
              createdAt: task.createdAt,
              variables: task.variables
            }
          }, null, 2)
        }
      ]
    };
  }

  private async listTasks(args: any): Promise<CallToolResult> {
    const validated = validate(validation.taskFiltersSchema, args);
    const { projectId, ...filters } = validated;
    const tasks = await this.taskService.listTasks(projectId, filters);
      
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            tasks: tasks.map(t => ({
              id: t.id,
              projectId: t.projectId,
              typeId: t.typeId,
              instructions: t.instructions,
              status: t.status,
              assignedTo: t.assignedTo,
              createdAt: t.createdAt,
              assignedAt: t.assignedAt,
              completedAt: t.completedAt,
              retryCount: t.retryCount,
              maxRetries: t.maxRetries
            }))
          }, null, 2)
        }
      ]
    };
  }

  private async getTask(args: any): Promise<CallToolResult> {
    const { projectId, taskId } = args;
    const task = await this.taskService.getTask(taskId);

    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Task not found'
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            task: {
              id: task.id,
              projectId: task.projectId,
              typeId: task.typeId,
              instructions: task.instructions,
              status: task.status,
              assignedTo: task.assignedTo,
              createdAt: task.createdAt,
              assignedAt: task.assignedAt,
              completedAt: task.completedAt,
              variables: task.variables,
              retryCount: task.retryCount,
              maxRetries: task.maxRetries,
              leaseExpiresAt: task.leaseExpiresAt,
              result: task.result
            }
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Agent Management Handlers
   */
  private async registerAgent(args: any): Promise<CallToolResult> {
    const input = validate(validation.createAgentSchema, args);
    const result = await this.agentService.registerAgent(input);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            agent: {
              id: result.agent.id,
              name: result.agent.name,
              projectId: result.agent.projectId,
              apiKey: result.apiKey,
              capabilities: result.agent.capabilities,
              createdAt: result.agent.createdAt,
              status: result.agent.status
            }
          }, null, 2)
        }
      ]
    };
  }

  private async listAgents(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const agents = await this.agentService.listAgents(projectId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            agents: agents.map(a => ({
              id: a.id,
              name: a.name,
              projectId: a.projectId,
              capabilities: a.capabilities,
              status: a.status,
              createdAt: a.createdAt,
              lastSeen: a.lastSeen
            }))
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Task Execution Handlers
   */
  private async assignTask(args: any): Promise<CallToolResult> {
    const { projectId, agentName, capabilities = [] } = args;
    const task = await this.agentService.getNextTask(agentName, projectId);

    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              task: null,
              message: 'No tasks available for assignment'
            }, null, 2)
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            task: {
              id: task.id,
              projectId: task.projectId,
              typeId: task.typeId,
              instructions: task.instructions,
              status: task.status,
              assignedTo: task.assignedTo,
              assignedAt: task.assignedAt,
              variables: task.variables,
              maxRetries: task.maxRetries,
              leaseExpiresAt: task.leaseExpiresAt
            }
          }, null, 2)
        }
      ]
    };
  }

  private async completeTask(args: any): Promise<CallToolResult> {
    const { projectId, taskId, result, outputs = {} } = args;
    
    // Get the task to find the assigned agent
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Task not found'
            }, null, 2)
          }
        ],
        isError: true
      };
    }
    
    if (!task.assignedTo) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Task is not assigned to any agent'
            }, null, 2)
          }
        ],
        isError: true
      };
    }
    
    const taskResult = {
      success: true,
      output: result,
      metadata: outputs
    };
    
    await this.agentService.completeTask(task.assignedTo, projectId, taskId, taskResult);
    
    // Get the updated task to return current state
    const updatedTask = await this.taskService.getTask(taskId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            task: {
              id: taskId,
              status: updatedTask?.status || 'completed',
              completedAt: updatedTask?.completedAt,
              result: updatedTask?.result?.output || result,
              outputs: updatedTask?.result?.metadata || outputs
            }
          }, null, 2)
        }
      ]
    };
  }

  private async failTask(args: any): Promise<CallToolResult> {
    const { projectId, taskId, error, canRetry = true } = args;
    
    // Get the task to find the assigned agent
    const task = await this.taskService.getTask(taskId);
    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Task not found'
            }, null, 2)
          }
        ],
        isError: true
      };
    }
    
    if (!task.assignedTo) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Task is not assigned to any agent'
            }, null, 2)
          }
        ],
        isError: true
      };
    }
    
    const taskResult = {
      success: false,
      error: error,
      canRetry: canRetry
    };
    
    await this.agentService.failTask(task.assignedTo, projectId, taskId, taskResult, canRetry);
    
    // Get the updated task to return current state
    const updatedTask = await this.taskService.getTask(taskId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            task: {
              id: taskId,
              status: updatedTask?.status || 'failed',
              error: updatedTask?.result?.error || error,
              retryCount: updatedTask?.retryCount || 0,
              maxRetries: updatedTask?.maxRetries || 3,
              willRetry: updatedTask?.status === 'queued'
            }
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Status and Monitoring Handlers
   */
  private async getProjectStats(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const project = await this.projectService.getProject(projectId);
    
    if (!project) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Project not found'
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId: project.id,
            stats: project.stats
          }, null, 2)
        }
      ]
    };
  }

  private async healthCheck(args: any): Promise<CallToolResult> {
    const healthStatus = await this.storage.healthCheck();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: 'healthy',
            storage: healthStatus,
            timestamp: new Date().toISOString()
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Lease Management Handlers
   */
  private async extendTaskLease(args: any): Promise<CallToolResult> {
    const { taskId, extensionMinutes } = args;
    await this.taskService.extendTaskLease(taskId, extensionMinutes);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Task lease extended by ${extensionMinutes} minutes`,
            taskId,
            extensionMinutes
          }, null, 2)
        }
      ]
    };
  }

  private async getLeaseStats(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const stats = await this.taskService.getLeaseStats(projectId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            stats
          }, null, 2)
        }
      ]
    };
  }

  private async cleanupExpiredLeases(args: any): Promise<CallToolResult> {
    const { projectId } = args;
    const results = await this.taskService.cleanupExpiredLeases(projectId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            projectId,
            reclaimedTasks: results.reclaimedTasks,
            cleanedAgents: results.cleanedAgents,
            message: `Cleanup completed: ${results.reclaimedTasks} tasks reclaimed, ${results.cleanedAgents} agents cleaned`
          }, null, 2)
        }
      ]
    };
  }
}