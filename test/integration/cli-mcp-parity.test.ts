import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { GeneratedToolHandlers } from '../../src/tools/generated.js';
import { createServiceContext } from '../../src/commands/context.js';
import { createMockProjectInput, createMockTaskTypeInput, createTestDataDir } from '../fixtures/index.js';
import * as fs from 'fs';

describe('CLI vs MCP Parity Tests', () => {
  let storage: FileStorageProvider;
  let testDataDir: string;
  let mcpHandlers: GeneratedToolHandlers;
  let cliContext: ReturnType<typeof createServiceContext>;

  beforeEach(async () => {
    testDataDir = createTestDataDir('-cli-mcp-parity');
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    // Create MCP handlers (simulates MCP server)
    mcpHandlers = new GeneratedToolHandlers(storage);
    
    // Create CLI context (simulates CLI)
    cliContext = createServiceContext(storage);
  });

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should handle expired lease reclamation identically in CLI and MCP', async () => {
    // Create project and task type
    const project = await storage.createProject(createMockProjectInput({ 
      name: 'test-project',
      config: {
        defaultMaxRetries: 3,
        defaultLeaseDurationMinutes: 1
      }
    }));
    const taskType = await storage.createTaskType(createMockTaskTypeInput({ 
      projectId: project.id, 
      name: 'test-task-type',
      template: 'Test task template'
    }));

    // Create a task
    const task = await storage.createTask({
      projectId: project.id,
      typeId: taskType.id,
      instructions: 'Test task instructions',
      maxRetries: 3
    });

    // First agent gets the task via CLI
    const cliResult1 = await cliContext.agent.getNextTask(project.id, 'cli-agent-1');
    expect(cliResult1.task).toBeDefined();
    expect(cliResult1.task!.id).toBe(task.id);
    expect(cliResult1.task!.assignedTo).toBe('cli-agent-1');

    // Manually expire the lease
    await storage.updateTask(task.id, {
      leaseExpiresAt: new Date(Date.now() - 1000) // 1 second ago
    });

    // Second agent gets the task via MCP
    const mcpResult = await mcpHandlers.handleToolCall({
      method: 'tools/call',
      params: {
        name: 'get_next_task',
        arguments: {
          projectId: project.id,
          agentName: 'mcp-agent-2'
        }
      }
    });

    expect(mcpResult.isError).toBe(false);
    expect(mcpResult.content).toBeDefined();
    expect(mcpResult.content[0]).toBeDefined();
    
    const mcpResponseText = mcpResult.content[0].text;
    expect(typeof mcpResponseText).toBe('string');
    
    const mcpResponse = JSON.parse(mcpResponseText);
    expect(mcpResponse.success).toBe(true);
    expect(mcpResponse.data).toBeDefined();
    expect(mcpResponse.data.id).toBe(task.id);
    expect(mcpResponse.data.assignedTo).toBe('mcp-agent-2');

    // Verify task was properly reassigned
    const finalTask = await storage.getTask(task.id);
    expect(finalTask!.assignedTo).toBe('mcp-agent-2');
    expect(finalTask!.status).toBe('running');
    expect(finalTask!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should both detect no available tasks when queue is empty', async () => {
    const project = await storage.createProject(createMockProjectInput({ name: 'empty-project' }));

    // CLI should return no task
    const cliResult = await cliContext.agent.getNextTask(project.id, 'cli-agent');
    expect(cliResult.task).toBeNull();

    // MCP should return no task
    const mcpResult = await mcpHandlers.handleToolCall({
      method: 'tools/call',
      params: {
        name: 'get_next_task',
        arguments: {
          projectId: project.id,
          agentName: 'mcp-agent'
        }
      }
    });

    // MCP sets isError: true when command returns success: false
    // This is correct behavior - no tasks available is reported as an error state
    expect(mcpResult.isError).toBe(true);
    const mcpResponse = JSON.parse(mcpResult.content[0].text);
    expect(mcpResponse.success).toBe(false);
    expect(mcpResponse.data).toBeNull();
  });

  it('should handle multiple concurrent expired lease reclamations consistently', async () => {
    // Create project and task type
    const project = await storage.createProject(createMockProjectInput({ name: 'concurrent-test' }));
    const taskType = await storage.createTaskType(createMockTaskTypeInput({ 
      projectId: project.id, 
      name: 'test-task-type',
      template: 'Test task template'
    }));

    // Create multiple tasks
    const tasks = [];
    for (let i = 0; i < 3; i++) {
      const task = await storage.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: `Test task ${i}`,
        maxRetries: 3
      });
      tasks.push(task);
    }

    // Assign all tasks to initial agents
    for (let i = 0; i < 3; i++) {
      const result = await cliContext.agent.getNextTask(project.id, `initial-agent-${i}`);
      expect(result.task).toBeDefined();
      expect(result.task!.id).toBe(tasks[i].id);
    }

    // Expire all leases
    for (const task of tasks) {
      await storage.updateTask(task.id, {
        leaseExpiresAt: new Date(Date.now() - 1000)
      });
    }

    // Mix of CLI and MCP should both be able to reclaim expired tasks
    const cliResult = await cliContext.agent.getNextTask(project.id, 'cli-reclaim-agent');
    expect(cliResult.task).toBeDefined();
    expect(cliResult.task!.assignedTo).toBe('cli-reclaim-agent');

    const mcpResult = await mcpHandlers.handleToolCall({
      method: 'tools/call',
      params: {
        name: 'get_next_task',
        arguments: {
          projectId: project.id,
          agentName: 'mcp-reclaim-agent'
        }
      }
    });

    expect(mcpResult.isError).toBe(false);
    const mcpResponse = JSON.parse(mcpResult.content[0].text);
    expect(mcpResponse.success).toBe(true);
    expect(mcpResponse.data.assignedTo).toBe('mcp-reclaim-agent');

    // Both should have reclaimed different tasks
    expect(cliResult.task!.id).not.toBe(mcpResponse.data.id);
  });
});