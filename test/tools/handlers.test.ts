import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { ToolHandlers } from '../../src/tools/handlers.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('ToolHandlers', () => {
  let storage: FileStorageProvider;
  let handlers: ToolHandlers;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    handlers = new ToolHandlers(storage);
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Project Management Tools', () => {
    describe('create_project', () => {
      it('should create a project successfully', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'create_project',
            arguments: {
              name: 'test-project',
              description: 'A test project'
            }
          }
        });

        expect(result.isError).toBeFalsy();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe('text');
        
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.project.name).toBe('test-project');
        expect(response.project.description).toBe('A test project');
        expect(response.project.status).toBe('active');
        expect(response.project.id).toBeDefined();
      });

      it('should handle validation errors', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'create_project',
            arguments: {
              name: 'invalid name with spaces',
              description: 'A test project'
            }
          }
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Validation Error');
      });
    });

    describe('list_projects', () => {
      it('should list projects', async () => {
        // Create a test project first
        await handlers.handleToolCall({
          params: {
            name: 'create_project',
            arguments: {
              name: 'test-project',
              description: 'A test project'
            }
          }
        });

        const result = await handlers.handleToolCall({
          params: {
            name: 'list_projects',
            arguments: {}
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.projects).toHaveLength(1);
        expect(response.projects[0].name).toBe('test-project');
      });

      it('should handle filtering by status', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'list_projects',
            arguments: {
              status: 'active',
              limit: 10
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(Array.isArray(response.projects)).toBe(true);
      });
    });

    describe('get_project', () => {
      it('should get a project by ID', async () => {
        // Create a test project first
        const createResult = await handlers.handleToolCall({
          params: {
            name: 'create_project',
            arguments: {
              name: 'test-project',
              description: 'A test project'
            }
          }
        });

        const createResponse = JSON.parse(createResult.content[0].text);
        const projectId = createResponse.project.id;

        const result = await handlers.handleToolCall({
          params: {
            name: 'get_project',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.project.id).toBe(projectId);
        expect(response.project.name).toBe('test-project');
      });

      it('should handle non-existent project', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'get_project',
            arguments: {
              projectId: 'non-existent-id'
            }
          }
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(false);
        expect(response.error).toBe('Project not found');
      });
    });
  });

  describe('Task Type Management Tools', () => {
    let projectId: string;

    beforeEach(async () => {
      // Create a test project for task types
      const createResult = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'test-project',
            description: 'A test project'
          }
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      projectId = createResponse.project.id;
    });

    describe('create_task_type', () => {
      it('should create a task type successfully', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'create_task_type',
            arguments: {
              projectId,
              name: 'test-task-type',
              template: 'Do {{action}} on {{target}}',
              variables: ['action', 'target']
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.taskType.name).toBe('test-task-type');
        expect(response.taskType.template).toBe('Do {{action}} on {{target}}');
        expect(response.taskType.variables).toEqual(['action', 'target']);
      });
    });

    describe('list_task_types', () => {
      it('should list task types for a project', async () => {
        // Create a test task type first
        await handlers.handleToolCall({
          params: {
            name: 'create_task_type',
            arguments: {
              projectId,
              name: 'test-task-type'
            }
          }
        });

        const result = await handlers.handleToolCall({
          params: {
            name: 'list_task_types',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.taskTypes).toHaveLength(1);
        expect(response.taskTypes[0].name).toBe('test-task-type');
      });
    });
  });

  describe('Task Management Tools', () => {
    let projectId: string;
    let taskTypeId: string;

    beforeEach(async () => {
      // Create a test project
      const createProjectResult = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'test-project',
            description: 'A test project'
          }
        }
      });

      const createProjectResponse = JSON.parse(createProjectResult.content[0].text);
      projectId = createProjectResponse.project.id;

      // Create a test task type
      const createTaskTypeResult = await handlers.handleToolCall({
        params: {
          name: 'create_task_type',
          arguments: {
            projectId,
            name: 'test-task-type'
            // No template - instructions will be used as-is
          }
        }
      });

      const createTaskTypeResponse = JSON.parse(createTaskTypeResult.content[0].text);
      taskTypeId = createTaskTypeResponse.taskType.id;
    });

    describe('create_task', () => {
      it('should create a task successfully', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'create_task',
            arguments: {
              projectId,
              typeId: taskTypeId,
              instructions: 'Test task instructions'
              // No variables since task type has no template
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task.instructions).toBe('Test task instructions'); // No template
        expect(response.task.status).toBe('queued');
      });
    });

    describe('list_tasks', () => {
      it('should list tasks for a project', async () => {
        // Create a test task first
        const createTaskResult = await handlers.handleToolCall({
          params: {
            name: 'create_task',
            arguments: {
              projectId,
              typeId: taskTypeId,
              instructions: 'Test task instructions'
            }
          }
        });
        
        // Make sure task creation succeeded
        expect(createTaskResult.isError).toBeFalsy();

        const result = await handlers.handleToolCall({
          params: {
            name: 'list_tasks',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.tasks).toHaveLength(1);
        expect(response.tasks[0].instructions).toBe('Test task instructions');
      });
    });

    describe('get_task', () => {
      it('should get a task by ID', async () => {
        // Create a test task first
        const createResult = await handlers.handleToolCall({
          params: {
            name: 'create_task',
            arguments: {
              projectId,
              typeId: taskTypeId,
              instructions: 'Test task instructions'
            }
          }
        });

        const createResponse = JSON.parse(createResult.content[0].text);
        const taskId = createResponse.task.id;

        const result = await handlers.handleToolCall({
          params: {
            name: 'get_task',
            arguments: {
              projectId,
              taskId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task.id).toBe(taskId);
        expect(response.task.instructions).toBe('Test task instructions');
      });

      it('should handle non-existent task', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'get_task',
            arguments: {
              projectId,
              taskId: 'non-existent-task-id'
            }
          }
        });

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(false);
        expect(response.error).toBe('Task not found');
      });
    });
  });

  describe('Agent Management Tools', () => {
    let projectId: string;

    beforeEach(async () => {
      // Create a test project
      const createResult = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'test-project',
            description: 'A test project'
          }
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      projectId = createResponse.project.id;
    });

    describe('register_agent', () => {
      it('should register an agent successfully', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'register_agent',
            arguments: {
              projectId,
              name: 'test-agent',
              capabilities: ['testing', 'automation']
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.agent.name).toBe('test-agent');
        expect(response.agent.capabilities).toEqual(['testing', 'automation']);
        expect(response.agent.apiKey).toBeDefined();
        expect(response.agent.status).toBe('idle');
      });

      it('should auto-generate name when not provided', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'register_agent',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.agent.name).toBeDefined();
        expect(response.agent.name).toMatch(/^agent-/);
      });
    });

    describe('list_agents', () => {
      it('should list agents for a project', async () => {
        // Create a test agent first
        await handlers.handleToolCall({
          params: {
            name: 'register_agent',
            arguments: {
              projectId,
              name: 'test-agent'
            }
          }
        });

        const result = await handlers.handleToolCall({
          params: {
            name: 'list_agents',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.agents).toHaveLength(1);
        expect(response.agents[0].name).toBe('test-agent');
      });
    });
  });

  describe('Task Execution Tools', () => {
    let projectId: string;
    let taskTypeId: string;
    let taskId: string;

    beforeEach(async () => {
      // Create a test project
      const createProjectResult = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'test-project',
            description: 'A test project'
          }
        }
      });

      const createProjectResponse = JSON.parse(createProjectResult.content[0].text);
      projectId = createProjectResponse.project.id;

      // Create a test task type
      const createTaskTypeResult = await handlers.handleToolCall({
        params: {
          name: 'create_task_type',
          arguments: {
            projectId,
            name: 'test-task-type'
          }
        }
      });

      const createTaskTypeResponse = JSON.parse(createTaskTypeResult.content[0].text);
      taskTypeId = createTaskTypeResponse.taskType.id;

      // Create a test task
      const createTaskResult = await handlers.handleToolCall({
        params: {
          name: 'create_task',
          arguments: {
            projectId,
            typeId: taskTypeId,
            instructions: 'Test task instructions'
          }
        }
      });

      const createTaskResponse = JSON.parse(createTaskResult.content[0].text);
      taskId = createTaskResponse.task.id;

      // Register test agents
      await handlers.handleToolCall({
        params: {
          name: 'register_agent',
          arguments: {
            projectId,
            name: 'test-agent'
          }
        }
      });

      await handlers.handleToolCall({
        params: {
          name: 'register_agent',
          arguments: {
            projectId,
            name: 'test-agent-2'
          }
        }
      });
    });

    describe('assign_task', () => {
      it('should assign a task to an agent', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'test-agent',
              capabilities: ['testing']
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task).toBeDefined();
        expect(response.task.status).toBe('running');
        expect(response.task.assignedTo).toBe('test-agent');
      });

      it('should return null when no tasks available', async () => {
        // First assign the only task
        await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'test-agent'
            }
          }
        });

        // Try to assign again - should return null
        const result = await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'test-agent-2'
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task).toBeNull();
        expect(response.message).toBe('No tasks available for assignment');
      });
    });

    describe('complete_task', () => {
      it('should complete a task', async () => {
        // First assign the task
        await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'test-agent'
            }
          }
        });

        const result = await handlers.handleToolCall({
          params: {
            name: 'complete_task',
            arguments: {
              projectId,
              taskId,
              result: 'Task completed successfully',
              outputs: {
                key: 'value'
              }
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task.status).toBe('completed');
        expect(response.task.result).toBe('Task completed successfully');
        expect(response.task.outputs).toEqual({ key: 'value' });
      });
    });

    describe('fail_task', () => {
      it('should fail a task', async () => {
        // First assign the task
        await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'test-agent'
            }
          }
        });

        const result = await handlers.handleToolCall({
          params: {
            name: 'fail_task',
            arguments: {
              projectId,
              taskId,
              error: 'Task failed with error',
              canRetry: false
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.task.status).toBe('failed');
        expect(response.task.error).toBe('Task failed with error');
        expect(response.task.willRetry).toBe(false);
      });
    });
  });

  describe('Status and Monitoring Tools', () => {
    let projectId: string;

    beforeEach(async () => {
      // Create a test project
      const createResult = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'test-project',
            description: 'A test project'
          }
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      projectId = createResponse.project.id;
    });

    describe('get_project_stats', () => {
      it('should get project statistics', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'get_project_stats',
            arguments: {
              projectId
            }
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.projectId).toBe(projectId);
        expect(response.stats).toBeDefined();
        expect(response.stats.totalTasks).toBe(0);
      });
    });

    describe('health_check', () => {
      it('should return system health status', async () => {
        const result = await handlers.handleToolCall({
          params: {
            name: 'health_check',
            arguments: {}
          }
        });

        expect(result.isError).toBeFalsy();
        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.status).toBe('healthy');
        expect(response.storage).toBeDefined();
        expect(response.timestamp).toBeDefined();
      });
    });

    describe('Lease Management', () => {
      let leaseTaskId: string;
      let leaseTaskTypeId: string;

      beforeEach(async () => {
        // Create a task type for lease testing
        const createTaskTypeResult = await handlers.handleToolCall({
          params: {
            name: 'create_task_type',
            arguments: {
              projectId,
              name: 'lease-test-task-type'
            }
          }
        });
        const createTaskTypeResponse = JSON.parse(createTaskTypeResult.content[0].text);
        leaseTaskTypeId = createTaskTypeResponse.taskType.id;

        // Create and assign a task for lease testing
        const createResult = await handlers.handleToolCall({
          params: {
            name: 'create_task',
            arguments: {
              projectId,
              typeId: leaseTaskTypeId,
              instructions: 'Test task for lease management'
            }
          }
        });
        const createResponse = JSON.parse(createResult.content[0].text);
        leaseTaskId = createResponse.task.id;

        // Register an agent first
        await handlers.handleToolCall({
          params: {
            name: 'register_agent',
            arguments: {
              projectId,
              name: 'lease-test-agent'
            }
          }
        });

        // Assign the task
        await handlers.handleToolCall({
          params: {
            name: 'assign_task',
            arguments: {
              projectId,
              agentName: 'lease-test-agent'
            }
          }
        });
      });

      describe('extend_task_lease', () => {
        it('should extend a task lease', async () => {
          const result = await handlers.handleToolCall({
            params: {
              name: 'extend_task_lease',
              arguments: {
                taskId: leaseTaskId,
                extensionMinutes: 30
              }
            }
          });

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.taskId).toBe(leaseTaskId);
          expect(response.extensionMinutes).toBe(30);
        });
      });

      describe('get_lease_stats', () => {
        it('should get lease statistics for a project', async () => {
          const result = await handlers.handleToolCall({
            params: {
              name: 'get_lease_stats',
              arguments: {
                projectId
              }
            }
          });

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.projectId).toBe(projectId);
          expect(response.stats).toBeDefined();
          expect(response.stats.totalRunningTasks).toBeGreaterThanOrEqual(0);
          expect(response.stats.expiredTasks).toBeGreaterThanOrEqual(0);
          expect(response.stats.tasksByStatus).toBeDefined();
        });
      });

      describe('cleanup_expired_leases', () => {
        it('should cleanup expired leases for a project', async () => {
          const result = await handlers.handleToolCall({
            params: {
              name: 'cleanup_expired_leases',
              arguments: {
                projectId
              }
            }
          });

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.projectId).toBe(projectId);
          expect(typeof response.reclaimedTasks).toBe('number');
          expect(typeof response.cleanedAgents).toBe('number');
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown tool names', async () => {
      const result = await handlers.handleToolCall({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should handle validation errors gracefully', async () => {
      const result = await handlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: '', // Invalid empty name
            description: 'Test'
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation Error');
    });
  });
});