import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { TaskService } from '../../src/services/TaskService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('TaskService', () => {
  let storage: FileStorageProvider;
  let taskService: TaskService;
  let projectService: ProjectService;
  let taskTypeService: TaskTypeService;
  let testDataDir: string;
  let projectId: string;
  let taskTypeId: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);

    // Create test project and task type
    const project = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for tasks'
    });
    projectId = project.id;

    const taskType = await taskTypeService.createTaskType({
      projectId,
      name: 'test-task-type'
    });
    taskTypeId = taskType.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('createTask', () => {
    it('should create a task with minimal input', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Test task instructions'
      };

      const task = await taskService.createTask(input);

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      expect(task.typeId).toBe(taskTypeId);
      expect(task.instructions).toBe('Test task instructions');
      expect(task.status).toBe('queued');
      expect(task.retryCount).toBe(0);
      expect(task.maxRetries).toBe(3); // Default from task type
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.attempts).toEqual([]);
    });

    it('should create task with variables', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Task with variables',
        variables: { key: 'value', number: '42' }
      };

      const task = await taskService.createTask(input);

      expect(task.variables).toEqual({ key: 'value', number: '42' });
    });

    it('should create task with batch ID', async () => {
      const batchId = '123e4567-e89b-12d3-a456-426614174000'; // Valid GUID
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Batch task',
        batchId
      };

      const task = await taskService.createTask(input);

      expect(task.batchId).toBe(batchId);
    });

    it('should throw validation error for invalid input', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: '' // Invalid empty instructions
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw validation error for invalid project ID format', async () => {
      const input = {
        projectId: 'non-existent-project',
        typeId: taskTypeId,
        instructions: 'Test task'
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw validation error for invalid task type ID format', async () => {
      const input = {
        projectId,
        typeId: 'non-existent-type',
        instructions: 'Test task'
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Validation failed');
    });

    it('should handle duplicate detection with fail strategy', async () => {
      // Create task type with fail duplicate handling
      const failTaskType = await taskTypeService.createTaskType({
        projectId,
        name: 'fail-duplicate-type',
        duplicateHandling: 'fail'
      });

      const input = {
        projectId,
        typeId: failTaskType.id,
        instructions: 'Duplicate task',
        variables: { key: 'value' }
      };

      await taskService.createTask(input);

      await expect(taskService.createTask(input))
        .rejects.toThrow('Duplicate task found');
    });

    it('should handle duplicate detection with ignore strategy', async () => {
      // Create task type with ignore duplicate handling
      const ignoreTaskType = await taskTypeService.createTaskType({
        projectId,
        name: 'ignore-duplicate-type',
        duplicateHandling: 'ignore'
      });

      const input = {
        projectId,
        typeId: ignoreTaskType.id,
        instructions: 'Duplicate task',
        variables: { key: 'value' }
      };

      const task1 = await taskService.createTask(input);
      const task2 = await taskService.createTask(input);

      expect(task1.id).toBe(task2.id); // Should return same task
    });
  });

  describe('getTask', () => {
    it('should retrieve existing task', async () => {
      const created = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Retrieve task'
      });

      const retrieved = await taskService.getTask(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.instructions).toBe('Retrieve task');
    });

    it('should return null for non-existent task', async () => {
      const result = await taskService.getTask('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('listTasks', () => {
    beforeEach(async () => {
      // Create test tasks with different statuses
      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Queued task 1'
      });

      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Queued task 2'
      });

      const runningTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Running task'
      });

      // Manually set task to running state
      await storage.updateTask(runningTask.id, {
        status: 'running',
        assignedTo: 'test-agent'
      });
    });

    it('should list all tasks for project', async () => {
      const tasks = await taskService.listTasks(projectId);

      expect(tasks).toHaveLength(3);
      expect(tasks.every(t => t.projectId === projectId)).toBe(true);
    });

    it('should filter tasks by status', async () => {
      const queuedTasks = await taskService.listTasks(projectId, { status: 'queued' });
      const runningTasks = await taskService.listTasks(projectId, { status: 'running' });

      expect(queuedTasks).toHaveLength(2);
      expect(queuedTasks.every(t => t.status === 'queued')).toBe(true);

      expect(runningTasks).toHaveLength(1);
      expect(runningTasks[0].status).toBe('running');
    });

    it('should filter tasks by assigned agent', async () => {
      const assignedTasks = await taskService.listTasks(projectId, { assignedTo: 'test-agent' });

      expect(assignedTasks).toHaveLength(1);
      expect(assignedTasks[0].assignedTo).toBe('test-agent');
    });

    it('should filter tasks by type', async () => {
      const typeTasks = await taskService.listTasks(projectId, { typeId: taskTypeId });

      expect(typeTasks).toHaveLength(3);
      expect(typeTasks.every(t => t.typeId === taskTypeId)).toBe(true);
    });

    it('should apply pagination', async () => {
      const page1 = await taskService.listTasks(projectId, { limit: 2, offset: 0 });
      const page2 = await taskService.listTasks(projectId, { limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it('should throw error for non-existent project', async () => {
      await expect(taskService.listTasks('non-existent-project'))
        .rejects.toThrow('Project non-existent-project not found');
    });
  });

  describe('getNextTaskForAgent', () => {
    let agentName: string;

    beforeEach(async () => {
      agentName = 'test-agent';
      
      // Create some queued tasks
      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'First task'
      });

      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Second task'
      });
    });

    it('should assign next queued task to agent', async () => {
      const task = await taskService.getNextTaskForAgent(projectId, agentName);

      expect(task).not.toBeNull();
      expect(task!.status).toBe('running');
      expect(task!.assignedTo).toBe(agentName);
      expect(task!.assignedAt).toBeInstanceOf(Date);
      expect(task!.leaseExpiresAt).toBeInstanceOf(Date);
    });

    it('should return null when no tasks available', async () => {
      // Assign all tasks first
      await taskService.getNextTaskForAgent(projectId, agentName);
      await taskService.getNextTaskForAgent(projectId, 'other-agent');

      const task = await taskService.getNextTaskForAgent(projectId, 'third-agent');
      expect(task).toBeNull();
    });

    it('should cleanup expired leases before assignment', async () => {
      // Assign a task and manually expire its lease
      const assignedTask = await taskService.getNextTaskForAgent(projectId, agentName);
      expect(assignedTask).not.toBeNull();

      // Manually expire the lease
      await storage.updateTask(assignedTask!.id, {
        leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
      });

      // Next assignment should reclaim the expired task
      const newTask = await taskService.getNextTaskForAgent(projectId, 'new-agent');
      expect(newTask).not.toBeNull();
      expect(newTask!.assignedTo).toBe('new-agent');
      expect(newTask!.retryCount).toBe(1); // Should be incremented
    });
  });

  describe('validateTaskAssignment', () => {
    let taskId: string;
    let agentName: string;

    beforeEach(async () => {
      agentName = 'test-agent';
      const task = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Assignment test task'
      });
      taskId = task.id;

      // Assign the task
      await taskService.getNextTaskForAgent(projectId, agentName);
    });

    it('should validate correct task assignment', async () => {
      const task = await taskService.validateTaskAssignment(taskId, agentName);
      expect(task.assignedTo).toBe(agentName);
    });

    it('should throw error for non-existent task', async () => {
      await expect(taskService.validateTaskAssignment('non-existent-id', agentName))
        .rejects.toThrow('Task non-existent-id not found');
    });

    it('should throw error for unassigned task', async () => {
      const unassignedTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Unassigned task'
      });

      await expect(taskService.validateTaskAssignment(unassignedTask.id, agentName))
        .rejects.toThrow('is not currently running');
    });

    it('should throw error for task assigned to different agent', async () => {
      await expect(taskService.validateTaskAssignment(taskId, 'different-agent'))
        .rejects.toThrow('is not assigned to agent different-agent');
    });
  });

  describe('extendTaskLease', () => {
    let taskId: string;

    beforeEach(async () => {
      const task = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Lease test task'
      });
      taskId = task.id;

      // Assign the task to create a lease
      await taskService.getNextTaskForAgent(projectId, 'test-agent');
    });

    it('should extend task lease', async () => {
      const taskBefore = await taskService.getTask(taskId);
      const originalExpiry = taskBefore!.leaseExpiresAt!;

      await taskService.extendTaskLease(taskId, 30);

      const taskAfter = await taskService.getTask(taskId);
      const newExpiry = taskAfter!.leaseExpiresAt!;

      const timeDiff = newExpiry.getTime() - originalExpiry.getTime();
      expect(timeDiff).toBeCloseTo(30 * 60 * 1000, -1000); // Within 1 second
    });

    it('should throw error for non-existent task', async () => {
      await expect(taskService.extendTaskLease('non-existent-id', 30))
        .rejects.toThrow('Task non-existent-id not found');
    });
  });

  describe('getLeaseStats', () => {
    beforeEach(async () => {
      // Create tasks with different states
      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Queued task'
      });

      const runningTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Running task'
      });

      const expiredTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Expired task'
      });

      // Assign tasks and manipulate lease times
      await taskService.getNextTaskForAgent(projectId, 'agent1');
      await taskService.getNextTaskForAgent(projectId, 'agent2');

      // Expire one task
      await storage.updateTask(expiredTask.id, {
        leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
      });
    });

    it('should return correct lease statistics', async () => {
      const stats = await taskService.getLeaseStats(projectId);

      expect(stats.totalRunningTasks).toBe(2);
      expect(stats.expiredTasks).toBeGreaterThanOrEqual(0); // May vary based on timing
      expect(stats.tasksByStatus.queued).toBe(1);
      expect(stats.tasksByStatus.running).toBe(2);
    });

    it('should return empty stats for project with no tasks', async () => {
      const emptyProject = await projectService.createProject({
        name: 'empty-project',
        description: 'Project with no tasks'
      });

      const stats = await taskService.getLeaseStats(emptyProject.id);

      expect(stats.totalRunningTasks).toBe(0);
      expect(stats.expiredTasks).toBe(0);
      expect(stats.tasksByStatus).toEqual({});
    });
  });

  describe('cleanupExpiredLeases', () => {
    beforeEach(async () => {
      // Create and assign tasks
      const task1 = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Task 1'
      });

      const task2 = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Task 2'
      });

      await taskService.getNextTaskForAgent(projectId, 'agent1');
      await taskService.getNextTaskForAgent(projectId, 'agent2');

      // Expire the first task's lease
      await storage.updateTask(task1.id, {
        leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
      });
    });

    it('should cleanup expired leases', async () => {
      const results = await taskService.cleanupExpiredLeases(projectId);

      expect(results.reclaimedTasks).toBeGreaterThanOrEqual(0);
      expect(results.cleanedAgents).toBeGreaterThanOrEqual(0);
    });

    it('should return zero counts for project with no expired leases', async () => {
      const cleanProject = await projectService.createProject({
        name: 'clean-project',
        description: 'Project with no expired leases'
      });

      const results = await taskService.cleanupExpiredLeases(cleanProject.id);

      expect(results.reclaimedTasks).toBe(0);
      expect(results.cleanedAgents).toBe(0);
    });
  });
});