import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import {
  createMockProject,
  createMockProjectInput,
  createMockTaskType,
  createMockTaskTypeInput,
  createMockTask,
  createMockTaskInput,
  createMockAgent,
  createMockAgentInput,
  createMockTaskResult,
  createMockFailedTaskResult,
  createTestDataDir
} from '../fixtures/index.js';

describe('FileStorageProvider', () => {
  let storage: FileStorageProvider;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newStorage = new FileStorageProvider(createTestDataDir());
      await expect(async () => await newStorage.initialize()).not.toThrow();
      await newStorage.close();
    });

    it('should create data directories', async () => {
      const newDataDir = createTestDataDir();
      const newStorage = new FileStorageProvider(newDataDir);
      await newStorage.initialize();
      
      expect(existsSync(newDataDir)).toBe(true);
      expect(existsSync(`${newDataDir}/projects`)).toBe(true);
      expect(existsSync(`${newDataDir}/locks`)).toBe(true);
      
      await newStorage.close();
      rmSync(newDataDir, { recursive: true, force: true });
    });

    it('should handle multiple initializations gracefully', async () => {
      await expect(async () => await storage.initialize()).not.toThrow();
      await expect(async () => await storage.initialize()).not.toThrow();
    });
  });

  describe('Project Operations', () => {
    describe('createProject', () => {
      it('should create a project successfully', async () => {
        const input = createMockProjectInput();
        const project = await storage.createProject(input);
        
        expect(project.id).toBeDefined();
        expect(project.name).toBe(input.name);
        expect(project.description).toBe(input.description);
        expect(project.status).toBe('active');
        expect(project.createdAt).toBeInstanceOf(Date);
        expect(project.updatedAt).toBeInstanceOf(Date);
        expect(project.config).toEqual(input.config);
        expect(project.stats.totalTasks).toBe(0);
      });

      it('should apply default config values', async () => {
        const input = createMockProjectInput({ config: undefined });
        const project = await storage.createProject(input);
        
        expect(project.config.defaultMaxRetries).toBe(3);
        expect(project.config.defaultLeaseDurationMinutes).toBe(10);
        expect(project.config.reaperIntervalMinutes).toBe(1);
      });
    });

    describe('getProject', () => {
      it('should retrieve an existing project', async () => {
        const input = createMockProjectInput();
        const created = await storage.createProject(input);
        const retrieved = await storage.getProject(created.id);
        
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.name).toBe(created.name);
      });

      it('should return null for non-existent project', async () => {
        const retrieved = await storage.getProject('non-existent-id');
        expect(retrieved).toBeNull();
      });

      it('should update project stats when retrieving', async () => {
        const project = await storage.createProject(createMockProjectInput());
        const taskType = await storage.createTaskType(createMockTaskTypeInput({ projectId: project.id }));
        await storage.createTask(createMockTaskInput({ projectId: project.id, typeId: taskType.id }));
        
        const retrieved = await storage.getProject(project.id);
        expect(retrieved!.stats.totalTasks).toBe(1);
        expect(retrieved!.stats.queuedTasks).toBe(1);
      });
    });

    describe('updateProject', () => {
      it('should update project properties', async () => {
        const project = await storage.createProject(createMockProjectInput());
        // Small delay to ensure different timestamp
        await new Promise(resolve => setTimeout(resolve, 1));
        const updated = await storage.updateProject(project.id, {
          description: 'Updated description',
          status: 'closed'
        });
        
        expect(updated.description).toBe('Updated description');
        expect(updated.status).toBe('closed');
        expect(updated.updatedAt.getTime()).toBeGreaterThan(project.updatedAt.getTime());
      });

      it('should throw error for non-existent project', async () => {
        await expect(storage.updateProject('non-existent-id', { description: 'test' }))
          .rejects.toThrow('not found');
      });
    });

    describe('listProjects', () => {
      it('should list active projects by default', async () => {
        const activeProject = await storage.createProject(createMockProjectInput({ name: 'active' }));
        const closedProject = await storage.createProject(createMockProjectInput({ name: 'closed' }));
        await storage.updateProject(closedProject.id, { status: 'closed' });
        
        const projects = await storage.listProjects();
        expect(projects).toHaveLength(1);
        expect(projects[0].id).toBe(activeProject.id);
      });

      it('should include closed projects when requested', async () => {
        const activeProject = await storage.createProject(createMockProjectInput({ name: 'active' }));
        const closedProject = await storage.createProject(createMockProjectInput({ name: 'closed' }));
        await storage.updateProject(closedProject.id, { status: 'closed' });
        
        const projects = await storage.listProjects(true);
        expect(projects).toHaveLength(2);
      });

      it('should sort projects by creation date', async () => {
        const project1 = await storage.createProject(createMockProjectInput({ name: 'first' }));
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
        const project2 = await storage.createProject(createMockProjectInput({ name: 'second' }));
        
        const projects = await storage.listProjects();
        expect(projects[0].id).toBe(project2.id); // Newest first
        expect(projects[1].id).toBe(project1.id);
      });
    });

    describe('deleteProject', () => {
      it('should delete a project', async () => {
        const project = await storage.createProject(createMockProjectInput());
        await storage.deleteProject(project.id);
        
        const retrieved = await storage.getProject(project.id);
        expect(retrieved).toBeNull();
      });

      it('should not throw error for non-existent project', async () => {
        await expect(async () => await storage.deleteProject('non-existent-id')).not.toThrow();
      });
    });
  });

  describe('Task Type Operations', () => {
    let project: any;

    beforeEach(async () => {
      project = await storage.createProject(createMockProjectInput());
    });

    describe('createTaskType', () => {
      it('should create a task type successfully', async () => {
        const input = createMockTaskTypeInput({ projectId: project.id });
        const taskType = await storage.createTaskType(input);
        
        expect(taskType.id).toBeDefined();
        expect(taskType.name).toBe(input.name);
        expect(taskType.projectId).toBe(project.id);
        expect(taskType.template).toBe(input.template);
        expect(taskType.variables).toEqual(input.variables);
        expect(taskType.duplicateHandling).toBe(input.duplicateHandling);
        expect(taskType.maxRetries).toBe(input.maxRetries);
        expect(taskType.leaseDurationMinutes).toBe(input.leaseDurationMinutes);
      });

      it('should apply project defaults when not specified', async () => {
        const input = createMockTaskTypeInput({
          projectId: project.id,
          maxRetries: undefined,
          leaseDurationMinutes: undefined
        });
        const taskType = await storage.createTaskType(input);
        
        expect(taskType.maxRetries).toBe(project.config.defaultMaxRetries);
        expect(taskType.leaseDurationMinutes).toBe(project.config.defaultLeaseDurationMinutes);
      });
    });

    describe('getTaskType', () => {
      it('should retrieve an existing task type', async () => {
        const input = createMockTaskTypeInput({ projectId: project.id });
        const created = await storage.createTaskType(input);
        const retrieved = await storage.getTaskType(created.id);
        
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.name).toBe(created.name);
      });

      it('should return null for non-existent task type', async () => {
        const retrieved = await storage.getTaskType('non-existent-id');
        expect(retrieved).toBeNull();
      });
    });

    describe('listTaskTypes', () => {
      it('should list task types for a project', async () => {
        const taskType1 = await storage.createTaskType(createMockTaskTypeInput({ 
          projectId: project.id, 
          name: 'type1' 
        }));
        const taskType2 = await storage.createTaskType(createMockTaskTypeInput({ 
          projectId: project.id, 
          name: 'type2' 
        }));
        
        const taskTypes = await storage.listTaskTypes(project.id);
        expect(taskTypes).toHaveLength(2);
        expect(taskTypes.map(tt => tt.id)).toContain(taskType1.id);
        expect(taskTypes.map(tt => tt.id)).toContain(taskType2.id);
      });

      it('should return empty array for project with no task types', async () => {
        const taskTypes = await storage.listTaskTypes(project.id);
        expect(taskTypes).toEqual([]);
      });
    });
  });

  describe('Task Operations', () => {
    let project: any;
    let taskType: any;

    beforeEach(async () => {
      project = await storage.createProject(createMockProjectInput());
      taskType = await storage.createTaskType(createMockTaskTypeInput({ projectId: project.id }));
    });

    describe('createTask', () => {
      it('should create a task successfully', async () => {
        const input = createMockTaskInput({ projectId: project.id, typeId: taskType.id });
        const task = await storage.createTask(input);
        
        expect(task.id).toBeDefined();
        expect(task.projectId).toBe(project.id);
        expect(task.typeId).toBe(taskType.id);
        expect(task.instructions).toBe(input.instructions);
        expect(task.variables).toEqual(input.variables);
        expect(task.status).toBe('queued');
        expect(task.retryCount).toBe(0);
        expect(task.maxRetries).toBe(taskType.maxRetries);
        expect(task.attempts).toEqual([]);
      });

      it('should handle duplicate detection with ignore strategy', async () => {
        const ignoreTaskType = await storage.createTaskType(createMockTaskTypeInput({
          projectId: project.id,
          duplicateHandling: 'ignore'
        }));
        
        const input = createMockTaskInput({ 
          projectId: project.id, 
          typeId: ignoreTaskType.id,
          variables: { key: 'value' }
        });
        
        const task1 = await storage.createTask(input);
        const task2 = await storage.createTask(input); // Duplicate
        
        expect(task2.id).toBe(task1.id); // Should return the same task
      });

      it('should handle duplicate detection with fail strategy', async () => {
        const failTaskType = await storage.createTaskType(createMockTaskTypeInput({
          projectId: project.id,
          duplicateHandling: 'fail'
        }));
        
        const input = createMockTaskInput({ 
          projectId: project.id, 
          typeId: failTaskType.id,
          variables: { key: 'value' }
        });
        
        await storage.createTask(input);
        await expect(storage.createTask(input)).rejects.toThrow('Duplicate task found');
      });
    });

    describe('assignTask', () => {
      it('should assign queued task to agent', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        
        const result = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = result.task;
        
        expect(assignedTask).not.toBeNull();
        expect(assignedTask!.id).toBe(task.id);
        expect(assignedTask!.status).toBe('running');
        expect(assignedTask!.assignedTo).toBe('test-agent');
        expect(assignedTask!.leaseExpiresAt).toBeInstanceOf(Date);
        expect(assignedTask!.attempts).toHaveLength(1);
        expect(assignedTask!.attempts[0].agentName).toBe('test-agent');
      });

      it('should return null when no tasks are available', async () => {
        const result = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = result.task;
        expect(assignedTask).toBeNull();
      });

      it('should assign tasks in FIFO order', async () => {
        const task1 = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id,
          instructions: 'First task'
        }));
        
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const task2 = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id,
          instructions: 'Second task'
        }));
        
        const result = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = result.task;
        expect(assignedTask!.id).toBe(task1.id); // First task should be assigned first
      });
    });

    describe('completeTask', () => {
      it('should complete a running task', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        const assignResult = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = assignResult.task;
        const taskResult = createMockTaskResult();
        
        await storage.completeTask(assignedTask!.id, 'test-agent', taskResult);
        
        const completedTask = await storage.getTask(assignedTask!.id);
        expect(completedTask!.status).toBe('completed');
        expect(completedTask!.result).toEqual(taskResult);
        expect(completedTask!.completedAt).toBeInstanceOf(Date);
        expect(completedTask!.assignedTo).toBeUndefined();
        expect(completedTask!.leaseExpiresAt).toBeUndefined();
        expect(completedTask!.attempts[0].status).toBe('completed');
        expect(completedTask!.attempts[0].result).toEqual(taskResult);
      });
    });

    describe('failTask', () => {
      it('should fail a task and requeue for retry', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        const assignResult = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = assignResult.task;
        const failResult = createMockFailedTaskResult();
        
        await storage.failTask(assignedTask!.id, 'test-agent', failResult, true);
        
        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('queued'); // Should be requeued
        expect(failedTask!.retryCount).toBe(1);
        expect(failedTask!.assignedTo).toBeUndefined();
        expect(failedTask!.leaseExpiresAt).toBeUndefined();
        expect(failedTask!.attempts[0].status).toBe('failed');
        expect(failedTask!.attempts[0].result).toEqual(failResult);
      });

      it('should fail task permanently when retry limit reached', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        
        // Simulate max retries reached
        await storage.updateTask(task.id, { retryCount: taskType.maxRetries });
        const assignResult = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = assignResult.task;
        const failResult = createMockFailedTaskResult();
        
        await storage.failTask(assignedTask!.id, 'test-agent', failResult, true);
        
        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('failed'); // Should be permanently failed
        expect(failedTask!.result).toEqual(failResult);
        expect(failedTask!.failedAt).toBeInstanceOf(Date);
      });

      it('should respect canRetry parameter', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        const assignResult = await storage.getNextTask(project.id, 'test-agent');
        const assignedTask = assignResult.task;
        const failResult = createMockFailedTaskResult();
        
        await storage.failTask(assignedTask!.id, 'test-agent', failResult, false); // Don't retry
        
        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('failed'); // Should be permanently failed
      });
    });
  });

  describe('Lease-based Agent Operations', () => {
    let project: any;
    let taskType: any;

    beforeEach(async () => {
      project = await storage.createProject(createMockProjectInput());
      taskType = await storage.createTaskType(createMockTaskTypeInput({ projectId: project.id }));
    });

    describe('listActiveAgents', () => {
      it('should return empty list when no agents are working', async () => {
        const agents = await storage.listActiveAgents(project.id);
        expect(agents).toHaveLength(0);
      });

      it('should list agents with active task leases', async () => {
        // Create tasks and assign them to agents
        await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));
        await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));

        const result1 = await storage.getNextTask(project.id, 'agent-1');
        const result2 = await storage.getNextTask(project.id, 'agent-2');

        expect(result1.task).not.toBeNull();
        expect(result2.task).not.toBeNull();

        const agents = await storage.listActiveAgents(project.id);
        expect(agents).toHaveLength(2);
        
        const agentNames = agents.map(a => a.name).sort();
        expect(agentNames).toEqual(['agent-1', 'agent-2']);
        
        for (const agent of agents) {
          expect(agent.status).toBe('working');
          expect(agent.currentTaskId).toBeDefined();
          expect(agent.leaseExpiresAt).toBeInstanceOf(Date);
        }
      });
    });

    describe('getAgentStatus', () => {
      it('should return null for agent with no active lease', async () => {
        const status = await storage.getAgentStatus('non-existent-agent', project.id);
        expect(status).toBeNull();
      });

      it('should return status for agent with active lease', async () => {
        await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));

        const result = await storage.getNextTask(project.id, 'test-agent');
        expect(result.task).not.toBeNull();

        const status = await storage.getAgentStatus('test-agent', project.id);
        expect(status).not.toBeNull();
        expect(status!.name).toBe('test-agent');
        expect(status!.status).toBe('working');
        expect(status!.currentTaskId).toBe(result.task!.id);
        expect(status!.leaseExpiresAt).toBeInstanceOf(Date);
      });
    });

    describe('extendLease', () => {
      it('should extend lease for running task', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));

        const result = await storage.getNextTask(project.id, 'test-agent');
        expect(result.task).not.toBeNull();

        const originalExpiry = result.task!.leaseExpiresAt!;
        
        await storage.extendLease(result.task!.id, 30); // Extend by 30 minutes
        
        const updatedTask = await storage.getTask(result.task!.id);
        expect(updatedTask!.leaseExpiresAt!.getTime()).toBeGreaterThan(originalExpiry.getTime());
      });

      it('should throw error for non-running task', async () => {
        const task = await storage.createTask(createMockTaskInput({ 
          projectId: project.id, 
          typeId: taskType.id 
        }));

        await expect(storage.extendLease(task.id, 30)).rejects.toThrow();
      });
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const health = await storage.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.message).toBe('File storage is healthy');
    });
  });
});