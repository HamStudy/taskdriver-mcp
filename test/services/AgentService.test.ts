import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { AgentService } from '../../src/services/AgentService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('AgentService (Lease-based)', () => {
  let storage: FileStorageProvider;
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
    
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);

    // Create test project
    const project = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for lease-based agents'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('getNextTask', () => {
    let taskTypeId: string;

    beforeEach(async () => {
      // Create task type and tasks
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'test-task-type',
        template: 'Test task for {{resource}}'
      });
      taskTypeId = taskType.id;

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

    it('should get next task with provided agent name', async () => {
      const result = await agentService.getNextTask(projectId, 'test-agent');

      expect(result.task).not.toBeNull();
      expect(result.agentName).toBe('test-agent');
      expect(result.task!.status).toBe('running');
      expect(result.task!.assignedTo).toBe('test-agent');
      expect(result.task!.assignedAt).toBeInstanceOf(Date);
      expect(result.task!.leaseExpiresAt).toBeInstanceOf(Date);
      expect(result.task!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should get next task with auto-generated agent name', async () => {
      const result = await agentService.getNextTask(projectId);

      expect(result.task).not.toBeNull();
      expect(result.agentName).toBeDefined();
      expect(result.agentName).toMatch(/^agent-\d+-[a-z0-9]+$/);
      expect(result.task!.status).toBe('running');
      expect(result.task!.assignedTo).toBe(result.agentName);
      expect(result.task!.assignedAt).toBeInstanceOf(Date);
      expect(result.task!.leaseExpiresAt).toBeInstanceOf(Date);
    });

    it('should return null task when no tasks available', async () => {
      // Assign all available tasks first
      await agentService.getNextTask(projectId, 'agent-1');
      await agentService.getNextTask(projectId, 'agent-2');

      const result = await agentService.getNextTask(projectId, 'agent-3');
      expect(result.task).toBeNull();
      expect(result.agentName).toBe('agent-3');
    });

    it('should resume existing task for agent with active lease', async () => {
      // First assignment
      const result1 = await agentService.getNextTask(projectId, 'persistent-agent');
      const firstTaskId = result1.task!.id;

      // Second call with same agent should resume the same task
      const result2 = await agentService.getNextTask(projectId, 'persistent-agent');
      expect(result2.task!.id).toBe(firstTaskId);
      expect(result2.agentName).toBe('persistent-agent');
    });

    it('should throw error for non-existent project', async () => {
      await expect(agentService.getNextTask('non-existent-project', 'test-agent'))
        .rejects.toThrow();
    });

    it('should assign different tasks to different agents', async () => {
      const result1 = await agentService.getNextTask(projectId, 'agent-1');
      const result2 = await agentService.getNextTask(projectId, 'agent-2');

      expect(result1.task).not.toBeNull();
      expect(result2.task).not.toBeNull();
      expect(result1.task!.id).not.toBe(result2.task!.id);
      expect(result1.agentName).toBe('agent-1');
      expect(result2.agentName).toBe('agent-2');
    });
  });

  describe('completeTask', () => {
    let taskId: string;
    let agentName: string;

    beforeEach(async () => {
      agentName = 'complete-agent';
      
      // Create task and assign it to agent
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'complete-task-type',
        template: 'Complete task for {{resource}}'
      });

      const task = await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Task to complete',
        variables: { resource: 'test-resource' }
      });
      taskId = task.id;

      // Assign the task
      await agentService.getNextTask(projectId, agentName);
    });

    it('should complete task successfully', async () => {
      const taskResult = {
        success: true,
        output: 'Task completed successfully',
        duration: 1500
      };

      await agentService.completeTask(agentName, projectId, taskId, taskResult);

      // Check task status
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('completed');
      expect(task!.result).toEqual(taskResult);
      expect(task!.completedAt).toBeInstanceOf(Date);
      expect(task!.assignedTo).toBeUndefined(); // Lease should be released
      expect(task!.leaseExpiresAt).toBeUndefined();
    });

    it('should complete task with minimal result', async () => {
      const taskResult = {
        success: true
      };

      await agentService.completeTask(agentName, projectId, taskId, taskResult);

      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('completed');
      expect(task!.result).toEqual(taskResult);
    });

    it('should throw error for task not assigned to agent', async () => {
      const taskResult = { success: true, output: 'test' };

      await expect(agentService.completeTask('other-agent', projectId, taskId, taskResult))
        .rejects.toThrow();
    });

    it('should throw error for non-existent task', async () => {
      const taskResult = { success: true, output: 'test' };

      await expect(agentService.completeTask(agentName, projectId, 'non-existent-task', taskResult))
        .rejects.toThrow();
    });

    it('should throw error for non-existent project', async () => {
      const taskResult = { success: true, output: 'test' };

      await expect(agentService.completeTask(agentName, 'non-existent-project', taskId, taskResult))
        .rejects.toThrow();
    });
  });

  describe('failTask', () => {
    let taskId: string;
    let agentName: string;

    beforeEach(async () => {
      agentName = 'fail-agent';
      
      // Create task and assign it to agent
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'fail-task-type',
        template: 'Fail task for {{resource}}'
      });

      const task = await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Task to fail',
        variables: { resource: 'test-resource' }
      });
      taskId = task.id;

      // Assign the task
      await agentService.getNextTask(projectId, agentName);
    });

    it('should fail task with retry', async () => {
      const taskResult = {
        success: false,
        error: 'Task failed with error',
        explanation: 'Transient network error'
      };

      await agentService.failTask(agentName, projectId, taskId, taskResult, true);

      // Check task status - should be queued for retry
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('queued');
      expect(task!.retryCount).toBe(1);
      expect(task!.assignedTo).toBeUndefined(); // Lease should be released
      expect(task!.leaseExpiresAt).toBeUndefined();
    });

    it('should fail task without retry', async () => {
      const taskResult = {
        success: false,
        error: 'Fatal error',
        explanation: 'Permanent failure'
      };

      await agentService.failTask(agentName, projectId, taskId, taskResult, false);

      // Check task status - should be permanently failed
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('failed');
      expect(task!.result).toEqual(taskResult);
      expect(task!.failedAt).toBeInstanceOf(Date);
      expect(task!.assignedTo).toBeUndefined();
      expect(task!.leaseExpiresAt).toBeUndefined();
    });

    it('should use default canRetry=true when not specified', async () => {
      const taskResult = {
        success: false,
        error: 'Default retry test'
      };

      await agentService.failTask(agentName, projectId, taskId, taskResult);

      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('queued'); // Should be retried by default
      expect(task!.retryCount).toBe(1);
    });

    it('should throw error for task not assigned to agent', async () => {
      const taskResult = { success: false, error: 'test' };

      await expect(agentService.failTask('other-agent', projectId, taskId, taskResult))
        .rejects.toThrow();
    });

    it('should throw error for non-existent task', async () => {
      const taskResult = { success: false, error: 'test' };

      await expect(agentService.failTask(agentName, projectId, 'non-existent-task', taskResult))
        .rejects.toThrow();
    });

    it('should throw error for non-existent project', async () => {
      const taskResult = { success: false, error: 'test' };

      await expect(agentService.failTask(agentName, 'non-existent-project', taskId, taskResult))
        .rejects.toThrow();
    });
  });

  describe('listActiveAgents', () => {
    beforeEach(async () => {
      // Create tasks for testing
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'list-agent-task-type',
        template: 'List agent task for {{resource}}'
      });

      await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Task 1',
        variables: { resource: 'resource-1' }
      });

      await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Task 2',
        variables: { resource: 'resource-2' }
      });
    });

    it('should list active agents with leased tasks', async () => {
      // Assign tasks to agents
      await agentService.getNextTask(projectId, 'agent-1');
      await agentService.getNextTask(projectId, 'agent-2');

      const activeAgents = await agentService.listActiveAgents(projectId);

      expect(activeAgents).toHaveLength(2);
      expect(activeAgents.map(a => a.name)).toContain('agent-1');
      expect(activeAgents.map(a => a.name)).toContain('agent-2');
      expect(activeAgents.every(a => a.status === 'working')).toBe(true);
      expect(activeAgents.every(a => a.currentTaskId)).toBeTruthy();
      expect(activeAgents.every(a => a.assignedAt instanceof Date)).toBe(true);
    });

    it('should return empty array when no agents are active', async () => {
      const activeAgents = await agentService.listActiveAgents(projectId);
      expect(activeAgents).toHaveLength(0);
    });

    it('should not include agents after task completion', async () => {
      // Assign task to agent
      const result = await agentService.getNextTask(projectId, 'temp-agent');
      const taskId = result.task!.id;

      // Verify agent is active
      let activeAgents = await agentService.listActiveAgents(projectId);
      expect(activeAgents).toHaveLength(1);
      expect(activeAgents[0].name).toBe('temp-agent');

      // Complete the task
      await agentService.completeTask('temp-agent', projectId, taskId, { success: true });

      // Verify agent is no longer active
      activeAgents = await agentService.listActiveAgents(projectId);
      expect(activeAgents).toHaveLength(0);
    });

    it('should throw error for non-existent project', async () => {
      await expect(agentService.listActiveAgents('non-existent-project'))
        .rejects.toThrow();
    });
  });

  describe('getAgentStatus', () => {
    let taskId: string;

    beforeEach(async () => {
      // Create task for testing
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'status-task-type',
        template: 'Status task for {{resource}}'
      });

      const task = await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Status test task',
        variables: { resource: 'status-resource' }
      });
      taskId = task.id;
    });

    it('should get status for agent with active lease', async () => {
      await agentService.getNextTask(projectId, 'status-agent');

      const status = await agentService.getAgentStatus('status-agent', projectId);

      expect(status).not.toBeNull();
      expect(status!.name).toBe('status-agent');
      expect(status!.projectId).toBe(projectId);
      expect(status!.status).toBe('working');
      expect(status!.currentTaskId).toBe(taskId);
      expect(status!.assignedAt).toBeInstanceOf(Date);
    });

    it('should return null for agent without active lease', async () => {
      const status = await agentService.getAgentStatus('inactive-agent', projectId);
      expect(status).toBeNull();
    });

    it('should return null after task completion', async () => {
      await agentService.getNextTask(projectId, 'temp-status-agent');
      
      // Complete the task
      await agentService.completeTask('temp-status-agent', projectId, taskId, { success: true });

      const status = await agentService.getAgentStatus('temp-status-agent', projectId);
      expect(status).toBeNull();
    });

    it('should throw error for non-existent project', async () => {
      await expect(agentService.getAgentStatus('test-agent', 'non-existent-project'))
        .rejects.toThrow();
    });
  });

  describe('extendTaskLease', () => {
    let taskId: string;
    let agentName: string;

    beforeEach(async () => {
      agentName = 'lease-agent';
      
      // Create task and assign it to agent
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'lease-task-type',
        template: 'Lease task for {{resource}}'
      });

      const task = await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Task with lease extension',
        variables: { resource: 'lease-resource' }
      });
      taskId = task.id;

      // Assign the task
      await agentService.getNextTask(projectId, agentName);
    });

    it('should extend task lease successfully', async () => {
      // Get original lease expiration
      const taskBefore = await taskService.getTask(taskId);
      const originalExpiry = taskBefore!.leaseExpiresAt!;

      // Extend lease by 30 minutes
      await agentService.extendTaskLease(agentName, projectId, taskId, 30);

      // Check that lease was extended
      const taskAfter = await taskService.getTask(taskId);
      const newExpiry = taskAfter!.leaseExpiresAt!;
      
      const expectedMinimumExtension = 25 * 60 * 1000; // 25 minutes in ms (allowing for processing time)
      expect(newExpiry.getTime() - originalExpiry.getTime()).toBeGreaterThan(expectedMinimumExtension);
    });

    it('should throw error for task not assigned to agent', async () => {
      await expect(agentService.extendTaskLease('other-agent', projectId, taskId, 30))
        .rejects.toThrow(`Task ${taskId} is not assigned to agent other-agent`);
    });

    it('should throw error for non-existent task', async () => {
      await expect(agentService.extendTaskLease(agentName, projectId, 'non-existent-task', 30))
        .rejects.toThrow('Task non-existent-task not found');
    });

    it('should throw error for completed task', async () => {
      // Complete the task first
      await agentService.completeTask(agentName, projectId, taskId, { success: true });

      await expect(agentService.extendTaskLease(agentName, projectId, taskId, 30))
        .rejects.toThrow(`Task ${taskId} is not assigned to agent ${agentName}`);
    });

    it('should work with different extension durations', async () => {
      const taskBefore = await taskService.getTask(taskId);
      const originalExpiry = taskBefore!.leaseExpiresAt!;

      // Extend lease by 60 minutes
      await agentService.extendTaskLease(agentName, projectId, taskId, 60);

      const taskAfter = await taskService.getTask(taskId);
      const newExpiry = taskAfter!.leaseExpiresAt!;
      
      const expectedMinimumExtension = 55 * 60 * 1000; // 55 minutes in ms
      expect(newExpiry.getTime() - originalExpiry.getTime()).toBeGreaterThan(expectedMinimumExtension);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle concurrent task assignment properly', async () => {
      // Create a single task
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'concurrent-task-type',
        template: 'Concurrent task for {{resource}}'
      });

      await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Single task for concurrency test',
        variables: { resource: 'concurrent-resource' }
      });

      // Try to assign the same task to multiple agents simultaneously
      const assignments = await Promise.all([
        agentService.getNextTask(projectId, 'agent-1'),
        agentService.getNextTask(projectId, 'agent-2'),
        agentService.getNextTask(projectId, 'agent-3')
      ]);

      // Only one should get the task, others should get null
      const successfulAssignments = assignments.filter(a => a.task !== null);
      const failedAssignments = assignments.filter(a => a.task === null);

      expect(successfulAssignments).toHaveLength(1);
      expect(failedAssignments).toHaveLength(2);
    });

    it('should handle project validation correctly', async () => {
      // Test with invalid project format
      await expect(agentService.getNextTask('invalid-project-format'))
        .rejects.toThrow();

      // Test with valid format but non-existent project
      await expect(agentService.getNextTask('550e8400-e29b-41d4-a716-446655440000'))
        .rejects.toThrow();
    });
  });
});