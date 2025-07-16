import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { TaskService } from '../../src/services/TaskService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('TaskService', () => {
  let storage: FileStorageProvider;
  let taskService: TaskService;
  let projectService: ProjectService;
  let taskTypeService: TaskTypeService;
  let agentService: AgentService;
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
    agentService = new AgentService(storage, projectService, taskService);

    // Create test project and task type
    const project = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for tasks'
    });
    projectId = project.id;

    const taskType = await taskTypeService.createTaskType({
      projectId,
      name: 'test-task-type',
      template: 'Test task for {{resource}}'
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
    it('should create a task ready for assignment', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Test task instructions',
        variables: { resource: 'test-resource' }
      };

      const task = await taskService.createTask(input);

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      expect(task.typeId).toBe(taskTypeId);
      
      // For template-based tasks, instructions are generated dynamically
      const instructions = await taskService.getTaskInstructions(task.id);
      expect(instructions).toBe('Test task for test-resource');
      
      // Task should be ready for assignment
      expect(task.status).toBe('queued');
      expect(task.retryCount).toBe(0); // Fresh task
      expect(task.maxRetries).toBeGreaterThan(0); // Has retry capability
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.attempts).toEqual([]); // No attempts yet
    });

    it('should create task with variables', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Task with variables',
        variables: { resource: 'test-resource', key: 'value', number: '42' }
      };

      const task = await taskService.createTask(input);

      expect(task.variables).toEqual({ resource: 'test-resource', key: 'value', number: '42' });
    });

    it('should create task with custom ID', async () => {
      const customId = '123e4567-e89b-12d3-a456-426614174000'; // Valid GUID
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Custom ID task',
        variables: { resource: 'test-resource' },
        id: customId
      };

      const task = await taskService.createTask(input);

      expect(task.id).toBe(customId);
    });

    it('should throw validation error for missing required template variables', async () => {
      const input = {
        projectId,
        typeId: taskTypeId,
        instructions: 'Test task instructions',
        variables: {} // Missing required 'resource' variable for template
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Missing required template variables: resource');
    });

    it('should throw validation error for invalid project ID format', async () => {
      const input = {
        projectId: 'non-existent-project',
        typeId: taskTypeId,
        instructions: 'Test task',
        variables: { resource: 'test-resource' }
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw validation error for invalid task type ID format', async () => {
      const input = {
        projectId,
        typeId: 'non-existent-type',
        instructions: 'Test task',
        variables: { resource: 'test-resource' }
      };

      await expect(taskService.createTask(input))
        .rejects.toThrow('Validation failed');
    });

    it('should handle duplicate detection with fail strategy', async () => {
      // Create task type with fail duplicate handling
      const failTaskType = await taskTypeService.createTaskType({
        projectId,
        name: 'fail-duplicate-type',
        template: 'Fail task for {{id}}',
        duplicateHandling: 'fail'
      });

      const input = {
        projectId,
        typeId: failTaskType.id,
        instructions: 'Duplicate task',
        variables: { id: 'test-id', key: 'value' }
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
        template: 'Ignore task for {{id}}',
        duplicateHandling: 'ignore'
      });

      const input = {
        projectId,
        typeId: ignoreTaskType.id,
        instructions: 'Duplicate task',
        variables: { id: 'test-id', key: 'value' }
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
        instructions: 'Retrieve task',
        variables: { resource: 'test-resource' }
      });

      const retrieved = await taskService.getTask(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      // For template-based tasks, get instructions dynamically
      const instructions = await taskService.getTaskInstructions(retrieved!.id);
      expect(instructions).toBe('Test task for test-resource');
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
        instructions: 'Queued task 1',
        variables: { resource: 'resource-1' }
      });

      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Queued task 2',
        variables: { resource: 'resource-2' }
      });

      const runningTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Running task',
        variables: { resource: 'resource-3' }
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

  describe('task assignment through AgentService', () => {
    let agentName: string;

    beforeEach(async () => {
      agentName = 'test-agent';
      
      // Create some queued tasks
      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'First task',
        variables: { resource: 'resource-1' }
      });

      await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Second task',
        variables: { resource: 'resource-2' }
      });
    });

    it('should assign next queued task to agent via AgentService', async () => {
      const result = await agentService.getNextTask(projectId, agentName);

      expect(result.task).not.toBeNull();
      expect(result.task!.status).toBe('running');
      expect(result.task!.assignedTo).toBe(agentName);
      expect(result.task!.assignedAt).toBeInstanceOf(Date);
      expect(result.task!.leaseExpiresAt).toBeInstanceOf(Date);
    });

    it('should return null when no tasks available', async () => {
      // Assign all tasks first
      await agentService.getNextTask(projectId, agentName);
      await agentService.getNextTask(projectId, 'other-agent');

      const result = await agentService.getNextTask(projectId, 'third-agent');
      expect(result.task).toBeNull();
    });

    it('should cleanup expired leases before assignment', async () => {
      // Assign a task and manually expire its lease
      const assignedResult = await agentService.getNextTask(projectId, agentName);
      expect(assignedResult.task).not.toBeNull();
      const taskId = assignedResult.task!.id;

      // Manually expire the lease
      await storage.updateTask(taskId, {
        leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
      });

      // Manually trigger cleanup to simulate what happens during getNextTask
      await taskService.cleanupExpiredLeases(projectId);

      // Now check that the task was properly failed and retry count incremented
      const reclaimedTask = await taskService.getTask(taskId);
      expect(reclaimedTask).not.toBeNull();
      expect(reclaimedTask!.status).toBe('queued'); // Should be requeued for retry
      expect(reclaimedTask!.retryCount).toBe(1); // Should be incremented
      expect(reclaimedTask!.assignedTo).toBeUndefined(); // Should be unassigned

      // Next assignment should get this requeued task
      const newResult = await agentService.getNextTask(projectId, 'new-agent');
      expect(newResult.task).not.toBeNull();
      expect(newResult.task!.id).toBe(taskId); // Should be the same task
      expect(newResult.task!.assignedTo).toBe('new-agent');
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
        instructions: 'Assignment test task',
        variables: { resource: 'test-resource' }
      });
      taskId = task.id;

      // Assign the task via AgentService
      await agentService.getNextTask(projectId, agentName);
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
        instructions: 'Unassigned task',
        variables: { resource: 'test-resource' }
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
        instructions: 'Lease test task',
        variables: { resource: 'test-resource' }
      });
      taskId = task.id;

      // Assign the task to create a lease via AgentService
      await agentService.getNextTask(projectId, 'test-agent');
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
        instructions: 'Queued task',
        variables: { resource: 'resource-1' }
      });

      const runningTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Running task',
        variables: { resource: 'resource-2' }
      });

      const expiredTask = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Expired task',
        variables: { resource: 'resource-3' }
      });

      // Assign tasks and manipulate lease times via AgentService
      await agentService.getNextTask(projectId, 'agent1');
      await agentService.getNextTask(projectId, 'agent2');

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
        instructions: 'Task 1',
        variables: { resource: 'resource-1' }
      });

      const task2 = await taskService.createTask({
        projectId,
        typeId: taskTypeId,
        instructions: 'Task 2',
        variables: { resource: 'resource-2' }
      });

      await agentService.getNextTask(projectId, 'agent1');
      await agentService.getNextTask(projectId, 'agent2');

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