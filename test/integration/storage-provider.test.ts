import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { v4 as uuidv4 } from 'uuid';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createStorageProvider } from '../../src/storage/index.js';
import { TaskDriverConfig } from '../../src/config/types.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { LeaseService } from '../../src/services/LeaseService.js';

describe('Storage Provider Integration', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let taskTypeService: TaskTypeService;
  let taskService: TaskService;
  let agentService: AgentService;
  let leaseService: LeaseService;

  beforeEach(async () => {
    // Create a file storage provider for testing
    const config: TaskDriverConfig = {
      server: { host: 'localhost', port: 3000, mode: 'mcp' },
      storage: {
        provider: 'file',
        fileStorage: {
          dataDir: './test-integration-data',
          lockTimeout: 30000
        }
      },
      logging: { level: 'info', pretty: false, correlation: true },
      security: { enableAuth: false, apiKeyLength: 32, sessionTimeout: 3600 },
      defaults: { maxRetries: 3, leaseDurationMinutes: 10, reaperIntervalMinutes: 1 }
    };

    // Create storage with shorter lock timeout for tests
    storage = new FileStorageProvider('./test-integration-data', 5000); // 5 second timeout
    await storage.initialize();

    // Initialize services with proper dependency injection
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);
    leaseService = new LeaseService(storage);
  });

  afterEach(async () => {
    await storage.close();
    // Clean up test directory
    try {
      await import('fs/promises').then(fs => fs.rm('./test-integration-data', { recursive: true, force: true }));
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('End-to-End Workflow', () => {
    it('should support complete task lifecycle through all services', async () => {
      // 1. Create a project
      const project = await projectService.createProject({
        name: 'integration-project',
        description: 'Integration test project',
        config: {
          defaultMaxRetries: 2,
          defaultLeaseDurationMinutes: 5,
          reaperIntervalMinutes: 1
        }
      });

      expect(project.name).toBe('integration-project');
      expect(project.config.defaultMaxRetries).toBe(2);

      // 2. Create a task type
      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'integration-task-type',
        template: 'Process {{input}} with {{method}}',
        variables: ['input', 'method'],
        duplicateHandling: 'ignore',
        maxRetries: 3,
        leaseDurationMinutes: 15
      });

      expect(taskType.projectId).toBe(project.id);
      expect(taskType.template).toBe('Process {{input}} with {{method}}');

      // 3. Register an agent
      const registration = await agentService.registerAgent({
        projectId: project.id,
        name: 'integration-agent',
        capabilities: ['processing', 'analysis']
      });

      expect(registration.agent.projectId).toBe(project.id);
      expect(registration.agent.name).toBe('integration-agent');
      const agent = registration.agent;

      // 4. Create multiple tasks
      const task1 = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Process the first dataset',
        variables: { input: 'dataset1', method: 'analysis' }
      });

      const task2 = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Process the second dataset',
        variables: { input: 'dataset2', method: 'analysis' }
      });

      expect(task1.status).toBe('queued');
      expect(task2.status).toBe('queued');

      // 5. Agent gets next task
      const assignedTask = await agentService.getNextTask(agent.name, project.id);
      expect(assignedTask).not.toBeNull();
      expect(assignedTask!.id).toBe(task1.id); // Should get first task (FIFO)
      expect(assignedTask!.status).toBe('running');
      expect(assignedTask!.assignedTo).toBe(agent.name);

      // 6. Complete the task
      await agentService.completeTask(
        agent.name,
        project.id,
        assignedTask!.id,
        {
          success: true,
          output: 'Dataset processed successfully',
          metadata: { processingTime: 1500 }
        }
      );

      const completedTask = await taskService.getTask(assignedTask!.id);
      expect(completedTask!.status).toBe('completed');
      expect(completedTask!.result!.success).toBe(true);

      // 7. Get next task
      const assignedTask2 = await agentService.getNextTask(agent.name, project.id);
      expect(assignedTask2).not.toBeNull();
      expect(assignedTask2!.id).toBe(task2.id);

      // 8. Fail the task (should retry)
      await agentService.failTask(
        agent.name,
        project.id,
        assignedTask2!.id,
        {
          success: false,
          error: 'Temporary processing error',
          metadata: { errorCode: 'TEMP_FAIL' }
        }
      );

      const failedTask = await taskService.getTask(assignedTask2!.id);
      expect(failedTask!.status).toBe('queued'); // Should be requeued
      expect(failedTask!.retryCount).toBe(1);

      // 9. Get task again (retry)
      const retryTask = await agentService.getNextTask(agent.name, project.id);
      expect(retryTask).not.toBeNull();
      expect(retryTask!.id).toBe(task2.id);
      expect(retryTask!.retryCount).toBe(1);

      // 10. Complete the retry
      await agentService.completeTask(
        agent.name,
        project.id,
        retryTask!.id,
        {
          success: true,
          output: 'Dataset processed on retry',
          metadata: { processingTime: 2000, retry: true }
        }
      );

      // 11. Verify final state
      const finalProject = await projectService.getProject(project.id);
      expect(finalProject!.stats.totalTasks).toBe(2);
      expect(finalProject!.stats.completedTasks).toBe(2);
      expect(finalProject!.stats.failedTasks).toBe(0);
      expect(finalProject!.stats.queuedTasks).toBe(0);
      expect(finalProject!.stats.runningTasks).toBe(0);

      const allTasks = await taskService.listTasks(project.id);
      expect(allTasks).toHaveLength(2);
      expect(allTasks.every(t => t.status === 'completed')).toBe(true);
    });

    it('should handle lease expiration and cleanup', async () => {
      // Create project with short lease duration
      const project = await projectService.createProject({
        name: 'lease-test-project',
        description: 'Project for lease testing'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'short-lease-task',
        template: 'Execute short lease task: {{instructions}}',
        leaseDurationMinutes: 1 // 1 minute (minimum allowed)
      });

      const agentReg = await agentService.registerAgent({
        projectId: project.id,
        name: 'lease-test-agent'
      });
      const agent = agentReg.agent;

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task with short lease',
        variables: {
          instructions: 'Task with short lease'
        }
      });

      // Assign task
      const assignedTask = await agentService.getNextTask(agent.name, project.id);
      expect(assignedTask).not.toBeNull();
      expect(assignedTask!.status).toBe('running');

      // Manually expire the lease by setting it to past time
      await storage.updateTask(assignedTask!.id, {
        leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
      });

      // Run lease cleanup
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(1);
      expect(cleanupResult.cleanedAgents).toBeGreaterThanOrEqual(0); // May clean agent status

      // Task should be back in queue
      const reclaimedTask = await taskService.getTask(task.id);
      expect(reclaimedTask!.status).toBe('queued');
      expect(reclaimedTask!.retryCount).toBe(1);
      expect(reclaimedTask!.assignedTo).toBeUndefined();

      // Agent should be able to get the task again
      const reassignedTask = await agentService.getNextTask(agent.name, project.id);
      expect(reassignedTask).not.toBeNull();
      expect(reassignedTask!.id).toBe(task.id);
    });

    it('should handle duplicate task detection', async () => {
      const project = await projectService.createProject({
        name: 'duplicate-test-project',
        description: 'Project for duplicate testing'
      });

      // Create task type with ignore duplicates
      const ignoreTaskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'ignore-duplicate-task',
        template: 'Execute ignore duplicate task: {{instructions}}',
        duplicateHandling: 'ignore'
      });

      // Create task type with fail duplicates
      const failTaskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'fail-duplicate-task',
        template: 'Execute fail duplicate task: {{instructions}}',
        duplicateHandling: 'fail'
      });

      // Test ignore behavior
      const task1 = await taskService.createTask({
        projectId: project.id,
        typeId: ignoreTaskType.id,
        instructions: 'Duplicate task',
        variables: { instructions: 'Duplicate task' }
      });

      const task2 = await taskService.createTask({
        projectId: project.id,
        typeId: ignoreTaskType.id,
        instructions: 'Duplicate task',
        variables: { instructions: 'Duplicate task' }
      });

      expect(task1.id).toBe(task2.id); // Should return same task

      // Test fail behavior
      await taskService.createTask({
        projectId: project.id,
        typeId: failTaskType.id,
        instructions: 'Another duplicate task',
        variables: { instructions: 'Another duplicate task' }
      });

      await expect(taskService.createTask({
        projectId: project.id,
        typeId: failTaskType.id,
        instructions: 'Another duplicate task',
        variables: { instructions: 'Another duplicate task' }
      })).rejects.toThrow('Duplicate task found');
    });

    it('should handle batch operations', async () => {
      const project = await projectService.createProject({
        name: 'batch-test-project',
        description: 'Project for batch testing'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'batch-task-type',
        template: 'Execute batch task: {{instructions}}'
      });

      const agentReg = await agentService.registerAgent({
        projectId: project.id,
        name: 'batch-agent'
      });
      const agent = agentReg.agent;

      // Create multiple tasks
      const batchTasks = Array.from({ length: 5 }, (_, i) => ({
        typeId: taskType.id,
        instructions: `Batch task ${i + 1}`,
        variables: { index: (i + 1).toString() }
      }));

      const batchResult = await storage.createTasksBulk(project.id, batchTasks);
      expect(batchResult.tasksCreated).toBe(5);
      expect(batchResult.errors).toHaveLength(0);

      // Process all tasks
      const completedTasks = [];
      for (let i = 0; i < 5; i++) {
        const task = await agentService.getNextTask(agent.name, project.id);
        expect(task).not.toBeNull();
        
        await agentService.completeTask(
          agent.name,
          project.id,
          task!.id,
          { success: true, output: `Completed task ${i + 1}` }
        );
        
        completedTasks.push(task!);
      }

      // Verify no more tasks
      const noMoreTasks = await agentService.getNextTask(agent.name, project.id);
      expect(noMoreTasks).toBeNull();

      // Check batch status
      const batchStatus = await storage.getBatchStatus(batchResult.batchId);
      expect(batchStatus.total).toBe(5);
      expect(batchStatus.completed).toBe(5);
      expect(batchStatus.failed).toBe(0);
      expect(batchStatus.queued).toBe(0);
      expect(batchStatus.running).toBe(0);
    });
  });

  describe('Service Integration', () => {
    it('should maintain data consistency across services', async () => {
      const project = await projectService.createProject({
        name: 'consistency-test',
        description: 'Test data consistency'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'consistency-task-type',
        template: 'Execute consistency task: {{instructions}}'
      });

      const agentReg = await agentService.registerAgent({
        projectId: project.id,
        name: 'consistency-agent'
      });
      const agent = agentReg.agent;

      // Create task via TaskService
      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Consistency test task',
        variables: {
          instructions: 'Consistency test task'
        }
      });

      // Assign via AgentService
      const assignedTask = await agentService.getNextTask(agent.name, project.id);
      expect(assignedTask!.id).toBe(task.id);

      // Verify consistency in TaskService
      const retrievedTask = await taskService.getTask(task.id);
      expect(retrievedTask!.status).toBe('running');
      expect(retrievedTask!.assignedTo).toBe(agent.name);

      // Verify consistency in ProjectService stats
      const updatedProject = await projectService.getProject(project.id);
      expect(updatedProject!.stats.runningTasks).toBe(1);
      expect(updatedProject!.stats.queuedTasks).toBe(0);

      // Complete via AgentService
      await agentService.completeTask(
        agent.name,
        project.id,
        task.id,
        { success: true, output: 'Consistency verified' }
      );

      // Verify final consistency
      const finalTask = await taskService.getTask(task.id);
      expect(finalTask!.status).toBe('completed');

      const finalProject = await projectService.getProject(project.id);
      expect(finalProject!.stats.completedTasks).toBe(1);
      expect(finalProject!.stats.runningTasks).toBe(0);
    });

    it('should handle concurrent agent operations', async () => {
      const project = await projectService.createProject({
        name: 'concurrent-test',
        description: 'Test concurrent operations'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'concurrent-task-type',
        template: 'Execute concurrent task: {{instructions}}'
      });

      // Register multiple agents
      const agent1Reg = await agentService.registerAgent({
        projectId: project.id,
        name: 'agent-1'
      });
      const agent1 = agent1Reg.agent;

      const agent2Reg = await agentService.registerAgent({
        projectId: project.id,
        name: 'agent-2'
      });
      const agent2 = agent2Reg.agent;

      // Create multiple tasks
      const tasks = await Promise.all([
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Concurrent task 1',
          variables: { instructions: 'Concurrent task 1' }
        }),
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Concurrent task 2',
          variables: { instructions: 'Concurrent task 2' }
        }),
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Concurrent task 3',
          variables: { instructions: 'Concurrent task 3' }
        })
      ]);

      // Both agents try to get tasks simultaneously (test concurrent assignment)
      const [assignedTask1, assignedTask2] = await Promise.all([
        agentService.getNextTask(agent1.name, project.id),
        agentService.getNextTask(agent2.name, project.id)
      ]);

      expect(assignedTask1).not.toBeNull();
      expect(assignedTask2).not.toBeNull();
      expect(assignedTask1!.id).not.toBe(assignedTask2!.id); // Different tasks

      // Complete tasks concurrently
      await Promise.all([
        agentService.completeTask(
          agent1.name,
          project.id,
          assignedTask1!.id,
          { success: true, output: 'Agent 1 completed' }
        ),
        agentService.completeTask(
          agent2.name,
          project.id,
          assignedTask2!.id,
          { success: true, output: 'Agent 2 completed' }
        )
      ]);

      // Verify both completed
      const [completedTask1, completedTask2] = await Promise.all([
        taskService.getTask(assignedTask1!.id),
        taskService.getTask(assignedTask2!.id)
      ]);

      expect(completedTask1!.status).toBe('completed');
      expect(completedTask2!.status).toBe('completed');

      // Final project state should be consistent
      const finalProject = await projectService.getProject(project.id);
      expect(finalProject!.stats.completedTasks).toBe(2);
      expect(finalProject!.stats.queuedTasks).toBe(1); // One task remaining
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      const project = await projectService.createProject({
        name: 'error-test',
        description: 'Test error handling'
      });

      // Try to create task with non-existent task type (but valid UUID format)
      const fakeTypeId = uuidv4();
      await expect(taskService.createTask({
        projectId: project.id,
        typeId: fakeTypeId,
        instructions: 'This should fail',
        variables: { instructions: 'This should fail' }
      })).rejects.toThrow(`Task type ${fakeTypeId} not found`);

      // Try to register agent with non-existent project (but valid UUID format)
      const fakeProjectId = uuidv4();
      await expect(agentService.registerAgent({
        projectId: fakeProjectId,
        name: 'test-agent'
      })).rejects.toThrow(`Project ${fakeProjectId} not found`);

      // Try to complete non-existent task
      const agentReg = await agentService.registerAgent({
        projectId: project.id,
        name: 'error-agent'
      });
      const agent = agentReg.agent;

      const fakeTaskId = uuidv4();
      await expect(agentService.completeTask(
        agent.name,
        project.id,
        fakeTaskId,
        { success: true, output: 'Should fail' }
      )).rejects.toThrow(`Task ${fakeTaskId} not found`);
    });

    it('should handle validation errors across services', async () => {
      // Invalid project creation
      await expect(projectService.createProject({
        name: '', // Invalid empty name
        description: 'Test project'
      })).rejects.toThrow('Validation failed');

      const project = await projectService.createProject({
        name: 'validation-test',
        description: 'Test validation'
      });

      // Invalid task type creation
      await expect(taskTypeService.createTaskType({
        projectId: project.id,
        name: '', // Invalid empty name
        template: 'Test {{var}}'
      })).rejects.toThrow('Validation failed');

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'valid-task-type',
        template: 'Execute valid task: {{instructions}}'
      });

      // Invalid task creation
      await expect(taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: '', // Invalid empty instructions
        variables: { instructions: '' }
      })).rejects.toThrow('Validation failed');
    });
  });
});