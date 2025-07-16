import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { AgentService } from '../../src/services/AgentService.js';
import { createTestDataDir } from '../fixtures/index.js';
import { rmSync, existsSync } from 'fs';

/**
 * Core Workflow Integration Tests
 * 
 * Tests the critical user workflows mentioned in CLAUDE.md:
 * - Task Assignment Atomic Operation
 * - Project-Scoped Isolation
 * - Agent Lease Management System
 * - Template-Based Task Creation
 */
describe('Core Workflow Integration', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let taskTypeService: TaskTypeService;
  let taskService: TaskService;
  let agentService: AgentService;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);
    taskService = new TaskService(storage, projectService, taskTypeService);
    agentService = new AgentService(storage, projectService, taskService);
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Atomic Task Assignment Workflow', () => {
    it('should atomically assign tasks preventing race conditions', async () => {
      // Setup project and task type
      const project = await projectService.createProject({
        name: 'assignment-test',
        description: 'Test atomic assignment'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'atomic-task',
        template: 'Process {{resource}}'
      });

      // Create multiple tasks
      const task1 = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task 1',
        variables: { resource: 'file1.txt' }
      });

      const task2 = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Task 2', 
        variables: { resource: 'file2.txt' }
      });

      // Test atomic assignment - multiple agents request tasks simultaneously
      const [assignment1, assignment2] = await Promise.all([
        agentService.getNextTask(project.id, 'agent-1'),
        agentService.getNextTask(project.id, 'agent-2')
      ]);

      // Verify atomic assignment worked correctly
      expect(assignment1.task).toBeTruthy();
      expect(assignment2.task).toBeTruthy();
      expect(assignment1.task!.id).not.toBe(assignment2.task!.id); // Different tasks assigned

      // Verify no double assignment - third request should get no task
      const assignment3 = await agentService.getNextTask(project.id, 'agent-3');
      if (assignment3.task) {
        // If there was a third task, ensure it's unique
        expect(assignment3.task.id).not.toBe(assignment1.task!.id);
        expect(assignment3.task.id).not.toBe(assignment2.task!.id);
      }

      // Verify tasks are properly leased
      const runningTasks = await taskService.listTasks(project.id, { status: 'running' });
      expect(runningTasks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Project-Scoped Isolation Workflow', () => {
    it('should isolate tasks and agents between projects', async () => {
      // Create two separate projects
      const project1 = await projectService.createProject({
        name: 'project-1',
        description: 'First isolated project'
      });

      const project2 = await projectService.createProject({
        name: 'project-2', 
        description: 'Second isolated project'
      });

      // Create task types in each project
      const taskType1 = await taskTypeService.createTaskType({
        projectId: project1.id,
        name: 'task-type-1',
        template: 'P1: {{data}}'
      });

      const taskType2 = await taskTypeService.createTaskType({
        projectId: project2.id,
        name: 'task-type-2',
        template: 'P2: {{data}}'
      });

      // Create tasks in each project
      const task1 = await taskService.createTask({
        projectId: project1.id,
        typeId: taskType1.id,
        instructions: 'Project 1 task',
        variables: { data: 'project1-data' }
      });

      const task2 = await taskService.createTask({
        projectId: project2.id,
        typeId: taskType2.id,
        instructions: 'Project 2 task',
        variables: { data: 'project2-data' }
      });

      // Verify isolation - agents can only see tasks from their project
      const assignment1 = await agentService.getNextTask(project1.id, 'agent-p1');
      const assignment2 = await agentService.getNextTask(project2.id, 'agent-p2');

      expect(assignment1.task!.id).toBe(task1.id);
      expect(assignment2.task!.id).toBe(task2.id);

      // Verify cross-project isolation - same agent name in different projects is isolated
      const crossAssignment = await agentService.getNextTask(project2.id, 'agent-p1');
      expect(crossAssignment.task).toBeNull(); // No tasks available for this agent in project2

      // Verify task lists are project-scoped
      const project1Tasks = await taskService.listTasks(project1.id);
      const project2Tasks = await taskService.listTasks(project2.id);

      expect(project1Tasks.length).toBe(1);
      expect(project2Tasks.length).toBe(1);
      expect(project1Tasks[0].id).toBe(task1.id);
      expect(project2Tasks[0].id).toBe(task2.id);
    });
  });

  describe('Template-Based Task Creation Workflow', () => {
    it('should create tasks from templates with variable substitution', async () => {
      const project = await projectService.createProject({
        name: 'template-test',
        description: 'Test template substitution'
      });

      // Create task type with complex template
      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'data-processor',
        template: 'Process file {{filename}} from {{source}} with priority {{priority}}'
      });

      // Create task with variables
      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Template-based task',
        variables: {
          filename: 'data.csv',
          source: 'api',
          priority: 'high'
        }
      });

      // Verify template substitution worked
      const instructions = await taskService.getTaskInstructions(task.id);
      expect(instructions).toBe('Process file data.csv from api with priority high');

      // Verify variables are preserved
      expect(task.variables).toEqual({
        filename: 'data.csv',
        source: 'api', 
        priority: 'high'
      });
    });

    it('should handle bulk task creation with templates', async () => {
      const project = await projectService.createProject({
        name: 'bulk-template-test',
        description: 'Test bulk template creation'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'batch-processor',
        template: 'Process batch {{id}} with {{items}} items'
      });

      // Create multiple tasks with different variables
      const batchTasks = [
        { type: taskType.name, vars: { id: 'batch-001', items: '100' } },
        { type: taskType.name, vars: { id: 'batch-002', items: '250' } },
        { type: taskType.name, vars: { id: 'batch-003', items: '75' } }
      ];

      const result = await taskService.createTasksBulk(project.id, batchTasks);

      expect(result.tasksCreated).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify each task got correct template substitution
      const createdTasks = await taskService.listTasks(project.id);
      expect(createdTasks).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        const instructions = await taskService.getTaskInstructions(createdTasks[i].id);
        const expectedBatchId = `batch-00${i + 1}`;
        expect(instructions).toContain(`Process batch ${expectedBatchId}`);
      }
    });
  });

  describe('Agent Lease Management Workflow', () => {
    it('should handle task completion and lease release', async () => {
      const project = await projectService.createProject({
        name: 'lease-test',
        description: 'Test lease management'
      });

      const taskType = await taskTypeService.createTaskType({
        projectId: project.id,
        name: 'lease-task',
        template: 'Complete {{action}}'
      });

      const task = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Lease test task',
        variables: { action: 'processing' }
      });

      // Agent requests and gets task
      const assignment = await agentService.getNextTask(project.id, 'lease-agent');
      expect(assignment.task!.id).toBe(task.id);

      // Verify task is leased and running
      let runningTask = await taskService.getTask(task.id);
      expect(runningTask!.status).toBe('running');
      expect(runningTask!.assignedTo).toBe('lease-agent');
      expect(runningTask!.leaseExpiresAt).toBeInstanceOf(Date);

      // Complete the task
      await agentService.completeTask('lease-agent', project.id, task.id, {
        success: true,
        result: 'Task completed successfully'
      });

      // Verify task is completed and lease released
      const completedTask = await taskService.getTask(task.id);
      expect(completedTask!.status).toBe('completed');
      expect(completedTask!.assignedTo).toBeUndefined();
      expect(completedTask!.leaseExpiresAt).toBeUndefined();

      // Verify agent can get another task
      const task2 = await taskService.createTask({
        projectId: project.id,
        typeId: taskType.id,
        instructions: 'Second task',
        variables: { action: 'cleanup' }
      });

      const assignment2 = await agentService.getNextTask(project.id, 'lease-agent');
      expect(assignment2.task!.id).toBe(task2.id);
    });
  });
});