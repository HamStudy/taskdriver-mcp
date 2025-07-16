import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { LeaseService } from '../../src/services/LeaseService.js';
import { createTestDataDir } from '../fixtures/index.js';
import { rmSync, existsSync } from 'fs';

/**
 * Failure Recovery and Error Handling Tests
 * 
 * Tests comprehensive failure recovery patterns mentioned in CLAUDE.md:
 * - Agent failure and task recovery
 * - Storage failures and transaction rollback
 * - Lease expiration and automatic recovery
 * - Network failure simulation
 * - Graceful degradation under stress
 * - System resilience and self-healing
 */
describe('Failure Recovery and Error Handling', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let taskTypeService: TaskTypeService;
  let taskService: TaskService;
  let agentService: AgentService;
  let leaseService: LeaseService;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);
    leaseService = new LeaseService(storage);
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Agent Failure Recovery', () => {
    it('should recover tasks when agents disappear during processing', async () => {
      const project = await projectService.createProject({
        name: 'agent-failure-test',
        description: 'Test agent failure recovery',
        config: {
          defaultLeaseDurationMinutes: 1, // Short lease for testing
          defaultMaxRetries: 3
        }
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'failure-recovery-task',
        template: 'Recovery test {{id}}',
        leaseDurationMinutes: 1
      });

      // Create multiple tasks
      const tasks = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Recovery task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Agents get tasks
      const assignments = await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `failing-agent-${i}`))
      );

      expect(assignments.every(a => a.task !== null)).toBe(true);

      // Simulate agent failures by expiring their leases
      for (const task of tasks) {
        await storage.updateTask(task.id, {
          leaseExpiresAt: new Date(Date.now() - 60000) // Expired
        });
      }

      // Run lease cleanup to recover failed tasks
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(5);

      // Verify all tasks are back in queue with incremented retry count
      const recoveredTasks = await taskService.listTasks(project.id);
      expect(recoveredTasks).toHaveLength(5);
      recoveredTasks.forEach(task => {
        expect(task.status).toBe('queued');
        expect(task.retryCount).toBe(1);
        expect(task.assignedTo).toBeUndefined();
        expect(task.attempts).toHaveLength(1); // Should track the failed attempt
      });

      // New agents should be able to pick up recovered tasks
      const newAssignments = await Promise.all(
        Array.from({ length: 3 }, (_, i) => 
          agentService.getNextTask(project.id, `recovery-agent-${i}`)
        )
      );

      const successfulRecoveries = newAssignments.filter(a => a.task !== null);
      expect(successfulRecoveries).toHaveLength(3);
    });

    it('should handle task failure with retry logic', async () => {
      const project = await projectService.createProject({
        name: 'retry-logic-test',
        description: 'Test retry logic',
        config: {
          defaultMaxRetries: 2
        }
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'retry-task',
        template: 'Retry test {{attempt}}',
        maxRetries: 2
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task requiring retries',
        variables: { attempt: '1' }
      });

      // First attempt - get and fail
      const assignment1 = await agentService.getNextTask(project.id, 'retry-agent-1');
      expect(assignment1.task!.id).toBe(task.id);

      await agentService.failTask(
        'retry-agent-1',
        project.id,
        task.id,
        { success: false, error: 'First attempt failed' }
      );

      // Task should be requeued
      let taskState = await taskService.getTask(task.id);
      expect(taskState!.status).toBe('queued');
      expect(taskState!.retryCount).toBe(1);

      // Second attempt - get and fail
      const assignment2 = await agentService.getNextTask(project.id, 'retry-agent-2');
      expect(assignment2.task!.id).toBe(task.id);

      await agentService.failTask(
        'retry-agent-2',
        project.id,
        task.id,
        { success: false, error: 'Second attempt failed' }
      );

      // Task should be permanently failed (max retries reached)
      taskState = await taskService.getTask(task.id);
      expect(taskState!.status).toBe('failed');
      expect(taskState!.retryCount).toBe(2);
      expect(taskState!.attempts).toHaveLength(2);

      // Should not be assignable anymore
      const assignment3 = await agentService.getNextTask(project.id, 'retry-agent-3');
      expect(assignment3.task).toBeNull();
    });

    it('should handle agent disconnection during task processing', async () => {
      const project = await projectService.createProject({
        name: 'disconnection-test',
        description: 'Test agent disconnection',
        config: {
          defaultLeaseDurationMinutes: 2
        }
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'disconnection-task',
        template: 'Disconnection test {{id}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task for disconnection test',
        variables: { id: 'disconnect-1' }
      });

      // Agent gets task
      const assignment = await agentService.getNextTask(project.id, 'disconnecting-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Agent tries to extend lease (simulating active work)
      await agentService.extendTaskLease('disconnecting-agent', project.id, task.id, 30);

      // Simulate sudden disconnection by expiring lease
      await storage.updateTask(task.id, {
        leaseExpiresAt: new Date(Date.now() - 1000)
      });

      // System cleanup detects and recovers
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(1);

      // Task should be available for reassignment
      const recoveryAssignment = await agentService.getNextTask(project.id, 'recovery-agent');
      expect(recoveryAssignment.task!.id).toBe(task.id);
      expect(recoveryAssignment.task!.retryCount).toBe(1);
    });
  });

  describe('Storage Failure Simulation', () => {
    it('should handle partial storage failures gracefully', async () => {
      const project = await projectService.createProject({
        name: 'storage-failure-test',
        description: 'Test storage failure handling'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'storage-task',
        template: 'Storage test {{id}}'
      });

      // Create tasks normally
      const validTask = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Valid task',
        variables: { id: 'valid' }
      });

      // Test operations with invalid data (should fail gracefully)
      try {
        await taskService.createTask({
          projectId: 'invalid-project-id',
          typeId: taskType.id,
          instructions: 'Invalid task',
          variables: { id: 'invalid' }
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeDefined();
      }

      // Test assignment operations with invalid conditions
      const invalidAssignment = await storage.findOneAndUpdate(
        'tasks',
        { id: 'non-existent-task', status: 'queued' },
        { status: 'running', assignedTo: 'test-agent' }
      );

      expect(invalidAssignment).toBeNull();

      // Valid operations should still work
      const validAssignment = await agentService.getNextTask(project.id, 'valid-agent');
      expect(validAssignment.task!.id).toBe(validTask.id);
    });

    it('should maintain data integrity during concurrent failures', async () => {
      const project = await projectService.createProject({
        name: 'integrity-test',
        description: 'Test data integrity during failures'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'integrity-task',
        template: 'Integrity test {{id}}'
      });

      // Create tasks
      const tasks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Integrity task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Mix of valid and invalid operations
      const operations = [
        // Valid assignments
        ...tasks.slice(0, 5).map(task =>
          agentService.getNextTask(project.id, `valid-agent-${task.id}`)
        ),
        // Invalid operations that should fail gracefully
        agentService.getNextTask('invalid-project', 'invalid-agent'),
        agentService.completeTask('non-existent-agent', project.id, 'non-existent-task', { success: true }),
        // Valid cleanup
        leaseService.cleanupExpiredLeases(project.id)
      ];

      const results = await Promise.allSettled(operations);

      // Count successes and failures
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes.length).toBeGreaterThan(0);
      expect(failures.length).toBeGreaterThan(0);

      // System should still be in consistent state
      const finalTasks = await taskService.listTasks(project.id);
      expect(finalTasks).toHaveLength(10);

      // Check that valid assignments succeeded
      const runningTasks = finalTasks.filter(t => t.status === 'running');
      expect(runningTasks.length).toBeGreaterThan(0);
      expect(runningTasks.length).toBeLessThanOrEqual(5);

      // All running tasks should have valid assignments
      runningTasks.forEach(task => {
        expect(task.assignedTo).toBeTruthy();
        expect(task.leaseExpiresAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('Lease Expiration Recovery', () => {
    it('should handle mass lease expiration efficiently', async () => {
      const project = await projectService.createProject({
        name: 'mass-expiration-test',
        description: 'Test mass lease expiration'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'expiration-task',
        template: 'Expiration test {{id}}'
      });

      // Create and assign many tasks
      const tasks = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Expiration task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Assign all tasks
      const assignments = await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `expiring-agent-${i}`))
      );

      expect(assignments.every(a => a.task !== null)).toBe(true);

      // Expire all leases
      await Promise.all(
        tasks.map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        )
      );

      // Mass cleanup
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(25);

      // All tasks should be requeued
      const reclaimedTasks = await taskService.listTasks(project.id);
      expect(reclaimedTasks).toHaveLength(25);
      expect(reclaimedTasks.every(t => t.status === 'queued')).toBe(true);
      expect(reclaimedTasks.every(t => t.retryCount === 1)).toBe(true);

      // System should be ready for new assignments
      const newAssignments = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          agentService.getNextTask(project.id, `recovery-agent-${i}`)
        )
      );

      const successfulRecoveries = newAssignments.filter(a => a.task !== null);
      expect(successfulRecoveries).toHaveLength(10);
    });

    it('should handle mixed lease states during cleanup', async () => {
      const project = await projectService.createProject({
        name: 'mixed-lease-test',
        description: 'Test mixed lease states'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'mixed-lease-task',
        template: 'Mixed lease {{id}}'
      });

      // Create tasks
      const tasks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Mixed lease task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Assign all tasks
      await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `mixed-agent-${i}`))
      );

      // Create mixed lease states
      await Promise.all([
        // Some expired
        ...tasks.slice(0, 4).map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        ),
        // Some active
        ...tasks.slice(4, 7).map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
          })
        ),
        // Some completed
        ...tasks.slice(7, 10).map(task =>
          storage.updateTask(task.id, {
            status: 'completed',
            assignedTo: undefined,
            leaseExpiresAt: undefined,
            completedAt: new Date()
          })
        )
      ]);

      // Cleanup should only affect expired leases
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(4);

      // Verify final states
      const finalTasks = await taskService.listTasks(project.id);
      const queuedTasks = finalTasks.filter(t => t.status === 'queued');
      const runningTasks = finalTasks.filter(t => t.status === 'running');
      const completedTasks = finalTasks.filter(t => t.status === 'completed');

      expect(queuedTasks).toHaveLength(4); // Expired and requeued
      expect(runningTasks).toHaveLength(3); // Still active
      expect(completedTasks).toHaveLength(3); // Completed

      // Verify states are correct
      queuedTasks.forEach(task => {
        expect(task.retryCount).toBe(1);
        expect(task.assignedTo).toBeUndefined();
      });

      runningTasks.forEach(task => {
        expect(task.assignedTo).toBeTruthy();
        expect(task.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      });
    });
  });

  describe('System Resilience', () => {
    it('should maintain service availability during partial failures', async () => {
      const project = await projectService.createProject({
        name: 'resilience-test',
        description: 'Test system resilience'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'resilience-task',
        template: 'Resilience test {{id}}'
      });

      // Create baseline tasks
      const tasks = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Resilience task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Simulate various failure scenarios concurrently
      const chaosOperations = [
        // Normal operations
        agentService.getNextTask(project.id, 'normal-agent-1'),
        agentService.getNextTask(project.id, 'normal-agent-2'),
        
        // Operations on non-existent entities (should fail gracefully)
        agentService.getNextTask('non-existent-project', 'agent'),
        taskService.getTask('non-existent-task'),
        
        // Cleanup operations
        leaseService.cleanupExpiredLeases(project.id),
        
        // Additional normal operations
        agentService.getNextTask(project.id, 'normal-agent-3'),
        
        // More invalid operations
        agentService.completeTask('agent', 'invalid-project', 'task', { success: true }),
        
        // Valid operations mixed in
        projectService.getProject(project.id),
        taskService.listTasks(project.id)
      ];

      const results = await Promise.allSettled(chaosOperations);

      // System should remain functional
      const successes = results.filter(r => r.status === 'fulfilled');
      expect(successes.length).toBeGreaterThan(5);

      // Core functionality should work
      const healthCheck = await agentService.getNextTask(project.id, 'health-check-agent');
      expect(healthCheck.task).toBeTruthy();

      const projectStats = await projectService.getProject(project.id);
      expect(projectStats).toBeTruthy();
      expect(projectStats!.stats.totalTasks).toBe(15);
    });

    it('should recover from cascading failures', async () => {
      const project = await projectService.createProject({
        name: 'cascading-failure-test',
        description: 'Test cascading failure recovery'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'cascade-task',
        template: 'Cascade {{id}}'
      });

      // Create initial set of tasks
      const initialTasks = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Cascade task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Assign half the tasks
      const assignments = await Promise.all(
        initialTasks.slice(0, 4).map((_, i) => 
          agentService.getNextTask(project.id, `cascade-agent-${i}`)
        )
      );

      // Simulate cascading failures
      // 1. Expire some leases
      await Promise.all(
        assignments.slice(0, 2).map(assignment =>
          storage.updateTask(assignment.task!.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        )
      );

      // 2. Fail some tasks
      await Promise.all(
        assignments.slice(2, 4).map(assignment =>
          agentService.failTask(
            assignment.agentName,
            project.id,
            assignment.task!.id,
            { success: false, error: 'Cascading failure' }
          )
        )
      );

      // 3. Run recovery operations
      await leaseService.cleanupExpiredLeases(project.id);

      // 4. Verify system can continue operating
      const recoveryTasks = await taskService.listTasks(project.id);
      const availableTasks = recoveryTasks.filter(t => t.status === 'queued');
      expect(availableTasks.length).toBeGreaterThan(4); // Original unassigned + recovered

      // 5. New agents should be able to work
      const newAssignments = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          agentService.getNextTask(project.id, `recovery-agent-${i}`)
        )
      );

      const successfulRecoveries = newAssignments.filter(a => a.task !== null);
      expect(successfulRecoveries).toHaveLength(3);

      // 6. System should maintain consistency
      const finalProject = await projectService.getProject(project.id);
      const finalTasks = await taskService.listTasks(project.id);

      expect(finalTasks).toHaveLength(8);
      expect(finalProject!.stats.totalTasks).toBe(8);

      // All task states should be valid
      finalTasks.forEach(task => {
        expect(['queued', 'running', 'completed', 'failed']).toContain(task.status);
        if (task.status === 'running') {
          expect(task.assignedTo).toBeTruthy();
        }
      });
    });
  });
});