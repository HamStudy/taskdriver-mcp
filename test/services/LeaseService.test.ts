import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { LeaseService } from '../../src/services/LeaseService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('LeaseService', () => {
  let storage: FileStorageProvider;
  let leaseService: LeaseService;
  let agentService: AgentService;
  let projectService: ProjectService;
  let taskService: TaskService;
  let taskTypeService: TaskTypeService;
  let testDataDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    // Initialize services
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);
    leaseService = new LeaseService(storage);

    // Create a test project
    const project = await storage.createProject({
      name: 'test-project',
      description: 'Test project for lease service',
      config: {
        defaultLeaseDurationMinutes: 5
      }
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('cleanupExpiredLeases', () => {
    it('should reclaim expired tasks', async () => {
      // Create a task type
      const taskType = await storage.createTaskType({
        name: 'test-task-type',
        projectId,
        template: 'Test template',
        variables: [],
        duplicateHandling: 'allow',
        maxRetries: 3,
        leaseDurationMinutes: 5
      });

      // Create and assign a task
      const task = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task'
      });

      // Create an agent
      const agent = await storage.createAgent({
        name: 'test-agent',
        projectId,
        capabilities: []
      });

      // Assign the task using the agent service
      const assignedTask = await agentService.getNextTask(agent.name!, projectId);
      expect(assignedTask).not.toBeNull();
      expect(assignedTask!.id).toBe(task.id);

      // Manually expire the lease by setting it to the past
      const expiredTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      await storage.updateTask(task.id, {
        leaseExpiresAt: expiredTime
      });

      // Run lease cleanup
      const results = await leaseService.cleanupExpiredLeases(projectId);

      expect(results.reclaimedTasks).toBe(1);
      expect(results.cleanedAgents).toBe(1);

      // Verify the task is now queued for retry
      const updatedTask = await storage.getTask(task.id);
      expect(updatedTask!.status).toBe('queued');
      expect(updatedTask!.retryCount).toBe(1);

      // Verify the agent is idle
      const updatedAgent = await storage.getAgent(agent.id);
      expect(updatedAgent!.status).toBe('idle');
      expect(updatedAgent!.currentTaskId).toBeUndefined();
    });

    it('should not reclaim non-expired tasks', async () => {
      // Create a task type
      const taskType = await storage.createTaskType({
        name: 'test-task-type',
        projectId,
        template: 'Test template',
        variables: [],
        duplicateHandling: 'allow',
        maxRetries: 3,
        leaseDurationMinutes: 60 // 1 hour
      });

      // Create and assign a task
      const task = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task'
      });

      // Create an agent
      const agent = await storage.createAgent({
        name: 'test-agent',
        projectId,
        capabilities: []
      });

      // Assign the task using the agent service
      const assignedTask = await agentService.getNextTask(agent.name!, projectId);
      expect(assignedTask).not.toBeNull();

      // Run lease cleanup
      const results = await leaseService.cleanupExpiredLeases(projectId);

      expect(results.reclaimedTasks).toBe(0);
      expect(results.cleanedAgents).toBe(0);

      // Verify the task is still running
      const updatedTask = await storage.getTask(task.id);
      expect(updatedTask!.status).toBe('running');
      expect(updatedTask!.assignedTo).toBe(agent.name);

      // Verify the agent is still working
      const updatedAgent = await storage.getAgent(agent.id);
      expect(updatedAgent!.status).toBe('working');
      expect(updatedAgent!.currentTaskId).toBe(task.id);
    });

    it('should handle projects with no running tasks', async () => {
      const results = await leaseService.cleanupExpiredLeases(projectId);

      expect(results.reclaimedTasks).toBe(0);
      expect(results.cleanedAgents).toBe(0);
    });
  });

  describe('extendTaskLease', () => {
    it('should extend lease for running task', async () => {
      // Create a task type
      const taskType = await storage.createTaskType({
        name: 'test-task-type',
        projectId,
        template: 'Test template',
        variables: [],
        duplicateHandling: 'allow',
        maxRetries: 3,
        leaseDurationMinutes: 5
      });

      // Create and assign a task
      const task = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task'
      });

      // Create an agent
      const agent = await storage.createAgent({
        name: 'test-agent',
        projectId,
        capabilities: []
      });

      // Assign the task using the agent service
      const assignedTask = await agentService.getNextTask(agent.name!, projectId);
      expect(assignedTask).not.toBeNull();
      
      const originalExpiry = assignedTask!.leaseExpiresAt!;

      // Extend the lease
      await leaseService.extendTaskLease(task.id, 30);

      // Verify the lease was extended
      const updatedTask = await storage.getTask(task.id);
      const newExpiry = updatedTask!.leaseExpiresAt!;
      
      const timeDiff = newExpiry.getTime() - originalExpiry.getTime();
      expect(timeDiff).toBeCloseTo(30 * 60 * 1000, -1000); // Within 1 second
    });

    it('should throw error for non-existent task', async () => {
      await expect(leaseService.extendTaskLease('non-existent-id', 30))
        .rejects.toThrow('Task non-existent-id not found');
    });

    it('should throw error for non-running task', async () => {
      // Create a task type
      const taskType = await storage.createTaskType({
        name: 'test-task-type',
        projectId,
        template: 'Test template',
        variables: [],
        duplicateHandling: 'allow',
        maxRetries: 3,
        leaseDurationMinutes: 5
      });

      // Create a task but don't assign it
      const task = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task'
      });

      await expect(leaseService.extendTaskLease(task.id, 30))
        .rejects.toThrow(`Task ${task.id} is not running`);
    });
  });

  describe('getLeaseStats', () => {
    it('should return stats for project with tasks', async () => {
      // Create a task type
      const taskType = await storage.createTaskType({
        name: 'test-task-type',
        projectId,
        template: 'Test template',
        variables: [],
        duplicateHandling: 'allow',
        maxRetries: 3,
        leaseDurationMinutes: 5
      });

      // Create multiple tasks
      const task1 = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task 1'
      });

      const task2 = await storage.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Test task 2'
      });

      // Create an agent and assign one task
      const agent = await storage.createAgent({
        name: 'test-agent',
        projectId,
        capabilities: []
      });

      await agentService.getNextTask(agent.name!, projectId);

      // Expire one task
      const expiredTime = new Date(Date.now() - 10 * 60 * 1000);
      await storage.updateTask(task1.id, {
        leaseExpiresAt: expiredTime
      });

      const stats = await leaseService.getLeaseStats(projectId);

      expect(stats.totalRunningTasks).toBe(1);
      expect(stats.expiredTasks).toBe(1);
      expect(stats.tasksByStatus.queued).toBe(1);
      expect(stats.tasksByStatus.running).toBe(1);
    });

    it('should return empty stats for project with no tasks', async () => {
      const stats = await leaseService.getLeaseStats(projectId);

      expect(stats.totalRunningTasks).toBe(0);
      expect(stats.expiredTasks).toBe(0);
      expect(stats.tasksByStatus).toEqual({});
    });
  });
});