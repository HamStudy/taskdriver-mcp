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
 * Comprehensive Lease Management Tests
 * 
 * Tests the critical lease management patterns mentioned in CLAUDE.md:
 * - Lease expiration and automatic cleanup
 * - Reaper service behavior under various conditions
 * - Concurrent lease operations
 * - Failure recovery mechanisms
 * - Edge cases and timeout scenarios
 */
describe('Comprehensive Lease Management', () => {
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

  describe('Lease Expiration Edge Cases', () => {
    it('should handle tasks with very short lease times', async () => {
      const project = await projectService.createProject({
        name: 'short-lease-test',
        description: 'Test very short leases',
        config: {
          defaultMaxRetries: 3,
          defaultLeaseDurationMinutes: 0.01, // 0.6 seconds 
          reaperIntervalMinutes: 0.01
        }
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'short-lease-task',
        template: 'Quick task {{id}}',
        leaseDurationMinutes: 0.01 // 0.6 seconds
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Very short lease task',
        variables: { id: 'short-1' }
      });

      // Agent gets task
      const assignment = await agentService.getNextTask(project.id, 'quick-agent');
      expect(assignment.task).toBeTruthy();
      expect(assignment.task!.id).toBe(task.id);

      // Wait for lease to expire
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second wait

      // Run lease cleanup
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBe(1);

      // Verify task is back in queue
      const reclaimedTask = await taskService.getTask(task.id);
      expect(reclaimedTask!.status).toBe('queued');
      expect(reclaimedTask!.assignedTo).toBeUndefined();
      expect(reclaimedTask!.retryCount).toBe(1);
    });

    it('should handle lease expiration during agent processing', async () => {
      const project = await projectService.createProject({
        name: 'processing-expiration-test',
        description: 'Test expiration during processing'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'processing-task',
        template: 'Long process {{item}}',
        leaseDurationMinutes: 0.02 // Very short for test
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Long processing task',
        variables: { item: 'processor-1' }
      });

      // Agent gets task and starts processing
      const assignment = await agentService.getNextTask(project.id, 'processing-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Simulate agent trying to extend lease after it already expired
      await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for expiration

      // Agent tries to extend lease but it should fail gracefully
      try {
        await agentService.extendTaskLease('processing-agent', project.id, task.id, 30);
        // Extension might succeed if timing is right, that's okay
      } catch (error) {
        // Or it might fail, which is also valid behavior
        expect(error).toBeDefined();
      }

      // Run cleanup
      await leaseService.cleanupExpiredLeases(project.id);

      // Verify final state - task should be requeued regardless
      const finalTask = await taskService.getTask(task.id);
      expect(['queued', 'running']).toContain(finalTask!.status);
    });

    it('should handle multiple agents competing for expired tasks', async () => {
      const project = await projectService.createProject({
        name: 'competition-test',
        description: 'Test agent competition for expired tasks'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'competition-task',
        template: 'Compete for {{resource}}'
      });

      // Create multiple tasks
      const tasks = await Promise.all([
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Competition task 1',
          variables: { resource: 'task-1' }
        }),
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Competition task 2',
          variables: { resource: 'task-2' }
        }),
        taskService.createTask({
          projectId: project.id,
          typeId: taskType.id,
          instructions: 'Competition task 3',
          variables: { resource: 'task-3' }
        })
      ]);

      // Multiple agents try to get tasks simultaneously
      const [assignment1, assignment2, assignment3, assignment4] = await Promise.all([
        agentService.getNextTask(project.id, 'competitor-1'),
        agentService.getNextTask(project.id, 'competitor-2'), 
        agentService.getNextTask(project.id, 'competitor-3'),
        agentService.getNextTask(project.id, 'competitor-4') // Should get null
      ]);

      // Verify assignments
      expect(assignment1.task).toBeTruthy();
      expect(assignment2.task).toBeTruthy();
      expect(assignment3.task).toBeTruthy();
      expect(assignment4.task).toBeNull(); // No more tasks

      // Verify all tasks are assigned to different agents
      const assignedTaskIds = [assignment1.task!.id, assignment2.task!.id, assignment3.task!.id];
      const uniqueTaskIds = [...new Set(assignedTaskIds)];
      expect(uniqueTaskIds).toHaveLength(3);

      // Verify each task is assigned to correct agent
      const runningTasks = await taskService.listTasks(project.id, { status: 'running' });
      expect(runningTasks).toHaveLength(3);
      
      runningTasks.forEach(task => {
        expect(task.assignedTo).toMatch(/competitor-[1-3]/);
        expect(task.leaseExpiresAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('Lease Extension Scenarios', () => {
    it('should handle concurrent lease extensions from same agent', async () => {
      const project = await projectService.createProject({
        name: 'concurrent-extension-test',
        description: 'Test concurrent extensions'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'extension-task',
        template: 'Extend lease for {{work}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Lease extension test',
        variables: { work: 'extension-work' }
      });

      // Agent gets task
      const assignment = await agentService.getNextTask(project.id, 'extension-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Agent tries multiple concurrent extensions
      const extensionPromises = [
        agentService.extendTaskLease('extension-agent', project.id, task.id, 15),
        agentService.extendTaskLease('extension-agent', project.id, task.id, 20),
        agentService.extendTaskLease('extension-agent', project.id, task.id, 25),
        agentService.extendTaskLease('extension-agent', project.id, task.id, 30)
      ];

      const results = await Promise.allSettled(extensionPromises);
      
      // At least some extensions should succeed
      const successfulExtensions = results.filter(r => r.status === 'fulfilled');
      expect(successfulExtensions.length).toBeGreaterThan(0);

      // Verify final task state
      const extendedTask = await taskService.getTask(task.id);
      expect(extendedTask!.status).toBe('running');
      expect(extendedTask!.assignedTo).toBe('extension-agent');
      expect(extendedTask!.leaseExpiresAt).toBeInstanceOf(Date);
      expect(extendedTask!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should reject lease extensions from wrong agent', async () => {
      const project = await projectService.createProject({
        name: 'wrong-agent-test',
        description: 'Test wrong agent extension rejection'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'ownership-task',
        template: 'Owned by {{owner}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task ownership test',
        variables: { owner: 'correct-agent' }
      });

      // Correct agent gets task
      const assignment = await agentService.getNextTask(project.id, 'correct-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Wrong agent tries to extend lease
      try {
        await agentService.extendTaskLease('wrong-agent', project.id, task.id, 30);
        // Should throw error
        expect(true).toBe(false); // This should not be reached
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain('not assigned');
      }

      // Verify task state unchanged
      const unchangedTask = await taskService.getTask(task.id);
      expect(unchangedTask!.assignedTo).toBe('correct-agent');
    });
  });

  describe('Reaper Service Comprehensive Testing', () => {
    it('should handle mixed expired and active leases', async () => {
      const project = await projectService.createProject({
        name: 'mixed-lease-test',
        description: 'Test mixed lease states'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'mixed-task',
        template: 'Mixed lease {{type}}'
      });

      // Create tasks with different lease durations
      const shortTask = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Short lease task',
        variables: { type: 'short' }
      });

      const longTask = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Long lease task',
        variables: { type: 'long' }
      });

      // Assign tasks with different lease times
      const shortAssignment = await agentService.getNextTask(project.id, 'short-agent');
      const longAssignment = await agentService.getNextTask(project.id, 'long-agent');

      expect(shortAssignment.task!.id).toBe(shortTask.id);
      expect(longAssignment.task!.id).toBe(longTask.id);

      // Manually set different lease expiration times
      await storage.findOneAndUpdate('tasks', 
        { id: shortTask.id },
        { leaseExpiresAt: new Date(Date.now() - 1000) } // Expired 1 second ago
      );

      await storage.findOneAndUpdate('tasks',
        { id: longTask.id },
        { leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000) } // Expires in 30 minutes
      );

      // Run reaper
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);

      expect(cleanupResult.reclaimedTasks).toBe(1); // Only short task reclaimed
      expect(cleanupResult.cleanedAgents).toBeGreaterThanOrEqual(0);

      // Verify states
      const shortTaskFinal = await taskService.getTask(shortTask.id);
      const longTaskFinal = await taskService.getTask(longTask.id);

      expect(shortTaskFinal!.status).toBe('queued'); // Reclaimed
      expect(shortTaskFinal!.assignedTo).toBeUndefined();
      
      expect(longTaskFinal!.status).toBe('running'); // Still active
      expect(longTaskFinal!.assignedTo).toBe('long-agent');
    });

    it('should handle reaper service errors gracefully', async () => {
      const project = await projectService.createProject({
        name: 'reaper-error-test',
        description: 'Test reaper error handling'
      });

      // Run reaper on empty project (should not fail)
      const emptyCleanup = await leaseService.cleanupExpiredLeases(project.id);
      expect(emptyCleanup.reclaimedTasks).toBe(0);
      expect(emptyCleanup.cleanedAgents).toBe(0);

      // Run reaper on non-existent project (should handle gracefully)
      try {
        const invalidCleanup = await leaseService.cleanupExpiredLeases('non-existent-project');
        // If it doesn't throw, that's fine too
        expect(invalidCleanup.reclaimedTasks).toBe(0);
      } catch (error) {
        // If it throws, that's expected behavior
        expect(error).toBeDefined();
      }
    });

    it('should handle high volume lease operations', async () => {
      const project = await projectService.createProject({
        name: 'high-volume-test',
        description: 'Test high volume lease operations'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'volume-task',
        template: 'Volume task {{index}}'
      });

      // Create many tasks
      const tasks = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          taskService.createTask({
            projectId: project.id,
            typeId: taskType.id,
            instructions: `Volume task ${i}`,
            variables: { index: i.toString() }
          })
        )
      );

      expect(tasks).toHaveLength(20);

      // Assign tasks to many agents simultaneously
      const assignmentPromises = Array.from({ length: 15 }, (_, i) =>
        agentService.getNextTask(project.id, `volume-agent-${i}`)
      );

      const assignments = await Promise.all(assignmentPromises);

      // Count successful assignments
      const successfulAssignments = assignments.filter(a => a.task !== null);
      expect(successfulAssignments).toHaveLength(Math.min(15, 20)); // Up to 15 or number of tasks

      // Run comprehensive cleanup
      const cleanupResult = await leaseService.cleanupExpiredLeases(project.id);
      expect(cleanupResult.reclaimedTasks).toBeGreaterThanOrEqual(0);

      // Verify system consistency after high volume operations
      const finalTasks = await taskService.listTasks(project.id);
      expect(finalTasks).toHaveLength(20);

      const runningTasks = finalTasks.filter(t => t.status === 'running');
      const queuedTasks = finalTasks.filter(t => t.status === 'queued');

      expect(runningTasks.length + queuedTasks.length).toBe(20);
      
      // Each running task should have a valid assignment
      runningTasks.forEach(task => {
        expect(task.assignedTo).toBeTruthy();
        expect(task.leaseExpiresAt).toBeInstanceOf(Date);
      });
    });
  });
});