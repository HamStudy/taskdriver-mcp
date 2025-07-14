import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { allTools } from '../../src/tools/index.js';
import { ToolHandlers } from '../../src/tools/handlers.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('MCP Server Integration', () => {
  let storage: FileStorageProvider;
  let toolHandlers: ToolHandlers;
  let server: Server;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    toolHandlers = new ToolHandlers(storage);

    // Create MCP server
    server = new Server(
      {
        name: 'taskdriver-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allTools
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { params } = request;
      return await toolHandlers.handleToolCall(params);
    });
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Tool Registration', () => {
    it('should register all tools', async () => {
      // Test the tools list directly
      expect(allTools).toBeDefined();
      expect(allTools.length).toBeGreaterThan(0);
      expect(allTools.map((t: any) => t.name)).toContain('create_project');
      expect(allTools.map((t: any) => t.name)).toContain('create_task');
      expect(allTools.map((t: any) => t.name)).toContain('register_agent');
    });

    it('should have properly structured tool definitions', () => {
      allTools.forEach(tool => {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      });
    });
  });

  describe('Tool Execution', () => {
    it('should execute create_project tool', async () => {
      const result = await toolHandlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'integration-test-project',
            description: 'Integration test project'
          }
        }
      } as any);

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.project.name).toBe('integration-test-project');
    });

    it('should execute health_check tool', async () => {
      const result = await toolHandlers.handleToolCall({
        params: {
          name: 'health_check',
          arguments: {}
        }
      } as any);

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.status).toBe('healthy');
    });
  });

  describe('End-to-End Workflow', () => {
    it('should support complete task workflow', async () => {
      // 1. Create project
      const projectResult = await toolHandlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: 'workflow-test',
            description: 'Workflow test project'
          }
        }
      } as any);

      const projectResponse = JSON.parse(projectResult.content[0].text);
      const projectId = projectResponse.project.id;

      // 2. Create task type
      const taskTypeResult = await toolHandlers.handleToolCall({
        params: {
          name: 'create_task_type',
          arguments: {
            projectId,
            name: 'workflow-task-type',
            template: 'Process {{item}} with {{method}}'
          }
        }
      } as any);

      const taskTypeResponse = JSON.parse(taskTypeResult.content[0].text);
      const taskTypeId = taskTypeResponse.taskType.id;

      // 3. Create task
      const taskResult = await toolHandlers.handleToolCall({
        params: {
          name: 'create_task',
          arguments: {
            projectId,
            typeId: taskTypeId,
            instructions: 'Process data with analysis method',
            variables: {
              item: 'data',
              method: 'analysis'
            }
          }
        }
      } as any);

      const taskResponse = JSON.parse(taskResult.content[0].text);
      const taskId = taskResponse.task.id;

      // 4. Register agent
      const agentResult = await toolHandlers.handleToolCall({
        params: {
          name: 'register_agent',
          arguments: {
            projectId,
            name: 'workflow-agent'
          }
        }
      } as any);

      const agentResponse = JSON.parse(agentResult.content[0].text);
      expect(agentResponse.success).toBe(true);

      // 5. Assign task
      const assignResult = await toolHandlers.handleToolCall({
        params: {
          name: 'assign_task',
          arguments: {
            projectId,
            agentName: 'workflow-agent'
          }
        }
      } as any);

      const assignResponse = JSON.parse(assignResult.content[0].text);
      expect(assignResponse.success).toBe(true);
      expect(assignResponse.task.status).toBe('running');
      expect(assignResponse.task.assignedTo).toBe('workflow-agent');

      // 6. Complete task
      const completeResult = await toolHandlers.handleToolCall({
        params: {
          name: 'complete_task',
          arguments: {
            projectId,
            taskId,
            result: 'Task completed successfully',
            outputs: {
              processed: 'data',
              method_used: 'analysis'
            }
          }
        }
      } as any);

      const completeResponse = JSON.parse(completeResult.content[0].text);
      expect(completeResponse.success).toBe(true);
      expect(completeResponse.task.status).toBe('completed');
      expect(completeResponse.task.result).toBe('Task completed successfully');

      // 7. Verify project stats
      const statsResult = await toolHandlers.handleToolCall({
        params: {
          name: 'get_project_stats',
          arguments: {
            projectId
          }
        }
      } as any);

      const statsResponse = JSON.parse(statsResult.content[0].text);
      expect(statsResponse.success).toBe(true);
      expect(statsResponse.stats.totalTasks).toBe(1);
      expect(statsResponse.stats.completedTasks).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle tool call errors gracefully', async () => {
      const result = await toolHandlers.handleToolCall({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      } as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });

    it('should handle validation errors', async () => {
      const result = await toolHandlers.handleToolCall({
        params: {
          name: 'create_project',
          arguments: {
            name: '',
            description: 'Test'
          }
        }
      } as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation Error');
    });
  });
});