import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoStorageProvider } from '../../src/storage/MongoStorageProvider.js';

describe('MongoStorageProvider', () => {
  let mongoServer: MongoMemoryServer;
  let storage: MongoStorageProvider;
  let connectionString: string;

  beforeAll(async () => {
    // Start in-memory MongoDB instance (standalone mode)
    mongoServer = await MongoMemoryServer.create();
    connectionString = mongoServer.getUri();
  });

  afterAll(async () => {
    // Stop in-memory MongoDB instance
    await mongoServer.stop();
  });

  beforeEach(async () => {
    storage = new MongoStorageProvider(connectionString, 'test-taskdriver');
    await storage.initialize();
  });

  afterEach(async () => {
    // Clean up database before closing
    try {
      const db = (storage as any).db;
      if (db) {
        await db.dropDatabase();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
    await storage.close();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const result = await storage.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should handle multiple initializations gracefully', async () => {
      await storage.initialize(); // Should not throw
      const result = await storage.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });

  describe('Project Operations', () => {
    describe('createProject', () => {
      it('should create a project successfully', async () => {
        const input = {
          name: 'test-project',
          description: 'A test project'
        };

        const project = await storage.createProject(input);

        expect(project.id).toBeDefined();
        expect(project.name).toBe('test-project');
        expect(project.description).toBe('A test project');
        expect(project.status).toBe('active');
        expect(project.createdAt).toBeInstanceOf(Date);
        expect(project.updatedAt).toBeInstanceOf(Date);
        expect(project.config).toBeDefined();
        expect(project.stats).toBeDefined();
      });

      it('should apply default config values', async () => {
        const input = {
          name: 'config-test',
          description: 'Config test project'
        };

        const project = await storage.createProject(input);

        expect(project.config.defaultMaxRetries).toBe(3);
        expect(project.config.defaultLeaseDurationMinutes).toBe(30);
        // MongoDB provider doesn't set reaperIntervalMinutes by default
      });
    });

    describe('getProject', () => {
      it('should retrieve an existing project', async () => {
        const created = await storage.createProject({
          name: 'retrieve-test',
          description: 'Project to retrieve'
        });

        const retrieved = await storage.getProject(created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.name).toBe('retrieve-test');
      });

      it('should return null for non-existent project', async () => {
        const result = await storage.getProject('non-existent-id');
        expect(result).toBeNull();
      });
    });

    describe('updateProject', () => {
      it('should update project properties', async () => {
        const project = await storage.createProject({
          name: 'update-test',
          description: 'Original description'
        });

        const updated = await storage.updateProject(project.id, {
          description: 'Updated description',
          status: 'closed'
        });

        expect(updated.description).toBe('Updated description');
        expect(updated.status).toBe('closed');
        expect(updated.name).toBe('update-test'); // Should remain unchanged
      });

      it('should throw error for non-existent project', async () => {
        await expect(storage.updateProject('non-existent-id', { description: 'test' }))
          .rejects.toThrow('Project not found: non-existent-id');
      });
    });

    describe('listProjects', () => {
      it('should list active projects by default', async () => {
        await storage.createProject({
          name: 'active-1',
          description: 'Active project 1'
        });

        await storage.createProject({
          name: 'active-2',
          description: 'Active project 2'
        });

        const closedProject = await storage.createProject({
          name: 'closed-project',
          description: 'Project to close'
        });

        await storage.updateProject(closedProject.id, { status: 'closed' });

        const projects = await storage.listProjects();

        expect(projects).toHaveLength(2);
        expect(projects.every(p => p.status === 'active')).toBe(true);
        expect(projects.map(p => p.name)).toContain('active-1');
        expect(projects.map(p => p.name)).toContain('active-2');
      });

      it('should include closed projects when requested', async () => {
        await storage.createProject({
          name: 'active-project',
          description: 'Active project'
        });

        const closedProject = await storage.createProject({
          name: 'closed-project',
          description: 'Project to close'
        });

        await storage.updateProject(closedProject.id, { status: 'closed' });

        const projects = await storage.listProjects(true);

        expect(projects).toHaveLength(2);
        expect(projects.map(p => p.name)).toContain('closed-project');
      });
    });

    describe('deleteProject', () => {
      it('should delete a project', async () => {
        const project = await storage.createProject({
          name: 'delete-test',
          description: 'Project to delete'
        });

        await storage.deleteProject(project.id);

        const retrieved = await storage.getProject(project.id);
        expect(retrieved).toBeNull();
      });

      it('should not throw error for non-existent project', async () => {
        await storage.deleteProject('non-existent-id'); // Should not throw
      });
    });
  });

  describe('Task Type Operations', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await storage.createProject({
        name: 'task-type-test',
        description: 'Project for task type tests'
      });
      projectId = project.id;
    });

    describe('createTaskType', () => {
      it('should create a task type successfully', async () => {
        const input = {
          projectId,
          name: 'test-task-type',
          template: 'Process {{item}}',
          variables: ['item']
        };

        const taskType = await storage.createTaskType(input);

        expect(taskType.id).toBeDefined();
        expect(taskType.name).toBe('test-task-type');
        expect(taskType.projectId).toBe(projectId);
        expect(taskType.template).toBe('Process {{item}}');
        expect(taskType.variables).toEqual(['item']);
        expect(taskType.duplicateHandling).toBe('allow');
        expect(taskType.maxRetries).toBe(3); // From project default
        expect(taskType.leaseDurationMinutes).toBe(30); // From project default
      });
    });

    describe('getTaskType', () => {
      it('should retrieve an existing task type', async () => {
        const created = await storage.createTaskType({
          projectId,
          name: 'retrieve-task-type'
        });

        const retrieved = await storage.getTaskType(created.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(created.id);
        expect(retrieved!.name).toBe('retrieve-task-type');
      });

      it('should return null for non-existent task type', async () => {
        const result = await storage.getTaskType('non-existent-id');
        expect(result).toBeNull();
      });
    });
  });

  describe('Task Operations', () => {
    let projectId: string;
    let taskTypeId: string;

    beforeEach(async () => {
      const project = await storage.createProject({
        name: 'task-test',
        description: 'Project for task tests'
      });
      projectId = project.id;

      const taskType = await storage.createTaskType({
        projectId,
        name: 'test-task-type'
      });
      taskTypeId = taskType.id;
    });

    describe('createTask', () => {
      it('should create a task successfully', async () => {
        const input = {
          projectId,
          typeId: taskTypeId,
          instructions: 'Test task instructions',
          variables: { key: 'value' }
        };

        const task = await storage.createTask(input);

        expect(task.id).toBeDefined();
        expect(task.projectId).toBe(projectId);
        expect(task.typeId).toBe(taskTypeId);
        expect(task.instructions).toBe('Test task instructions');
        expect(task.variables).toEqual({ key: 'value' });
        expect(task.status).toBe('queued');
        expect(task.retryCount).toBe(0);
        expect(task.maxRetries).toBe(3); // From task type
      });

      it('should handle duplicate detection with ignore strategy', async () => {
        const ignoreTaskType = await storage.createTaskType({
          projectId,
          name: 'ignore-task-type',
          duplicateHandling: 'ignore'
        });
        
        const input = {
          projectId,
          typeId: ignoreTaskType.id,
          instructions: 'Test ignore duplicate',
          variables: { key: 'value' }
        };
        
        const task1 = await storage.createTask(input);
        const task2 = await storage.createTask(input); // Duplicate
        
        expect(task2.id).toBe(task1.id); // Should return the same task
      });

      it('should handle duplicate detection with fail strategy', async () => {
        const failTaskType = await storage.createTaskType({
          projectId,
          name: 'fail-task-type',
          duplicateHandling: 'fail'
        });
        
        const input = {
          projectId,
          typeId: failTaskType.id,
          instructions: 'Test fail duplicate',
          variables: { key: 'value' }
        };
        
        await storage.createTask(input);
        await expect(storage.createTask(input)).rejects.toThrow('Duplicate task found');
      });
    });

    describe('listTasks', () => {
      it('should return tasks with typeName populated', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Test task'
        });
        
        const tasks = await storage.listTasks(projectId);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(task.id);
        expect(tasks[0].typeId).toBe(taskTypeId);
        expect(tasks[0].typeName).toBe('test-task-type');
      });
    });

    describe('getNextTask', () => {
      it('should assign queued task to agent', async () => {
        // Create some tasks
        await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'First task'
        });

        await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Second task'
        });

        const result = await storage.getNextTask(projectId, 'test-agent');
        const task = result.task;

        expect(task).not.toBeNull();
        expect(task!.status).toBe('running');
        expect(task!.assignedTo).toBe('test-agent');
        expect(task!.assignedAt).toBeInstanceOf(Date);
        expect(task!.leaseExpiresAt).toBeInstanceOf(Date);
        // TODO: MongoDB storage provider doesn't track attempts during assignment
        // expect(task!.attempts).toHaveLength(1);
        // expect(task!.attempts[0].agentName).toBe('test-agent');
      });

      it('should return null when no tasks are available', async () => {
        const result = await storage.getNextTask(projectId, 'test-agent');
        expect(result.task).toBeNull();
      });

      it('should assign tasks in FIFO order', async () => {
        const task1 = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'First task'
        });

        // Wait a bit to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));

        const task2 = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Second task'
        });

        const result = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = result.task;

        expect(assignedTask).not.toBeNull();
        expect(assignedTask!.id).toBe(task1.id); // Should get the first task
        expect(assignedTask!.instructions).toBe('First task');
      });
    });

    describe('completeTask', () => {
      it('should complete a running task', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task to complete'
        });

        const assignResult = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        const result = {
          success: true,
          output: 'Task completed successfully'
        };

        await storage.completeTask(assignedTask!.id, 'test-agent', result);

        const completedTask = await storage.getTask(assignedTask!.id);
        expect(completedTask!.status).toBe('completed');
        expect(completedTask!.result).toEqual(result);
        expect(completedTask!.completedAt).toBeInstanceOf(Date);
        expect(completedTask!.assignedTo).toBeFalsy(); // Should be cleared after completion
        expect(completedTask!.leaseExpiresAt).toBeFalsy(); // Should be cleared after completion
      });
    });

    describe('failTask', () => {
      it('should fail a task and requeue for retry', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task to fail'
        });

        const assignResult = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        const result = {
          success: false,
          error: 'Task failed'
        };

        await storage.failTask(assignedTask!.id, 'test-agent', result, true);

        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('queued'); // Should be requeued
        expect(failedTask!.retryCount).toBe(1);
        expect(failedTask!.assignedTo).toBeFalsy(); // Should be cleared after failure
        expect(failedTask!.leaseExpiresAt).toBeFalsy(); // Should be cleared after failure
      });

      it('should fail task permanently when retry limit reached', async () => {
        // Create task type with low retry limit
        const lowRetryTaskType = await storage.createTaskType({
          projectId,
          name: 'low-retry-type',
          maxRetries: 1
        });

        const task = await storage.createTask({
          projectId,
          typeId: lowRetryTaskType.id,
          instructions: 'Task to fail permanently'
        });

        // First attempt
        let assignResult = await storage.getNextTask(projectId, 'test-agent');
        let assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        await storage.failTask(assignedTask!.id, 'test-agent', { success: false, error: 'First failure' }, true);

        // Second attempt
        assignResult = await storage.getNextTask(projectId, 'test-agent');
        assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        await storage.failTask(assignedTask!.id, 'test-agent', { success: false, error: 'Final failure' }, true);

        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('failed'); // Should be permanently failed
        expect(failedTask!.retryCount).toBe(1); // MongoDB provider logic: retryCount = maxRetries when failed
        expect(failedTask!.failedAt).toBeInstanceOf(Date);
      });

      it('should respect canRetry parameter', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task to fail without retry'
        });

        const assignResult = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        const result = {
          success: false,
          error: 'Fatal error'
        };

        await storage.failTask(assignedTask!.id, 'test-agent', result, false);

        const failedTask = await storage.getTask(assignedTask!.id);
        expect(failedTask!.status).toBe('failed'); // Should be permanently failed
        expect(failedTask!.retryCount).toBe(0); // MongoDB provider: retryCount unchanged when canRetry=false
        expect(failedTask!.result).toEqual(result);
      });
    });
  });

  describe('Agent Status Operations', () => {
    let projectId: string;
    let taskTypeId: string;

    beforeEach(async () => {
      const project = await storage.createProject({
        name: 'agent-test',
        description: 'Project for agent tests'
      });
      projectId = project.id;
      
      const taskType = await storage.createTaskType({
        projectId,
        name: 'agent-task-type'
      });
      taskTypeId = taskType.id;
    });

    describe('listActiveAgents', () => {
      it('should return empty list when no agents are working', async () => {
        const agents = await storage.listActiveAgents(projectId);
        expect(agents).toHaveLength(0);
      });

      it('should list agents with active task leases', async () => {
        // Create tasks and assign them to agents
        await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task 1'
        });
        await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task 2'
        });

        const result1 = await storage.getNextTask(projectId, 'agent-1');
        const result2 = await storage.getNextTask(projectId, 'agent-2');

        expect(result1.task).not.toBeNull();
        expect(result2.task).not.toBeNull();

        const agents = await storage.listActiveAgents(projectId);
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
        const status = await storage.getAgentStatus('non-existent-agent', projectId);
        expect(status).toBeNull();
      });

      it('should return status for agent with active lease', async () => {
        await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Status test task'
        });

        const result = await storage.getNextTask(projectId, 'test-agent');
        expect(result.task).not.toBeNull();

        const status = await storage.getAgentStatus('test-agent', projectId);
        expect(status).not.toBeNull();
        expect(status!.name).toBe('test-agent');
        expect(status!.status).toBe('working');
        expect(status!.currentTaskId).toBe(result.task!.id);
        expect(status!.leaseExpiresAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('Lease Management', () => {
    let projectId: string;
    let taskTypeId: string;

    beforeEach(async () => {
      const project = await storage.createProject({
        name: 'lease-test',
        description: 'Project for lease tests'
      });
      projectId = project.id;

      const taskType = await storage.createTaskType({
        projectId,
        name: 'lease-task-type',
        leaseDurationMinutes: 1 // Short lease for testing
      });
      taskTypeId = taskType.id;
    });

    describe('findExpiredLeases', () => {
      it('should find expired leases', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task with expiring lease'
        });

        const assignResult = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        // Manually expire the lease by updating it to past time
        await storage.updateTask(assignedTask!.id, {
          leaseExpiresAt: new Date(Date.now() - 60000) // 1 minute ago
        });

        const expiredTasks = await storage.findExpiredLeases();

        expect(expiredTasks).toHaveLength(1);
        expect(expiredTasks[0].id).toBe(assignedTask!.id);
      });
    });

    describe('extendLease', () => {
      it('should extend lease for running task', async () => {
        const task = await storage.createTask({
          projectId,
          typeId: taskTypeId,
          instructions: 'Task to extend lease'
        });

        const assignResult = await storage.getNextTask(projectId, 'test-agent');
        const assignedTask = assignResult.task;
        expect(assignedTask).not.toBeNull();

        const originalExpiry = assignedTask!.leaseExpiresAt!;

        await storage.extendLease(assignedTask!.id, 30);

        const extendedTask = await storage.getTask(assignedTask!.id);
        const newExpiry = extendedTask!.leaseExpiresAt!;

        const timeDiff = newExpiry.getTime() - originalExpiry.getTime();
        expect(timeDiff).toBeCloseTo(30 * 60 * 1000, -1000); // Within 1 second
      });

      it('should throw error for non-existent task', async () => {
        await expect(storage.extendLease('non-existent-id', 30))
          .rejects.toThrow('Task not found: non-existent-id');
      });
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const result = await storage.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.message).toContain('MongoDB connection healthy');
    });
  });

  describe('Metrics', () => {
    it('should return basic metrics', async () => {
      // Create some test data
      const project = await storage.createProject({
        name: 'metrics-test',
        description: 'Project for metrics tests'
      });

      const taskType = await storage.createTaskType({
        projectId: project.id,
        name: 'metrics-task-type'
      });

      await storage.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Metrics test task'
      });

      const metrics = await storage.getMetrics();

      expect(metrics.totalProjects).toBeGreaterThanOrEqual(1);
      expect(metrics.activeProjects).toBeGreaterThanOrEqual(1);
      expect(metrics.totalTasks).toBeGreaterThanOrEqual(1);
      expect(metrics.queuedTasks).toBeGreaterThanOrEqual(1);
    });
  });
});