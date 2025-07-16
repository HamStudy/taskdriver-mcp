import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { StorageProvider } from '../../src/storage/StorageProvider.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { LeaseService } from '../../src/services/LeaseService.js';
import { createTestDataDir } from '../fixtures/index.js';
import { rmSync, existsSync } from 'fs';

/**
 * Storage Provider Contract Tests
 * 
 * As specified in CLAUDE.md, all storage providers must pass the same behavioral tests.
 * This ensures consistent behavior across File, MongoDB, and Redis storage backends.
 * 
 * Critical patterns tested:
 * - Atomic task assignment operations
 * - Concurrent access safety
 * - Data consistency guarantees
 */
describe('Storage Provider Contract', () => {
  // Test all available storage providers
  const storageProviders = [
    {
      name: 'FileStorage',
      createProvider: () => {
        const testDataDir = createTestDataDir();
        const storage = new FileStorageProvider(testDataDir);
        return { storage, testDataDir };
      },
      cleanup: (context: any) => {
        if (context.testDataDir && existsSync(context.testDataDir)) {
          rmSync(context.testDataDir, { recursive: true, force: true });
        }
      }
    }
    // TODO: Add MongoDB and Redis providers when test environment supports them
    // {
    //   name: 'MongoStorage',
    //   createProvider: () => {
    //     const storage = new MongoStorageProvider({
    //       connectionString: process.env.TEST_MONGODB_URL || 'mongodb://localhost:27017/taskdriver-test'
    //     });
    //     return { storage };
    //   },
    //   cleanup: async (context: any) => {
    //     await context.storage.dropDatabase?.();
    //   }
    // },
    // {
    //   name: 'RedisStorage',
    //   createProvider: () => {
    //     const storage = new RedisStorageProvider({
    //       connectionString: process.env.TEST_REDIS_URL || 'redis://localhost:6379/1'
    //     });
    //     return { storage };
    //   },
    //   cleanup: async (context: any) => {
    //     await context.storage.flushAll?.();
    //   }
    // }
  ];

  // Run the same behavioral tests for each storage provider
  storageProviders.forEach(providerConfig => {
    describe(`${providerConfig.name} storage provider`, () => {
      let storage: StorageProvider;
      let context: any;
      let projectService: ProjectService;
      let taskTypeService: TaskTypeService;
      let taskService: TaskService;
      let agentService: AgentService;
      let leaseService: LeaseService;

      beforeEach(async () => {
        context = providerConfig.createProvider();
        storage = context.storage;
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
        providerConfig.cleanup(context);
      });

      it('should atomically assign tasks preventing race conditions', async () => {
        // Create test project
        const project = await projectService.createProject({
          name: 'atomic-test',
          description: 'Test atomic operations',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        // Create test task type
        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'atomic-task',
          template: 'Process {{resource}}',
          variables: ['resource'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        // Create a task
        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test atomic assignment',
          variables: { resource: 'test.txt' }
        });

        expect(task.status).toBe('queued');
        expect(task.assignedTo).toBeUndefined();

        // Test atomic assignment - first assignment should succeed
        const assignment1 = await agentService.getNextTask(project.id, 'agent-1');
        expect(assignment1.task).toBeTruthy();
        expect(assignment1.task!.id).toBe(task.id);
        expect(assignment1.task!.assignedTo).toBe('agent-1');
        expect(assignment1.task!.status).toBe('running');

        // Test atomicity - second assignment should fail (no more queued tasks)
        const assignment2 = await agentService.getNextTask(project.id, 'agent-2');
        expect(assignment2.task).toBeNull(); // Should fail because task is already assigned
      });

      it('should maintain data consistency during concurrent operations', async () => {
        // Create test project
        const project = await projectService.createProject({
          name: 'consistency-test',
          description: 'Test data consistency',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        // Create test task type
        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'consistency-task',
          template: 'Process item {{id}}',
          variables: ['id'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        // Create multiple tasks
        const tasks = await Promise.all([
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: 'Task 1',
            variables: { id: '1' }
          }),
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: 'Task 2',
            variables: { id: '2' }
          }),
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: 'Task 3',
            variables: { id: '3' }
          })
        ]);

        expect(tasks).toHaveLength(3);
        tasks.forEach(task => {
          expect(task.status).toBe('queued');
          expect(task.assignedTo).toBeUndefined();
        });

        // Simulate concurrent assignment attempts
        const assignmentPromises = tasks.map((task, index) => 
          agentService.getNextTask(project.id, `agent-${index + 1}`)
        );

        const assignmentResults = await Promise.all(assignmentPromises);

        // All assignments should succeed since they're for different tasks
        assignmentResults.forEach((result, index) => {
          expect(result.task).toBeTruthy();
          expect(result.task!.assignedTo).toBe(`agent-${index + 1}`);
          expect(result.task!.status).toBe('running');
        });

        // Verify final state consistency
        const finalTasks = await Promise.all(
          tasks.map(task => taskService.getTask(task.id))
        );

        // Check that all tasks are running and assigned, but don't assume specific assignment order
        expect(finalTasks).toHaveLength(3);
        finalTasks.forEach(task => {
          expect(task!.status).toBe('running');
          expect(task!.assignedTo).toBeTruthy();
          expect(task!.assignedTo).toMatch(/^agent-[1-3]$/);
        });
        
        // Verify all agents got different tasks
        const assignedAgents = new Set(finalTasks.map(task => task!.assignedTo));
        expect(assignedAgents.size).toBe(3);
      });

      it('should handle task completion and state transitions correctly', async () => {
        // Create test project and task type
        const project = await projectService.createProject({
          name: 'completion-test',
          description: 'Test task completion',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'completion-task',
          template: 'Complete {{action}}',
          variables: ['action'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test completion',
          variables: { action: 'processing' }
        });

        // Assign task
        const assignment = await agentService.getNextTask(project.id, 'completion-agent');
        expect(assignment.task).toBeTruthy();
        expect(assignment.task!.id).toBe(task.id);

        // Complete task
        await agentService.completeTask(
          'completion-agent',
          project.id,
          task.id,
          { success: true, data: 'Task completed' }
        );

        const completedTask = await taskService.getTask(task.id);
        expect(completedTask!.status).toBe('completed');
        expect(completedTask!.assignedTo).toBeUndefined();
        expect(completedTask!.leaseExpiresAt).toBeUndefined();
        expect(completedTask!.completedAt).toBeInstanceOf(Date);
      });

      it('should handle task failure and retry logic correctly', async () => {
        // Create test project and task type
        const project = await projectService.createProject({
          name: 'retry-test',
          description: 'Test retry logic',
          config: {
            defaultMaxRetries: 2, // Allow 2 retries
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'retry-task',
          template: 'Process with retry {{id}}',
          variables: ['id'],
          maxRetries: 2,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test retry',
          variables: { id: 'retry-test' }
        });

        // Assign and fail task first time
        const assignment = await agentService.getNextTask(project.id, 'retry-agent');
        expect(assignment.task).toBeTruthy();
        expect(assignment.task!.id).toBe(task.id);

        // Fail task (should be requeued for retry)
        await agentService.failTask(
          'retry-agent',
          project.id,
          task.id,
          { success: false, error: 'Simulated failure' }
        );

        const failedTask = await taskService.getTask(task.id);
        expect(failedTask!.status).toBe('queued');
        expect(failedTask!.retryCount).toBe(1);
        expect(failedTask!.assignedTo).toBeUndefined();

        // Task should be available for retry assignment
        const retryAssignment = await agentService.getNextTask(project.id, 'retry-agent-2');
        expect(retryAssignment.task).toBeTruthy();
        expect(retryAssignment.task!.id).toBe(task.id);
        expect(retryAssignment.task!.assignedTo).toBe('retry-agent-2');
        expect(retryAssignment.task!.retryCount).toBe(1);
      });

      it('should handle storage failures gracefully during atomic operations', async () => {
        // Create test project and task
        const project = await projectService.createProject({
          name: 'failure-test',
          description: 'Test failure handling',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'failure-task',
          template: 'Test {{item}}',
          variables: ['item'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test failure handling',
          variables: { item: 'failure-test' }
        });

        // Test assignment with invalid project should fail gracefully
        await expect(agentService.getNextTask('non-existent-project', 'test-agent'))
          .rejects.toThrow();

        // Test assignment with valid project should succeed
        const validAssignment = await agentService.getNextTask(project.id, 'agent-1');
        expect(validAssignment.task).toBeTruthy();
        expect(validAssignment.task!.id).toBe(task.id);

        // Double assignment should fail (no more queued tasks)
        const doubleAssignment = await agentService.getNextTask(project.id, 'agent-2');
        expect(doubleAssignment.task).toBeNull();
      });

      it('should handle concurrent lease extensions correctly', async () => {
        // Create test setup
        const project = await projectService.createProject({
          name: 'lease-extension-test',
          description: 'Test lease extensions',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'lease-task',
          template: 'Process {{data}}',
          variables: ['data'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test lease extension',
          variables: { data: 'test' }
        });

        // Assign task
        const assignment = await agentService.getNextTask(project.id, 'lease-agent');
        expect(assignment.task).toBeTruthy();
        expect(assignment.task!.id).toBe(task.id);

        // Test concurrent lease extensions
        await Promise.all([
          agentService.extendTaskLease(task.id, 'lease-agent', 15),
          agentService.extendTaskLease(task.id, 'lease-agent', 20)
        ]);

        // Both extensions should succeed without throwing errors

        // Verify final state
        const finalTask = await taskService.getTask(task.id);
        expect(finalTask!.leaseExpiresAt).toBeInstanceOf(Date);
        expect(finalTask!.assignedTo).toBe('lease-agent');
        expect(finalTask!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      });

      it('should handle task retry scenarios with proper state management', async () => {
        // Create test setup
        const project = await projectService.createProject({
          name: 'retry-test',
          description: 'Test retry scenarios',
          config: {
            defaultMaxRetries: 1, // Allow only 1 retry
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'retry-task',
          template: 'Retry {{attempt}}',
          variables: ['attempt'],
          maxRetries: 1, // Allow only 1 retry, so task fails after 2 total attempts
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Test retry logic',
          variables: { attempt: '1' }
        });

        // First attempt
        const assignment1 = await agentService.getNextTask(project.id, 'retry-agent-1');
        expect(assignment1.task).toBeTruthy();
        expect(assignment1.task!.id).toBe(task.id);

        // Fail first attempt
        await agentService.failTask(
          'retry-agent-1',
          project.id,
          task.id,
          { success: false, error: 'First attempt failed' }
        );
        
        const failed1 = await taskService.getTask(task.id);
        expect(failed1!.status).toBe('queued');
        expect(failed1!.retryCount).toBe(1);

        // Second attempt
        const assignment2 = await agentService.getNextTask(project.id, 'retry-agent-2');
        expect(assignment2.task).toBeTruthy();
        expect(assignment2.task!.id).toBe(task.id);
        expect(assignment2.task!.retryCount).toBe(1);

        // Fail second attempt (should reach max retries)
        await agentService.failTask(
          'retry-agent-2',
          project.id,
          task.id,
          { success: false, error: 'Second attempt failed' }
        );
        
        const failed2 = await taskService.getTask(task.id);
        // After 2 failures with maxRetries=1, task should be failed permanently
        expect(failed2!.status).toBe('failed');
        expect(failed2!.retryCount).toBe(2); // 2 total attempts (initial + 1 retry)

        // Verify task cannot be assigned again
        const noMoreRetries = await agentService.getNextTask(project.id, 'retry-agent-3');
        expect(noMoreRetries.task).toBeNull();
      });

      it('should enforce project isolation at storage level', async () => {
        // Create two separate projects
        const project1 = await projectService.createProject({
          name: 'isolation-test-1',
          description: 'First isolated project',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const project2 = await projectService.createProject({
          name: 'isolation-test-2',
          description: 'Second isolated project',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        // Create task types in each project
        const taskType1 = await taskTypeService.createTaskType({
          projectId: project1.id,
          name: 'isolated-task-1',
          template: 'P1: {{data}}',
          variables: ['data'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const taskType2 = await taskTypeService.createTaskType({
          projectId: project2.id,
          name: 'isolated-task-2',
          template: 'P2: {{data}}',
          variables: ['data'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        // Create tasks in each project
        const task1 = await taskService.createTask({
          projectId: project1.id,
          typeId: taskType1.id,
          instructions: 'Project 1 task',
          variables: { data: 'p1-data' }
        });

        const task2 = await taskService.createTask({
          projectId: project2.id,
          typeId: taskType2.id,
          instructions: 'Project 2 task',
          variables: { data: 'p2-data' }
        });

        // Verify project isolation through service layer
        const project1Tasks = await taskService.listTasks(project1.id);
        const project2Tasks = await taskService.listTasks(project2.id);

        expect(project1Tasks).toHaveLength(1);
        expect(project2Tasks).toHaveLength(1);
        expect(project1Tasks[0].id).toBe(task1.id);
        expect(project2Tasks[0].id).toBe(task2.id);

        // Verify cross-project operations fail gracefully
        await expect(taskService.getTask(task2.id)).resolves.toBeTruthy(); // Can get by task ID globally
        await expect(taskService.getTask(task1.id)).resolves.toBeTruthy(); // Can get by task ID globally
        
        // But project isolation exists for assignments
        const p1Assignment = await agentService.getNextTask(project1.id, 'p1-agent');
        expect(p1Assignment.task!.id).toBe(task1.id);
        
        const p2Assignment = await agentService.getNextTask(project2.id, 'p2-agent');
        expect(p2Assignment.task!.id).toBe(task2.id);
        
        // Cross-project assignments return nothing
        const nothingLeft1 = await agentService.getNextTask(project1.id, 'p1-agent-2');
        const nothingLeft2 = await agentService.getNextTask(project2.id, 'p2-agent-2');
        expect(nothingLeft1.task).toBeNull();
        expect(nothingLeft2.task).toBeNull();
      });

      it('should handle storage failures during concurrent operations', async () => {
        // Create test setup
        const project = await projectService.createProject({
          name: 'concurrent-failure-test',
          description: 'Test concurrent failures',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'concurrent-task',
          template: 'Test {{id}}',
          variables: ['id'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Concurrent test',
          variables: { id: 'concurrent-1' }
        });

        // Test concurrent assignment attempts with mixed valid/invalid operations
        const concurrentOperations = await Promise.allSettled([
          // Invalid operations that should fail gracefully
          agentService.getNextTask('non-existent-project', 'agent-1'),
          agentService.completeTask('agent-2', project.id, 'non-existent-task', { success: true }),
          // Valid assignment
          agentService.getNextTask(project.id, 'agent-3')
        ]);

        // Check results: invalid operations should reject, valid should succeed
        expect(concurrentOperations[0].status).toBe('rejected'); // Invalid project
        expect(concurrentOperations[1].status).toBe('rejected'); // Non-existent task
        expect(concurrentOperations[2].status).toBe('fulfilled'); // Valid assignment
        
        if (concurrentOperations[2].status === 'fulfilled') {
          expect(concurrentOperations[2].value.task).toBeTruthy();
          expect(concurrentOperations[2].value.task!.id).toBe(task.id);
        }

        // Verify final state
        const finalTask = await taskService.getTask(task.id);
        expect(finalTask!.assignedTo).toBe('agent-3');
        expect(finalTask!.status).toBe('running');
      });

      it('should handle task state transition errors correctly', async () => {
        // Create test setup
        const project = await projectService.createProject({
          name: 'transition-error-test',
          description: 'Test state transition errors',
          config: {
            defaultMaxRetries: 2,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'transition-task',
          template: 'Transition {{type}}',
          variables: ['type'],
          maxRetries: 2,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        const task = await taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'State transition test',
          variables: { type: 'error-test' }
        });

        // Valid assignment
        const assignment = await agentService.getNextTask(project.id, 'transition-agent');
        expect(assignment.task).toBeTruthy();
        expect(assignment.task!.id).toBe(task.id);

        // Invalid state transitions should fail gracefully
        const invalidOperations = await Promise.allSettled([
          // Try to assign already running task (should return null)
          agentService.getNextTask(project.id, 'other-agent'),
          // Try to complete with wrong agent
          agentService.completeTask('wrong-agent', project.id, task.id, { success: true }),
          // Valid completion
          agentService.completeTask('transition-agent', project.id, task.id, { success: true })
        ]);

        // First operation should succeed but return null (no tasks available)
        expect(invalidOperations[0].status).toBe('fulfilled');
        if (invalidOperations[0].status === 'fulfilled') {
          expect(invalidOperations[0].value.task).toBeNull();
        }
        
        // Second operation should fail (wrong agent)
        expect(invalidOperations[1].status).toBe('rejected');
        
        // Third operation should succeed (correct agent)
        expect(invalidOperations[2].status).toBe('fulfilled');
        
        // Verify final state
        const finalTask = await taskService.getTask(task.id);
        expect(finalTask!.status).toBe('completed');
      });

      it('should handle bulk operations with mixed success/failure', async () => {
        // Create test setup
        const project = await projectService.createProject({
          name: 'bulk-operations-test',
          description: 'Test bulk operations',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          }
        });

        const taskType = await taskTypeService.createTaskType({
          projectId: project.id,
          name: 'bulk-task',
          template: 'Bulk {{index}}',
          variables: ['index'],
          maxRetries: 3,
          leaseDurationMinutes: 10,
          duplicateHandling: 'allow'
        });

        // Create multiple tasks using bulk operation
        const bulkTasks = [
          { type: taskType.id, vars: { index: '1' } },
          { type: taskType.id, vars: { index: '2' } },
          { type: taskType.id, vars: { index: '3' } }
        ];
        
        const bulkResult = await taskService.createTasksBulk(project.id, bulkTasks);
        expect(bulkResult.tasksCreated).toBe(3);
        expect(bulkResult.errors).toHaveLength(0);

        // Perform bulk assignment operations
        const bulkAssignments = await Promise.allSettled([
          agentService.getNextTask(project.id, 'bulk-agent-1'),
          agentService.getNextTask(project.id, 'bulk-agent-2'),
          agentService.getNextTask(project.id, 'bulk-agent-3'),
          // This should return null - no more tasks
          agentService.getNextTask(project.id, 'bulk-agent-4')
        ]);

        // All should succeed, but only first three should get tasks
        expect(bulkAssignments[0].status).toBe('fulfilled');
        expect(bulkAssignments[1].status).toBe('fulfilled');
        expect(bulkAssignments[2].status).toBe('fulfilled');
        expect(bulkAssignments[3].status).toBe('fulfilled');
        
        if (bulkAssignments[0].status === 'fulfilled') {
          expect(bulkAssignments[0].value.task).toBeTruthy();
        }
        if (bulkAssignments[1].status === 'fulfilled') {
          expect(bulkAssignments[1].value.task).toBeTruthy();
        }
        if (bulkAssignments[2].status === 'fulfilled') {
          expect(bulkAssignments[2].value.task).toBeTruthy();
        }
        if (bulkAssignments[3].status === 'fulfilled') {
          expect(bulkAssignments[3].value.task).toBeNull(); // No more tasks
        }
        
        // Count successful assignments
        const assignedTasks = bulkAssignments
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as any).value.task)
          .filter(task => task !== null);
        expect(assignedTasks).toHaveLength(3);

        // Verify final states
        const finalTasks = await taskService.listTasks(project.id);
        expect(finalTasks).toHaveLength(3);
        expect(finalTasks.every(task => task.status === 'running')).toBe(true);
      });
    });
  });
});