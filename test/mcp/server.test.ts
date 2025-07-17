import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { tools } from '../../src/tools/generated.js';
import { GeneratedToolHandlers } from '../../src/tools/generated.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('MCP Server Integration', () => {
  let storage: FileStorageProvider;
  let toolHandlers: GeneratedToolHandlers;
  let server: Server;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    toolHandlers = new GeneratedToolHandlers(storage);

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
        tools: tools
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await toolHandlers.handleToolCall(request);
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
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t: any) => t.name)).toContain('create_project');
      expect(tools.map((t: any) => t.name)).toContain('create_task');
      expect(tools.map((t: any) => t.name)).toContain('get_next_task');
    });

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

  describe('Tool Execution', () => {
    it('should execute create_project tool', async () => {
      const result = await toolHandlers.handleToolCall({
        method: 'tools/call',
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
      expect(response.data.name).toBe('integration-test-project');
    });

    it('should execute health_check tool', async () => {
      const result = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'health_check',
          arguments: {}
        }
      } as any);

      expect(result.content).toBeDefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.data.status).toBe('healthy');
    });
  });

  describe('End-to-End Workflow', () => {
    it('should support complete task workflow', async () => {
      // 1. Create project
      const projectResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'create_project',
          arguments: {
            name: 'workflow-test',
            description: 'Workflow test project'
          }
        }
      } as any);

      const projectResponse = JSON.parse(projectResult.content[0].text);
      const projectId = projectResponse.data.id;

      // 2. Create task type
      const taskTypeResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
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
      const taskTypeId = taskTypeResponse.data.id;

      // 3. Create task
      const taskResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: {
            projectId,
            type: taskTypeId,
            instructions: 'Process data with analysis method',
            variables: JSON.stringify({
              item: 'data',
              method: 'analysis'
            })
          }
        }
      } as any);

      const taskResponse = JSON.parse(taskResult.content[0].text);

      // 4. Get next task (no need to register agent in lease-based model)
      // 5. Assign task
      const assignResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'get_next_task',
          arguments: {
            projectId,
            agentName: 'workflow-agent'
          }
        }
      } as any);

      const assignResponse = JSON.parse(assignResult.content[0].text);
      expect(assignResponse.success).toBe(true);
      expect(assignResponse.data.assignedTo).toBe('workflow-agent');
      const assignedTaskId = assignResponse.data.id;
      expect(assignResponse.data.assignedAt).toBeDefined();
      expect(assignResponse.data.leaseExpiresAt).toBeDefined();

      // 6. Complete task
      const completeResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'complete_task',
          arguments: {
            agentName: 'workflow-agent',
            projectId,
            taskId: assignedTaskId,
            result: 'Task completed successfully',
            outputs: JSON.stringify({
              processed: 'data',
              method_used: 'analysis'
            })
          }
        }
      } as any);

      const completeResponse = JSON.parse(completeResult.content[0].text);
      if (!completeResponse.success) {
        console.log('Complete task failed:', completeResponse.error);
      }
      expect(completeResponse.success).toBe(true);
      expect(completeResponse.data.status).toBe('completed');
      expect(completeResponse.data.result.output).toBe('Task completed successfully');

      // 7. Verify project stats
      const statsResult = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'get_project_stats',
          arguments: {
            projectId
          }
        }
      } as any);

      const statsResponse = JSON.parse(statsResult.content[0].text);
      expect(statsResponse.success).toBe(true);
      expect(statsResponse.data.stats.project.stats.totalTasks).toBe(1);
      expect(statsResponse.data.stats.project.stats.completedTasks).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle tool call errors gracefully', async () => {
      const result = await toolHandlers.handleToolCall({
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      } as any);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should handle validation errors', async () => {
      const result = await toolHandlers.handleToolCall({
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
  });
});