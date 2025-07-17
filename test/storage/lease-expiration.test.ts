import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createMockProjectInput, createMockTaskTypeInput, createTestDataDir } from '../fixtures/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Lease Expiration Tests', () => {
  let storage: FileStorageProvider;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir('-lease-expiration');
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
  });

  afterEach(async () => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should reclaim expired leases when getNextTask is called', async () => {
    // Create a project and task type with a short lease (1 minute)
    const project = await storage.createProject(createMockProjectInput({ 
      name: 'test-project',
      config: {
        defaultMaxRetries: 3,
        defaultLeaseDurationMinutes: 1 // Very short lease for testing
      }
    }));
    const taskType = await storage.createTaskType(createMockTaskTypeInput({ 
      projectId: project.id, 
      name: 'test-task-type',
      template: 'Test task template',
      leaseDurationMinutes: 1 // Very short lease for testing
    }));

    // Create a task
    const task = await storage.createTask({
      projectId: project.id,
      typeId: taskType.id,
      instructions: 'Test task instructions',
      maxRetries: 3
    });

    // First agent gets the task
    const result1 = await storage.getNextTask(project.id, 'agent-1');
    expect(result1.task).toBeDefined();
    expect(result1.task!.id).toBe(task.id);
    expect(result1.task!.status).toBe('running');
    expect(result1.task!.assignedTo).toBe('agent-1');
    expect(result1.task!.leaseExpiresAt).toBeDefined();

    // Verify the task is in running state
    const runningTask = await storage.getTask(task.id);
    expect(runningTask!.status).toBe('running');
    expect(runningTask!.assignedTo).toBe('agent-1');

    // Manually expire the lease by setting it to past time
    const expiredTask = { 
      ...runningTask!,
      leaseExpiresAt: new Date(Date.now() - 1000) // 1 second ago
    };
    
    // Use internal method to directly update the task with expired lease
    await storage.updateTask(task.id, {
      leaseExpiresAt: expiredTask.leaseExpiresAt
    });

    // Verify the task lease is expired
    const taskWithExpiredLease = await storage.getTask(task.id);
    expect(taskWithExpiredLease!.status).toBe('running');
    expect(taskWithExpiredLease!.leaseExpiresAt!.getTime()).toBeLessThan(Date.now());

    // Debug: Log the actual expiration time vs current time
    // console.log('Current time:', new Date().toISOString());
    // console.log('Lease expires at:', new Date(taskWithExpiredLease!.leaseExpiresAt!).toISOString());
    // console.log('Is expired:', taskWithExpiredLease!.leaseExpiresAt!.getTime() <= Date.now());

    // Second agent requests a task - should reclaim the expired lease
    const result2 = await storage.getNextTask(project.id, 'agent-2');
    expect(result2.task).toBeDefined();
    expect(result2.task!.id).toBe(task.id); // Should be the same task
    expect(result2.task!.status).toBe('running');
    expect(result2.task!.assignedTo).toBe('agent-2'); // Should be assigned to new agent
    expect(result2.task!.leaseExpiresAt).toBeDefined();
    expect(result2.task!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now()); // Should have new lease

    // Verify the task is now assigned to the new agent
    const reassignedTask = await storage.getTask(task.id);
    expect(reassignedTask!.status).toBe('running');
    expect(reassignedTask!.assignedTo).toBe('agent-2');
    expect(reassignedTask!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should show lease as expired in task list but still assign to new agent', async () => {
    // Create a project and task type
    const project = await storage.createProject(createMockProjectInput({ name: 'test-project' }));
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

    // First agent gets the task
    const result1 = await storage.getNextTask(project.id, 'agent-1');
    expect(result1.task!.status).toBe('running');
    expect(result1.task!.assignedTo).toBe('agent-1');

    // Manually expire the lease
    await storage.updateTask(task.id, {
      leaseExpiresAt: new Date(Date.now() - 1000) // 1 second ago
    });

    // List tasks should show expired lease
    const tasksBeforeReclaim = await storage.listTasks(project.id, {});
    expect(tasksBeforeReclaim).toHaveLength(1);
    expect(tasksBeforeReclaim[0].status).toBe('running');
    expect(tasksBeforeReclaim[0].assignedTo).toBe('agent-1');
    expect(tasksBeforeReclaim[0].leaseExpiresAt!.getTime()).toBeLessThan(Date.now());

    // Second agent requests a task - should reclaim the expired lease
    const result2 = await storage.getNextTask(project.id, 'agent-2');
    expect(result2.task!.id).toBe(task.id);
    expect(result2.task!.assignedTo).toBe('agent-2');

    // List tasks should show new assignment
    const tasksAfterReclaim = await storage.listTasks(project.id, {});
    expect(tasksAfterReclaim).toHaveLength(1);
    expect(tasksAfterReclaim[0].status).toBe('running');
    expect(tasksAfterReclaim[0].assignedTo).toBe('agent-2');
    expect(tasksAfterReclaim[0].leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('should not reclaim non-expired leases', async () => {
    // Create a project and task type
    const project = await storage.createProject(createMockProjectInput({ name: 'test-project' }));
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

    // First agent gets the task
    const result1 = await storage.getNextTask(project.id, 'agent-1');
    expect(result1.task!.status).toBe('running');
    expect(result1.task!.assignedTo).toBe('agent-1');

    // Verify lease is not expired
    const taskWithLease = await storage.getTask(task.id);
    expect(taskWithLease!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // Second agent requests a task - should not get any task
    const result2 = await storage.getNextTask(project.id, 'agent-2');
    expect(result2.task).toBeNull();

    // Original task should still be assigned to agent-1
    const unchangedTask = await storage.getTask(task.id);
    expect(unchangedTask!.status).toBe('running');
    expect(unchangedTask!.assignedTo).toBe('agent-1');
  });

  it('should correctly deserialize dates and compare them', async () => {
    // Create a project and task type
    const project = await storage.createProject(createMockProjectInput({ name: 'test-project' }));
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

    // First agent gets the task
    const result1 = await storage.getNextTask(project.id, 'agent-1');
    expect(result1.task!.leaseExpiresAt).toBeInstanceOf(Date);
    
    // Verify date comparison works
    const now = new Date();
    const expiredDate = new Date(now.getTime() - 1000); // 1 second ago
    const futureDate = new Date(now.getTime() + 1000); // 1 second from now
    
    expect(expiredDate <= now).toBe(true);
    expect(futureDate <= now).toBe(false);
    expect(result1.task!.leaseExpiresAt! <= now).toBe(false);
    expect(result1.task!.leaseExpiresAt! > now).toBe(true);
    
    // Test that we can update the task with an expired lease
    await storage.updateTask(task.id, {
      leaseExpiresAt: expiredDate
    });

    // Verify the task now has expired lease
    const taskWithExpiredLease = await storage.getTask(task.id);
    expect(taskWithExpiredLease!.leaseExpiresAt).toBeInstanceOf(Date);
    expect(taskWithExpiredLease!.leaseExpiresAt! <= now).toBe(true);
    
    // Debug: Check the type and value
    // console.log('Task lease expires at type:', typeof taskWithExpiredLease!.leaseExpiresAt);
    // console.log('Task lease expires at value:', taskWithExpiredLease!.leaseExpiresAt);
    // console.log('Is instance of Date:', taskWithExpiredLease!.leaseExpiresAt instanceof Date);
    // console.log('Current time:', now);
    // console.log('Is expired (<=):', taskWithExpiredLease!.leaseExpiresAt! <= now);
  });

  it('should reclaim expired leases in bulk scenario', async () => {
    // Create a project and task type with very short lease (1 second)
    const project = await storage.createProject(createMockProjectInput({ name: 'test-project' }));
    const taskType = await storage.createTaskType(createMockTaskTypeInput({ 
      projectId: project.id, 
      name: 'test-task-type',
      template: 'Test task template',
      leaseDurationMinutes: 1/60 // 1 second
    }));

    // Create multiple tasks
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      const task = await storage.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: `Test task ${i}`,
        maxRetries: 3
      });
      tasks.push(task);
    }

    // Multiple agents get tasks
    const assignedTasks = [];
    for (let i = 0; i < 5; i++) {
      const result = await storage.getNextTask(project.id, `agent-${i}`);
      expect(result.task).toBeDefined();
      assignedTasks.push(result.task!);
    }

    // Wait for leases to expire
    await new Promise(resolve => setTimeout(resolve, 1100)); // 1.1 seconds

    // Verify all tasks have expired leases
    for (const task of assignedTasks) {
      const currentTask = await storage.getTask(task.id);
      expect(currentTask!.status).toBe('running');
      expect(currentTask!.leaseExpiresAt!.getTime()).toBeLessThan(Date.now());
    }

    // New agent should be able to get the first expired task
    const result = await storage.getNextTask(project.id, 'new-agent');
    expect(result.task).toBeDefined();
    expect(result.task!.assignedTo).toBe('new-agent');
    expect(result.task!.status).toBe('running');
    expect(result.task!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});