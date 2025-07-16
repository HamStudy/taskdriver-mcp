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
 * Comprehensive Reaper Service Tests
 * 
 * Tests all aspects of the reaper service mentioned in CLAUDE.md:
 * - Expired lease detection and cleanup
 * - Task recovery and retry logic
 * - Agent status cleanup
 * - Performance under high load
 * - Edge cases and error conditions
 * - Batch processing efficiency
 */
describe('Comprehensive Reaper Service', () => {
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

  describe('Basic Reaper Functionality', () => {
    it('should detect and reclaim expired leases correctly', async () => {
      const project = await projectService.createProject({
        name: 'basic-reaper-test',
        description: 'Test basic reaper functionality'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'reaper-task',
        template: 'Reaper test {{id}}'
      });

      // Create and assign tasks
      const tasks = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Reaper task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Assign all tasks
      const assignments = await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `reaper-agent-${i}`))
      );

      expect(assignments.every(a => a.task !== null)).toBe(true);

      // Expire some leases (not all)
      await Promise.all([
        storage.updateTask(tasks[0].id, { leaseExpiresAt: new Date(Date.now() - 60000) }),
        storage.updateTask(tasks[1].id, { leaseExpiresAt: new Date(Date.now() - 30000) }),
        storage.updateTask(tasks[2].id, { leaseExpiresAt: new Date(Date.now() - 5000) })
        // Leave tasks[3] and tasks[4] with valid leases
      ]);

      // Run reaper
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      expect(cleanupResult.reclaimedTasks).toBe(3);
      expect(cleanupResult.cleanedAgents).toBeGreaterThanOrEqual(0);

      // Verify task states
      const task0 = await taskService.getTask(tasks[0].id);
      const task1 = await taskService.getTask(tasks[1].id);
      const task2 = await taskService.getTask(tasks[2].id);
      const task3 = await taskService.getTask(tasks[3].id);
      const task4 = await taskService.getTask(tasks[4].id);

      // Expired tasks should be requeued
      expect(task0!.status).toBe('queued');
      expect(task0!.retryCount).toBe(1);
      expect(task0!.assignedTo).toBeUndefined();

      expect(task1!.status).toBe('queued');
      expect(task1!.retryCount).toBe(1);

      expect(task2!.status).toBe('queued');
      expect(task2!.retryCount).toBe(1);

      // Non-expired tasks should remain running
      expect(task3!.status).toBe('running');
      expect(task3!.assignedTo).toBe('reaper-agent-3');

      expect(task4!.status).toBe('running');
      expect(task4!.assignedTo).toBe('reaper-agent-4');
    });

    it('should handle attempts tracking during reaping', async () => {
      const project = await projectService.createProject({
        name: 'attempts-tracking-test',
        description: 'Test attempts tracking'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'tracking-task',
        template: 'Tracking test {{id}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Attempts tracking test',
        variables: { id: 'track-1' }
      });

      // Agent gets task
      const assignment = await agentService.getNextTask(project.id, 'tracking-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Verify initial state
      let taskState = await taskService.getTask(task.id);
      expect(taskState!.attempts).toHaveLength(0); // No attempts yet (task just assigned)

      // Expire the lease
      await storage.updateTask(task.id, {
        leaseExpiresAt: new Date(Date.now() - 60000)
      });

      // Run reaper
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(1);

      // Verify attempt was recorded
      taskState = await taskService.getTask(task.id);
      expect(taskState!.status).toBe('queued');
      expect(taskState!.retryCount).toBe(1);
      expect(taskState!.attempts).toHaveLength(1);

      const attempt = taskState!.attempts[0];
      expect(attempt.agentId).toBe('tracking-agent');
      expect(attempt.startedAt).toBeInstanceOf(Date);
      expect(attempt.completedAt).toBeInstanceOf(Date);
      expect(attempt.error).toContain('lease expired');
    });

    it('should respect max retry limits during reaping', async () => {
      const project = await projectService.createProject({
        name: 'max-retry-test',
        description: 'Test max retry limits',
        config: {
          defaultMaxRetries: 2
        }
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'retry-limit-task',
        template: 'Retry limit test {{id}}',
        maxRetries: 2
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Max retry test',
        variables: { id: 'retry-1' }
      });

      // First failure
      const assignment1 = await agentService.getNextTask(project.id, 'retry-agent-1');
      await storage.updateTask(task.id, { leaseExpiresAt: new Date(Date.now() - 60000) });
      await leaseService.cleanupExpiredLeases(project.id);

      // Second failure
      const assignment2 = await agentService.getNextTask(project.id, 'retry-agent-2');
      await storage.updateTask(task.id, { leaseExpiresAt: new Date(Date.now() - 60000) });
      await leaseService.cleanupExpiredLeases(project.id);

      // Third failure - should mark as permanently failed
      const assignment3 = await agentService.getNextTask(project.id, 'retry-agent-3');
      expect(assignment3.task).toBeNull(); // Task should be failed, not available

      // Verify task is permanently failed
      const finalTask = await taskService.getTask(task.id);
      expect(finalTask!.status).toBe('failed');
      expect(finalTask!.retryCount).toBe(2);
      expect(finalTask!.attempts).toHaveLength(2);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large numbers of expired leases efficiently', async () => {
      const project = await projectService.createProject({
        name: 'large-scale-reaper-test',
        description: 'Test large scale reaper performance'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'scale-task',
        template: 'Scale test {{batch}}-{{id}}'
      });

      // Create many tasks in batches
      const totalTasks = 100;
      const tasks = [];
      
      for (let batch = 0; batch < 4; batch++) {
        const batchTasks = await Promise.all(
          Array.from({ length: 25 }, (_, i) =>
            taskService.createTask({
              projectId: project.id,
              typeId: taskType.id,
              instructions: `Scale task batch ${batch}, item ${i}`,
              variables: { batch: batch.toString(), id: i.toString() }
            })
          )
        );
        tasks.push(...batchTasks);
      }

      expect(tasks).toHaveLength(totalTasks);

      // Assign all tasks
      const assignments = await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `scale-agent-${i}`))
      );

      expect(assignments.every(a => a.task !== null)).toBe(true);

      // Expire 75% of the leases
      const expiredCount = 75;
      await Promise.all(
        tasks.slice(0, expiredCount).map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        )
      );

      // Measure reaper performance
      const startTime = Date.now();
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      const duration = Date.now() - startTime;

      expect(cleanupResult.reclaimedTasks).toBe(expiredCount);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify system consistency
      const finalTasks = await taskService.listTasks(project.id);
      expect(finalTasks).toHaveLength(totalTasks);

      const queuedTasks = finalTasks.filter(t => t.status === 'queued');
      const runningTasks = finalTasks.filter(t => t.status === 'running');

      expect(queuedTasks).toHaveLength(expiredCount);
      expect(runningTasks).toHaveLength(totalTasks - expiredCount);

      // All requeued tasks should have incremented retry count
      queuedTasks.forEach(task => {
        expect(task.retryCount).toBe(1);
        expect(task.assignedTo).toBeUndefined();
      });
    });

    it('should handle concurrent reaper operations safely', async () => {
      const project = await projectService.createProject({
        name: 'concurrent-reaper-test',
        description: 'Test concurrent reaper safety'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'concurrent-reaper-task',
        template: 'Concurrent reaper {{id}}'
      });

      // Create and assign tasks
      const tasks = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Concurrent reaper task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `concurrent-agent-${i}`))
      );

      // Expire half the leases
      await Promise.all(
        tasks.slice(0, 10).map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        )
      );

      // Run multiple concurrent reaper operations
      const reaperPromises = Array.from({ length: 5 }, () =>
        leaseService.cleanupExpiredLeases(project.id)
      );

      const results = await Promise.all(reaperPromises);

      // Total reclaimed should equal expired tasks (accounting for multiple reapers)
      const totalReclaimed = results.reduce((sum, result) => sum + result.reclaimedTasks, 0);
      expect(totalReclaimed).toBeGreaterThanOrEqual(10);

      // Verify no over-processing (tasks should not be double-processed)
      const finalTasks = await taskService.listTasks(project.id);
      expect(finalTasks).toHaveLength(20);

      const queuedTasks = finalTasks.filter(t => t.status === 'queued');
      const runningTasks = finalTasks.filter(t => t.status === 'running');

      expect(queuedTasks).toHaveLength(10);
      expect(runningTasks).toHaveLength(10);

      // Each requeued task should have exactly one retry
      queuedTasks.forEach(task => {
        expect(task.retryCount).toBe(1);
      });
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle empty projects gracefully', async () => {
      const emptyProject = await projectService.createProject({
        name: 'empty-project',
        description: 'Project with no tasks'
      });

      // Run reaper on empty project
      const cleanupResult = await leaseService.cleanupExpiredLeases(emptyProject.id);

      expect(cleanupResult.reclaimedTasks).toBe(0);
      expect(cleanupResult.cleanedAgents).toBe(0);
    });

    it('should handle non-existent projects gracefully', async () => {
      // Run reaper on non-existent project
      try {
        const cleanupResult = await leaseService.cleanupExpiredLeases('non-existent-project');
        // If it doesn't throw, verify it returns empty results
        expect(cleanupResult.reclaimedTasks).toBe(0);
        expect(cleanupResult.cleanedAgents).toBe(0);
      } catch (error) {
        // If it throws, that's also acceptable behavior
        expect(error).toBeDefined();
      }
    });

    it('should handle malformed lease data safely', async () => {
      const project = await projectService.createProject({
        name: 'malformed-data-test',
        description: 'Test malformed lease data handling'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'malformed-task',
        template: 'Malformed test {{id}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Malformed lease test',
        variables: { id: 'malformed-1' }
      });

      // Assign task normally
      await agentService.getNextTask(project.id, 'malformed-agent');

      // Manually corrupt lease data
      await storage.updateTask(task.id, {
        leaseExpiresAt: null as any // Invalid lease expiration
      });

      // Reaper should handle this gracefully
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      // Should not crash and should handle the malformed data
      expect(cleanupResult).toBeDefined();
      expect(cleanupResult.reclaimedTasks).toBeGreaterThanOrEqual(0);
    });

    it('should handle tasks with very old lease expiration times', async () => {
      const project = await projectService.createProject({
        name: 'very-old-lease-test',
        description: 'Test very old lease handling'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'old-lease-task',
        template: 'Old lease test {{id}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Very old lease test',
        variables: { id: 'old-1' }
      });

      // Assign task
      await agentService.getNextTask(project.id, 'old-lease-agent');

      // Set lease to very old date
      await storage.updateTask(task.id, {
        leaseExpiresAt: new Date('2020-01-01T00:00:00Z') // Very old
      });

      // Reaper should handle this
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      expect(cleanupResult.reclaimedTasks).toBe(1);

      // Task should be properly requeued
      const reclaimedTask = await taskService.getTask(task.id);
      expect(reclaimedTask!.status).toBe('queued');
      expect(reclaimedTask!.retryCount).toBe(1);
    });

    it('should handle mixed valid and invalid lease states', async () => {
      const project = await projectService.createProject({
        name: 'mixed-lease-states-test',
        description: 'Test mixed lease states'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'mixed-states-task',
        template: 'Mixed states {{id}}'
      });

      // Create various tasks
      const tasks = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Mixed states task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Assign all tasks
      await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `mixed-agent-${i}`))
      );

      // Create mixed states
      await Promise.all([
        // Normal expired lease
        storage.updateTask(tasks[0].id, { 
          leaseExpiresAt: new Date(Date.now() - 60000) 
        }),
        // Very old expired lease
        storage.updateTask(tasks[1].id, { 
          leaseExpiresAt: new Date('2020-01-01') 
        }),
        // Future lease (valid)
        storage.updateTask(tasks[2].id, { 
          leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000) 
        }),
        // Null lease expiration (malformed)
        storage.updateTask(tasks[3].id, { 
          leaseExpiresAt: null as any 
        }),
        // Task already completed
        storage.updateTask(tasks[4].id, { 
          status: 'completed',
          assignedTo: undefined,
          leaseExpiresAt: undefined 
        })
        // Leave tasks[5] with normal lease
      ]);

      // Run reaper
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      // Should handle valid cases, ignore completed/invalid ones
      expect(cleanupResult.reclaimedTasks).toBeGreaterThanOrEqual(2);
      expect(cleanupResult.reclaimedTasks).toBeLessThanOrEqual(4);

      // Verify system remains consistent
      const finalTasks = await taskService.listTasks(project.id);
      expect(finalTasks).toHaveLength(6);

      // Verify each task has a valid status
      finalTasks.forEach(task => {
        expect(['queued', 'running', 'completed', 'failed']).toContain(task.status);
      });
    });
  });

  describe('Integration with Other Services', () => {
    it('should work correctly with agent service operations', async () => {
      const project = await projectService.createProject({
        name: 'agent-integration-test',
        description: 'Test reaper integration with agent service'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'integration-task',
        template: 'Integration test {{id}}'
      });

      // Create tasks
      const tasks = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Integration task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Agents get tasks
      const assignments = await Promise.all(
        tasks.map((_, i) => agentService.getNextTask(project.id, `integration-agent-${i}`))
      );

      // Some agents complete successfully
      await agentService.completeTask(
        'integration-agent-0',
        project.id,
        assignments[0].task!.id,
        { success: true, result: 'Completed' }
      );

      // Some agents fail
      await agentService.failTask(
        'integration-agent-1',
        project.id,
        assignments[1].task!.id,
        { success: false, error: 'Failed' }
      );

      // Some leases expire
      await storage.updateTask(assignments[2].task!.id, {
        leaseExpiresAt: new Date(Date.now() - 60000)
      });

      // Run reaper
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      // Should only affect expired leases, not completed/failed tasks
      expect(cleanupResult.reclaimedTasks).toBe(1);

      // Verify final states
      const task0 = await taskService.getTask(tasks[0].id);
      const task1 = await taskService.getTask(tasks[1].id);
      const task2 = await taskService.getTask(tasks[2].id);

      expect(task0!.status).toBe('completed'); // Completed by agent
      expect(task1!.status).toBe('queued'); // Failed and requeued by agent
      expect(task2!.status).toBe('queued'); // Expired and requeued by reaper

      // Retry counts should be correct
      expect(task0!.retryCount).toBe(0); // Completed successfully
      expect(task1!.retryCount).toBe(1); // Failed once
      expect(task2!.retryCount).toBe(1); // Expired once
    });

    it('should maintain project statistics consistency', async () => {
      const project = await projectService.createProject({
        name: 'stats-consistency-test',
        description: 'Test project stats consistency'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'stats-task',
        template: 'Stats test {{id}}'
      });

      // Create multiple tasks
      const tasks = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Stats task ${i}`,
            variables: { id: i.toString() }
          })
        )
      );

      // Check initial stats
      let projectStats = await projectService.getProject(project.id);
      expect(projectStats!.stats.totalTasks).toBe(10);
      expect(projectStats!.stats.queuedTasks).toBe(10);

      // Assign some tasks
      await Promise.all(
        tasks.slice(0, 6).map((_, i) => 
          agentService.getNextTask(project.id, `stats-agent-${i}`)
        )
      );

      // Expire some leases
      await Promise.all(
        tasks.slice(0, 3).map(task =>
          storage.updateTask(task.id, {
            leaseExpiresAt: new Date(Date.now() - 60000)
          })
        )
      );

      // Run reaper
      await leaseService.cleanupExpiredLeases(project.id);

      // Check final stats
      projectStats = await projectService.getProject(project.id);
      expect(projectStats!.stats.totalTasks).toBe(10);

      const allTasks = await taskService.listTasks(project.id);
      const taskCounts = allTasks.reduce((counts, task) => {
        counts[task.status] = (counts[task.status] || 0) + 1;
        return counts;
      }, {} as Record<string, number>);

      expect(projectStats!.stats.queuedTasks).toBe(taskCounts.queued || 0);
      expect(projectStats!.stats.runningTasks).toBe(taskCounts.running || 0);
      expect(projectStats!.stats.completedTasks).toBe(taskCounts.completed || 0);
      expect(projectStats!.stats.failedTasks).toBe(taskCounts.failed || 0);
    });
  });
});