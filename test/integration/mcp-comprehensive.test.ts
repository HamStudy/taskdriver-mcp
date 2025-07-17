import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { MongoStorageProvider } from '../../src/storage/MongoStorageProvider.js';
import { RedisStorageProvider } from '../../src/storage/RedisStorageProvider.js';
import { tools } from '../../src/tools/generated.js';
import { GeneratedToolHandlers } from '../../src/tools/generated.js';
import { createTestDataDir } from '../fixtures/index.js';
import { StorageProvider } from '../../src/storage/StorageProvider.js';

/**
 * Comprehensive MCP Integration Tests
 * 
 * Tests all MCP tools across multiple storage providers:
 * - FileStorageProvider (single instance)
 * - MongoStorageProvider (multi-instance with transactions)
 * - RedisStorageProvider (distributed with atomic operations)
 */

interface TestContext {
  storage: StorageProvider;
  handlers: GeneratedToolHandlers;
  testDataDir?: string;
}

describe('MCP Integration - Comprehensive Tool Testing', () => {
  const storageProviders = [
    {
      name: 'FileStorage',
      createProvider: () => {
        const testDataDir = createTestDataDir();
        const storage = new FileStorageProvider(testDataDir);
        return { storage, testDataDir };
      },
      cleanup: (context: any) => {
        if (context.testDataDir && existsSync(context.testDataDir)) {
          rmSync(context.testDataDir, { recursive: true, force: true });
        }
      }
    },
    // TODO: Add MongoDB and Redis when available in test environment
    // {
    //   name: 'MongoStorage',
    //   createProvider: () => {
    //     const storage = new MongoStorageProvider({
    //       url: process.env.TEST_MONGODB_URL || 'mongodb://localhost:27017/taskdriver-test'
    //     });
    //     return { storage };
    //   },
    //   cleanup: () => {}
    // },
    // {
    //   name: 'RedisStorage', 
    //   createProvider: () => {
    //     const storage = new RedisStorageProvider({
    //       url: process.env.TEST_REDIS_URL || 'redis://localhost:6379'
    //     });
    //     return { storage };
    //   },
    //   cleanup: () => {}
    // }
  ];

  storageProviders.forEach(({ name, createProvider, cleanup }) => {
    describe(`Storage Provider: ${name}`, () => {
      let context: TestContext;

      beforeEach(async () => {
        const { storage, testDataDir } = createProvider();
        await storage.initialize();
        
        context = {
          storage,
          handlers: new GeneratedToolHandlers(storage),
          testDataDir
        };
      });

      afterEach(async () => {
        if (context.storage) {
          await context.storage.close();
        }
        cleanup(context);
      });

      describe('Tool Registration and Structure', () => {

        it('should have properly structured tool definitions', () => {
          tools.forEach(tool => {
            expect(tool.name).toBeDefined();
            expect(tool.description).toBeDefined();
            expect(tool.inputSchema).toBeDefined();
            expect(tool.inputSchema.type).toBe('object');
            expect(tool.inputSchema.properties).toBeDefined();
          });
        });
      });

      describe('Project Management Tools', () => {
        let projectId: string;

        it('should create project successfully', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'test-project',
                description: 'Test project description',
                instructions: 'Test project instructions'
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.name).toBe('test-project');
          expect(response.data.description).toBe('Test project description');
          
          projectId = response.data.id;
        });

        it('should list projects', async () => {
          // Create a project first
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'list-test-project',
                description: 'Project for list testing'
              }
            }
          } as any);
          
          expect(createResult.isError).toBeFalsy();
          const createResponse = JSON.parse(createResult.content[0].text);
          expect(createResponse.success).toBe(true);

          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'list_projects',
              arguments: {
                status: 'all' // Include all projects to avoid filtering issues
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(Array.isArray(response.data)).toBe(true);
          expect(response.data.length).toBeGreaterThan(0);
        });

        it('should get project by ID', async () => {
          // Create project
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'get-test-project',
                description: 'Project for get testing'
              }
            }
          } as any);

          const createResponse = JSON.parse(createResult.content[0].text);
          const projectId = createResponse.data.id;

          // Get project
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_project',
              arguments: {
                projectId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.id).toBe(projectId);
          expect(response.data.name).toBe('get-test-project');
        });

        it('should update project properties', async () => {
          // Create project
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'update-test-project',
                description: 'Original description'
              }
            }
          } as any);

          const createResponse = JSON.parse(createResult.content[0].text);
          const projectId = createResponse.data.id;

          // Update project
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'update_project',
              arguments: {
                projectId,
                description: 'Updated description',
                status: 'closed'
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.description).toBe('Updated description');
          expect(response.data.status).toBe('closed');
        });

        it('should get project statistics', async () => {
          // Create project
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'stats-test-project',
                description: 'Project for stats testing'
              }
            }
          } as any);

          const createResponse = JSON.parse(createResult.content[0].text);
          const projectId = createResponse.data.id;

          // Get stats
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_project_stats',
              arguments: {
                projectId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.projectId).toBe(projectId);
          expect(response.data.stats).toBeDefined();
        });
      });

      describe('Task Type Management Tools', () => {
        let projectId: string;

        beforeEach(async () => {
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'tasktype-test-project',
                description: 'Project for task type testing'
              }
            }
          } as any);

          const createResponse = JSON.parse(createResult.content[0].text);
          projectId = createResponse.data.id;
        });

        it('should create task type with template', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'test-task-type',
                template: 'Execute {{action}} on {{target}}',
                variables: ['action', 'target'],
                duplicateHandling: 'allow',
                maxRetries: 3,
                leaseDurationMinutes: 15
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.name).toBe('test-task-type');
          expect(response.data.template).toBe('Execute {{action}} on {{target}}');
          expect(response.data.variables).toEqual(['action', 'target']);
        });

        it('should list task types for project', async () => {
          // Create a task type first
          await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'list-test-task-type',
                template: 'Process {{item}}'
              }
            }
          } as any);

          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'list_task_types',
              arguments: {
                projectId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(Array.isArray(response.data)).toBe(true);
          expect(response.data.length).toBeGreaterThan(0);
        });

        it('should get task type by ID', async () => {
          // Create task type
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'get-test-task-type',
                template: 'Analyze {{data}}'
              }
            }
          } as any);

          const createResponse = JSON.parse(createResult.content[0].text);
          const taskTypeId = createResponse.data.id;

          // Get task type
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_task_type',
              arguments: {
                taskTypeId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.id).toBe(taskTypeId);
          expect(response.data.name).toBe('get-test-task-type');
        });
      });

      describe('Task Management Tools', () => {
        let projectId: string;
        let taskTypeId: string;

        beforeEach(async () => {
          // Create project
          const projectResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'task-test-project',
                description: 'Project for task testing'
              }
            }
          } as any);
          projectId = JSON.parse(projectResult.content[0].text).data.id;

          // Create task type
          const taskTypeResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'test-task-type',
                template: 'Process {{item}} with {{method}}'
              }
            }
          } as any);
          taskTypeId = JSON.parse(taskTypeResult.content[0].text).data.id;
        });

        it('should create single task', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                instructions: 'Process document with analysis',
                variables: JSON.stringify({
                  item: 'document',
                  method: 'analysis'
                })
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.projectId).toBe(projectId);
          expect(response.data.typeId).toBe(taskTypeId);
        });

        it('should create bulk tasks', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_tasks_bulk',
              arguments: {
                projectId,
                tasks: JSON.stringify([
                  {
                    type: taskTypeId,
                    instructions: 'Process document 1',
                    vars: { item: 'document1', method: 'analysis' }
                  },
                  {
                    type: taskTypeId,
                    instructions: 'Process document 2',
                    vars: { item: 'document2', method: 'review' }
                  }
                ])
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.tasksCreated).toBe(2);
          expect(response.data.createdTasks).toHaveLength(2);
        });

        it('should list tasks for project', async () => {
          // Create a task first
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                variables: JSON.stringify({ item: 'document', method: 'analysis' })
              }
            }
          } as any);
          
          expect(createResult.isError).toBeFalsy();
          const createResponse = JSON.parse(createResult.content[0].text);
          expect(createResponse.success).toBe(true);

          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'list_tasks',
              arguments: {
                projectId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(Array.isArray(response.data)).toBe(true);
          expect(response.data.length).toBeGreaterThan(0);
        });

        it('should get task by ID', async () => {
          // Create task
          const createResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                variables: JSON.stringify({ item: 'document', method: 'analysis' })
              }
            }
          } as any);

          expect(createResult.isError).toBeFalsy();
          const createResponse = JSON.parse(createResult.content[0].text);
          expect(createResponse.success).toBe(true);
          const taskId = createResponse.data.id;

          // Get task
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_task',
              arguments: {
                taskId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.id).toBe(taskId);
        });
      });

      describe('Agent Management Tools', () => {
        let projectId: string;
        let taskTypeId: string;
        let taskId: string;

        beforeEach(async () => {
          const projectResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'agent-test-project',
                description: 'Project for agent testing'
              }
            }
          } as any);
          projectId = JSON.parse(projectResult.content[0].text).data.id;

          // Create task type for testing
          const taskTypeResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'agent-test-task-type',
                template: 'Test {{operation}}'
              }
            }
          } as any);
          taskTypeId = JSON.parse(taskTypeResult.content[0].text).data.id;

          // Create a task for testing
          const taskResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                variables: JSON.stringify({ operation: 'analysis' })
              }
            }
          } as any);
          taskId = JSON.parse(taskResult.content[0].text).data.id;
        });

        it('should get next task from queue', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'test-agent'
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data).toBeDefined();
          expect(response.data.id).toBe(taskId);
          expect(response.data.assignedTo).toBe('test-agent');
          expect(response.agentName).toBe('test-agent');
        });

        it('should return error when no tasks available', async () => {
          // First, get the existing task
          await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'first-agent'
              }
            }
          } as any);

          // Try to get another task when none are available
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'second-agent'
              }
            }
          } as any);

          expect(result.isError).toBeTruthy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(false);
          expect(response.data).toBeNull();
          expect(response.agentName).toBe('second-agent');
          expect(response.error).toContain('No tasks available');
        });

        it('should list active agents when agents have tasks', async () => {
          // Get a task first to create an active agent
          await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'active-agent'
              }
            }
          } as any);

          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'list_active_agents',
              arguments: {
                projectId
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(Array.isArray(response.data)).toBe(true);
          expect(response.data.length).toBeGreaterThan(0);
          expect(response.data[0].name).toBe('active-agent');
          expect(response.data[0].currentTaskId).toBe(taskId);
        });
      });

      describe('Task Execution Workflow', () => {
        let projectId: string;
        let taskTypeId: string;
        let taskId: string;
        const agentName = 'execution-agent';

        beforeEach(async () => {
          // Setup complete workflow environment
          const projectResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'execution-test-project',
                description: 'Project for execution testing'
              }
            }
          } as any);
          projectId = JSON.parse(projectResult.content[0].text).data.id;

          const taskTypeResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'execution-task-type',
                template: 'Execute {{operation}}'
              }
            }
          } as any);
          taskTypeId = JSON.parse(taskTypeResult.content[0].text).data.id;

          const taskResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                instructions: 'Execute analysis operation',
                variables: JSON.stringify({ operation: 'analysis' })
              }
            }
          } as any);
          taskId = JSON.parse(taskResult.content[0].text).data.id;
        });

        it('should get next task and assign to agent', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data).toBeDefined();
          expect(response.data.id).toBe(taskId);
          expect(response.data.assignedTo).toBe(agentName);
          expect(response.data.assignedAt).toBeDefined();
          expect(response.agentName).toBe(agentName);
        });

        it('should complete assigned task', async () => {
          // First get the task
          await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName
              }
            }
          } as any);

          // Then complete it
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'complete_task',
              arguments: {
                agentName,
                projectId,
                taskId,
                result: 'Task completed successfully',
                outputs: JSON.stringify({
                  analysisResult: 'positive',
                  confidence: 0.95
                })
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.status).toBe('completed');
          expect(response.data.result.output).toBe('Task completed successfully');
        });

        it('should fail task with error', async () => {
          // First get the task
          await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName
              }
            }
          } as any);

          // Then fail it
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'fail_task',
              arguments: {
                agentName,
                projectId,
                taskId,
                error: 'Task failed due to invalid input',
                canRetry: false
              }
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.status).toBe('failed');
          expect(response.data.result.error).toBe('Task failed due to invalid input');
        });
      });

      describe('System and Monitoring Tools', () => {
        it('should perform health check', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'health_check',
              arguments: {}
            }
          } as any);

          expect(result.isError).toBeFalsy();
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(true);
          expect(response.data.status).toBe('healthy');
          expect(response.data.storage).toBeDefined();
          expect(response.data.timestamp).toBeDefined();
        });

        describe('Lease Management', () => {
          let projectId: string;
          let taskId: string;
          let agentName: string;

          beforeEach(async () => {
            // Setup for lease testing
            const projectResult = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'create_project',
                arguments: {
                  name: 'lease-test-project',
                  description: 'Project for lease testing'
                }
              }
            } as any);
            projectId = JSON.parse(projectResult.content[0].text).data.id;

            const taskTypeResult = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'create_task_type',
                arguments: {
                  projectId,
                  name: 'lease-task-type',
                  template: 'Long running {{task}}'
                }
              }
            } as any);
            const taskTypeId = JSON.parse(taskTypeResult.content[0].text).data.id;

            const taskResult = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'create_task',
                arguments: {
                  projectId,
                  type: taskTypeId,
                  variables: JSON.stringify({ task: 'document analysis' })
                }
              }
            } as any);
            taskId = JSON.parse(taskResult.content[0].text).data.id;

            agentName = 'lease-agent';

            // Get the task to assign it to the agent
            await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'get_next_task',
                arguments: {
                  projectId,
                  agentName
                }
              }
            } as any);
          });

          it('should extend task lease', async () => {
            const result = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'extend_task_lease',
                arguments: {
                  taskId,
                  extensionMinutes: 30
                }
              }
            } as any);

            expect(result.isError).toBeFalsy();
            const response = JSON.parse(result.content[0].text);
            expect(response.success).toBe(true);
            expect(response.data.taskId).toBe(taskId);
            expect(response.data.extensionMinutes).toBe(30);
          });

          it('should get lease statistics', async () => {
            const result = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'get_lease_stats',
                arguments: {
                  projectId
                }
              }
            } as any);

            expect(result.isError).toBeFalsy();
            const response = JSON.parse(result.content[0].text);
            expect(response.success).toBe(true);
            expect(response.data.projectId).toBe(projectId);
            expect(response.data.stats).toBeDefined();
            expect(response.data.stats.totalRunningTasks).toBeGreaterThanOrEqual(0);
          });

          it('should cleanup expired leases', async () => {
            const result = await context.handlers.handleToolCall({
              method: 'tools/call',
              params: {
                name: 'cleanup_expired_leases',
                arguments: {
                  projectId
                }
              }
            } as any);

            expect(result.isError).toBeFalsy();
            const response = JSON.parse(result.content[0].text);
            expect(response.success).toBe(true);
            expect(response.data.projectId).toBe(projectId);
            expect(typeof response.data.reclaimedTasks).toBe('number');
            expect(typeof response.data.cleanedAgents).toBe('number');
          });
        });
      });

      describe('Error Handling and Validation', () => {
        it('should handle unknown tool names', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'unknown_tool',
              arguments: {}
            }
          } as any);

          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain('Unknown tool');
        });

        it('should validate required parameters', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: '',
                description: 'Test'
              }
            }
          } as any);

          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain('Validation failed');
        });

        it('should handle non-existent project references', async () => {
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_project',
              arguments: {
                projectId: 'non-existent-project-id'
              }
            }
          } as any);

          expect(result.isError).toBe(true);
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(false);
          expect(response.error).toContain('not found');
        });

        it('should handle malformed JSON in string parameters', async () => {
          // Create project and task type first
          const projectResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'json-test-project',
                description: 'Project for JSON testing'
              }
            }
          } as any);
          const projectId = JSON.parse(projectResult.content[0].text).data.id;

          const taskTypeResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'json-task-type',
                template: 'Process {{item}}'
              }
            }
          } as any);
          const taskTypeId = JSON.parse(taskTypeResult.content[0].text).data.id;

          // Try to create task with invalid JSON
          const result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task',
              arguments: {
                projectId,
                type: taskTypeId,
                instructions: 'Test task',
                variables: 'invalid-json-string'
              }
            }
          } as any);

          expect(result.isError).toBe(true);
          const response = JSON.parse(result.content[0].text);
          expect(response.success).toBe(false);
          expect(response.error).toContain('JSON');
        });
      });

      describe('Complete End-to-End Workflow', () => {
        it('should execute complete project lifecycle', async () => {
          // 1. Create project
          const projectResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_project',
              arguments: {
                name: 'e2e-workflow-project',
                description: 'Complete end-to-end workflow test',
                instructions: 'This project tests the complete workflow from creation to completion'
              }
            }
          } as any);
          const projectResponse = JSON.parse(projectResult.content[0].text);
          const projectId = projectResponse.data.id;

          // 2. Create task type
          const taskTypeResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_task_type',
              arguments: {
                projectId,
                name: 'e2e-task-type',
                template: 'Analyze {{document}} using {{method}} approach',
                variables: ['document', 'method'],
                maxRetries: 2,
                leaseDurationMinutes: 20
              }
            }
          } as any);
          const taskTypeResponse = JSON.parse(taskTypeResult.content[0].text);
          const taskTypeId = taskTypeResponse.data.id;

          // 3. Create multiple tasks
          const bulkTaskResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'create_tasks_bulk',
              arguments: {
                projectId,
                tasks: JSON.stringify([
                  {
                    type: taskTypeId,
                    instructions: 'Analyze document A',
                    vars: { document: 'docA.pdf', method: 'statistical' }
                  },
                  {
                    type: taskTypeId,
                    instructions: 'Analyze document B',
                    vars: { document: 'docB.pdf', method: 'semantic' }
                  }
                ])
              }
            }
          } as any);
          const bulkTaskResponse = JSON.parse(bulkTaskResult.content[0].text);
          expect(bulkTaskResponse.data.tasksCreated).toBe(2);

          // 4. Get tasks for multiple agents
          const get1Result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'statistical-agent'
              }
            }
          } as any);
          const get1Response = JSON.parse(get1Result.content[0].text);
          expect(get1Response.success).toBe(true);
          expect(get1Response.data).toBeDefined();
          const task1Id = get1Response.data.id;

          const get2Result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_next_task',
              arguments: {
                projectId,
                agentName: 'semantic-agent'
              }
            }
          } as any);
          const get2Response = JSON.parse(get2Result.content[0].text);
          expect(get2Response.success).toBe(true);
          expect(get2Response.data).toBeDefined();
          const task2Id = get2Response.data.id;

          // 6. Complete one task, fail another
          const complete1Result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'complete_task',
              arguments: {
                agentName: 'statistical-agent',
                projectId,
                taskId: task1Id,
                result: 'Statistical analysis completed successfully',
                outputs: JSON.stringify({
                  mean: 85.6,
                  stdDev: 12.3,
                  confidence: 0.95
                })
              }
            }
          } as any);
          expect(JSON.parse(complete1Result.content[0].text).success).toBe(true);

          const fail2Result = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'fail_task',
              arguments: {
                agentName: 'semantic-agent',
                projectId,
                taskId: task2Id,
                error: 'Document format not supported',
                canRetry: false
              }
            }
          } as any);
          expect(JSON.parse(fail2Result.content[0].text).success).toBe(true);

          // 7. Verify final project statistics
          const finalStatsResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'get_project_stats',
              arguments: {
                projectId
              }
            }
          } as any);
          const finalStatsResponse = JSON.parse(finalStatsResult.content[0].text);
          expect(finalStatsResponse.success).toBe(true);
          expect(finalStatsResponse.data.stats.project.stats.totalTasks).toBe(2);
          expect(finalStatsResponse.data.stats.project.stats.completedTasks).toBe(1);
          expect(finalStatsResponse.data.stats.project.stats.failedTasks).toBe(1);

          // 8. List final task states
          const finalTasksResult = await context.handlers.handleToolCall({
            method: 'tools/call',
            params: {
              name: 'list_tasks',
              arguments: {
                projectId,
                includeCompleted: true
              }
            }
          } as any);
          const finalTasksResponse = JSON.parse(finalTasksResult.content[0].text);
          expect(finalTasksResponse.success).toBe(true);
          expect(finalTasksResponse.data).toHaveLength(2);

          // Verify task states
          const completedTasks = finalTasksResponse.data.filter((t: any) => t.status === 'completed');
          const failedTasks = finalTasksResponse.data.filter((t: any) => t.status === 'failed');
          expect(completedTasks).toHaveLength(1);
          expect(failedTasks).toHaveLength(1);
        });
      });
    });
  });
});