/**
 * Test pagination logic for list commands
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { listTasks } from '../../src/commands/definitions/task.js';
import { formatCommandResult } from '../../src/commands/formatters.js';
import { createStorageProvider } from '../../src/storage/index.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';

describe('Pagination Logic Tests', () => {
  const testDataDir = './test-pagination-data';
  let storage: any;
  let projectService: ProjectService;
  let taskService: TaskService;
  let taskTypeService: TaskTypeService;
  let context: any;
  let projectId: string;
  let taskTypeId: string;

  beforeEach(async () => {
    // Clean up any existing test data
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
    mkdirSync(testDataDir, { recursive: true });

    // Create storage provider
    storage = createStorageProvider({
      storage: {
        provider: 'file',
        fileStorage: {
          dataDir: testDataDir,
          lockTimeout: 5000
        }
      }
    } as any);

    await storage.initialize();

    // Create services
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);

    // Create context for commands
    context = {
      project: projectService,
      task: taskService,
      taskType: taskTypeService
    };

    // Create a test project
    const project = await projectService.createProject({
      name: 'test-pagination-project',
      description: 'Test project for pagination',
      instructions: 'Test instructions'
    });
    projectId = project.id;

    // Create a task type
    const taskType = await taskTypeService.createTaskType({
      projectId: projectId,
      name: 'test-task-type',
      template: 'Test task {{id}}'
    });
    taskTypeId = taskType.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should show correct pagination with 10 tasks, limit 5 and page numbers', async () => {
    // Create 10 tasks
    for (let i = 1; i <= 10; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    // Test first page (offset 0, limit 5)
    const result1 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 0
    });

    expect(result1.success).toBe(true);
    expect(result1.data.tasks).toHaveLength(5);
    expect(result1.data.pagination).toEqual({
      total: 10,
      offset: 0,
      limit: 5,
      rangeStart: 1,
      rangeEnd: 5,
      hasMore: true
    });

    // Test second page (offset 5, limit 5)
    const result2 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 5
    });

    expect(result2.success).toBe(true);
    expect(result2.data.tasks).toHaveLength(5);
    expect(result2.data.pagination).toEqual({
      total: 10,
      offset: 5,
      limit: 5,
      rangeStart: 6,
      rangeEnd: 10,
      hasMore: false
    });
  });

  it('should show correct pagination with 7 tasks, limit 5', async () => {
    // Create 7 tasks
    for (let i = 1; i <= 7; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    // Test first page (offset 0, limit 5)
    const result1 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 0
    });

    expect(result1.success).toBe(true);
    expect(result1.data.tasks).toHaveLength(5);
    expect(result1.data.pagination).toEqual({
      total: 7,
      offset: 0,
      limit: 5,
      rangeStart: 1,
      rangeEnd: 5,
      hasMore: true
    });

    // Test second page (offset 5, limit 5) - only 2 remaining
    const result2 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 5
    });

    expect(result2.success).toBe(true);
    expect(result2.data.tasks).toHaveLength(2);
    expect(result2.data.pagination).toEqual({
      total: 7,
      offset: 5,
      limit: 5,
      rangeStart: 6,
      rangeEnd: 7,
      hasMore: false
    });
  });

  it('should show correct pagination with 0 tasks', async () => {
    // No tasks created

    const result = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 0
    });

    expect(result.success).toBe(true);
    expect(result.data.tasks).toHaveLength(0);
    expect(result.data.pagination).toEqual({
      total: 0,
      offset: 0,
      limit: 5,
      rangeStart: 0,
      rangeEnd: 0,
      hasMore: false
    });
  });

  it('should show correct pagination when all tasks fit in one page', async () => {
    // Create 3 tasks with limit 5
    for (let i = 1; i <= 3; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    const result = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 5,
      offset: 0
    });

    expect(result.success).toBe(true);
    expect(result.data.tasks).toHaveLength(3);
    expect(result.data.pagination).toEqual({
      total: 3,
      offset: 0,
      limit: 5,
      rangeStart: 1,
      rangeEnd: 3,
      hasMore: false
    });
  });

  it('should handle large limit like -l 500 with 1800+ tasks', async () => {
    // Create 600 tasks to test large dataset scenario  
    for (let i = 1; i <= 600; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    // Test with limit 500 - should return 500 tasks, not 100
    const result = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 500,
      offset: 0
    });

    expect(result.success).toBe(true);
    expect(result.data.tasks).toHaveLength(500); // Should return exactly 500 tasks
    expect(result.data.pagination).toEqual({
      total: 600,
      offset: 0,
      limit: 500,
      rangeStart: 1,
      rangeEnd: 500,
      hasMore: true
    });
  });

  it('should show correct pagination with 250 tasks, limit 50 (5x test)', async () => {
    // Create 250 tasks to really test pagination
    for (let i = 1; i <= 250; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    // Test first page (offset 0, limit 50)
    const result1 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 50,
      offset: 0
    });

    expect(result1.success).toBe(true);
    expect(result1.data.tasks).toHaveLength(50);
    expect(result1.data.pagination).toEqual({
      total: 250,
      offset: 0,
      limit: 50,
      rangeStart: 1,
      rangeEnd: 50,
      hasMore: true
    });

    // Test page 3 (offset 100, limit 50) 
    const result2 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 50,
      offset: 100
    });

    expect(result2.success).toBe(true);
    expect(result2.data.tasks).toHaveLength(50);
    expect(result2.data.pagination).toEqual({
      total: 250,
      offset: 100,
      limit: 50,
      rangeStart: 101,
      rangeEnd: 150,
      hasMore: true
    });

    // Test last page (offset 200, limit 50) - should have 50 tasks
    const result3 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 50,
      offset: 200
    });

    expect(result3.success).toBe(true);
    expect(result3.data.tasks).toHaveLength(50);
    expect(result3.data.pagination).toEqual({
      total: 250,
      offset: 200,
      limit: 50,
      rangeStart: 201,
      rangeEnd: 250,
      hasMore: false
    });
  });

  it('should display page numbers in CLI output format', async () => {
    // Create 25 tasks
    for (let i = 1; i <= 25; i++) {
      await taskService.createTask({
        projectId: projectId,
        typeId: taskTypeId,
        instructions: `Task ${i}`,
        variables: { id: i.toString() }
      });
    }

    // Test first page (offset 0, limit 10) - should be page 1 of 3
    const result = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 10,
      offset: 0
    });

    const formatted = formatCommandResult(result, 'list-tasks', 'human');
    expect(formatted.text).toContain('Page (1) of (3)');
    
    // Test second page (offset 10, limit 10) - should be page 2 of 3
    const result2 = await listTasks.handler(context, {
      projectId: 'test-pagination-project',
      limit: 10,
      offset: 10
    });

    const formatted2 = formatCommandResult(result2, 'list-tasks', 'human');
    expect(formatted2.text).toContain('Page (2) of (3)');
  });
});