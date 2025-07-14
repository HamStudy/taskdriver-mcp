import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { AgentService } from '../../src/services/AgentService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { TaskService } from '../../src/services/TaskService.js';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('AgentService', () => {
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
      description: 'Test project for agents'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('registerAgent', () => {
    it('should register agent with name', async () => {
      const input = {
        projectId,
        name: 'test-agent',
        capabilities: ['testing', 'automation']
      };

      const result = await agentService.registerAgent(input);

      expect(result.agent.id).toBeDefined();
      expect(result.agent.name).toBe('test-agent');
      expect(result.agent.projectId).toBe(projectId);
      expect(result.agent.capabilities).toEqual(['testing', 'automation']);
      expect(result.agent.status).toBe('idle');
      expect(result.agent.createdAt).toBeInstanceOf(Date);
      expect(result.agent.lastSeen).toBeInstanceOf(Date);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey).toHaveLength(32); // Default API key length
    });

    it('should auto-generate name when not provided', async () => {
      const input = {
        projectId,
        capabilities: ['testing']
      };

      const result = await agentService.registerAgent(input);

      expect(result.agent.name).toBeDefined();
      expect(result.agent.name).toMatch(/^agent-\d+$/);
    });

    it('should register agent with minimal input', async () => {
      const input = {
        projectId
      };

      const result = await agentService.registerAgent(input);

      expect(result.agent.capabilities).toEqual([]);
      expect(result.agent.name).toMatch(/^agent-\d+$/);
    });

    it('should throw validation error for invalid input', async () => {
      const input = {
        projectId,
        name: 'invalid name with spaces' // Invalid name format
      };

      await expect(agentService.registerAgent(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw validation error for invalid project ID format', async () => {
      const input = {
        projectId: 'non-existent-project',
        name: 'test-agent'
      };

      await expect(agentService.registerAgent(input))
        .rejects.toThrow('Validation failed');
    });

    it('should allow duplicate agent names in same project', async () => {
      const input = {
        projectId,
        name: 'duplicate-agent'
      };

      const agent1 = await agentService.registerAgent(input);
      const agent2 = await agentService.registerAgent(input);

      expect(agent1.agent.name).toBe('duplicate-agent');
      expect(agent2.agent.name).toBe('duplicate-agent');
      expect(agent1.agent.id).not.toBe(agent2.agent.id); // Should have different IDs
    });

    it('should allow same agent name in different projects', async () => {
      const secondProject = await projectService.createProject({
        name: 'second-project',
        description: 'Second test project'
      });

      const input1 = {
        projectId,
        name: 'shared-name'
      };

      const input2 = {
        projectId: secondProject.id,
        name: 'shared-name'
      };

      const result1 = await agentService.registerAgent(input1);
      const result2 = await agentService.registerAgent(input2);

      expect(result1.agent.name).toBe('shared-name');
      expect(result2.agent.name).toBe('shared-name');
      expect(result1.agent.projectId).toBe(projectId);
      expect(result2.agent.projectId).toBe(secondProject.id);
    });
  });

  describe('authenticateAgent', () => {
    let agentApiKey: string;

    beforeEach(async () => {
      const result = await agentService.registerAgent({
        projectId,
        name: 'auth-agent'
      });
      agentApiKey = result.apiKey;
    });

    it('should authenticate agent with valid API key', async () => {
      const agent = await agentService.authenticateAgent(agentApiKey, projectId);

      expect(agent.name).toBe('auth-agent');
      expect(agent.projectId).toBe(projectId);
    });

    it('should throw error for invalid API key', async () => {
      await expect(agentService.authenticateAgent('invalid-api-key', projectId))
        .rejects.toThrow('Invalid API key or agent not found');
    });

    it('should throw error for disabled agent', async () => {
      // Disable the agent
      const agents = await agentService.listAgents(projectId);
      const agent = agents.find(a => a.name === 'auth-agent')!;
      await agentService.disableAgent(agent.id);

      await expect(agentService.authenticateAgent(agentApiKey, projectId))
        .rejects.toThrow('Agent is disabled');
    });

    it('should update last seen timestamp on authentication', async () => {
      const agentBefore = await agentService.authenticateAgent(agentApiKey, projectId);
      const lastSeenBefore = agentBefore.lastSeen;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const agentAfter = await agentService.authenticateAgent(agentApiKey, projectId);
      const lastSeenAfter = agentAfter.lastSeen;

      expect(lastSeenAfter.getTime()).toBeGreaterThanOrEqual(lastSeenBefore.getTime());
    });
  });

  describe('getNextTask', () => {
    let agentName: string;
    let taskTypeId: string;

    beforeEach(async () => {
      agentName = 'task-agent';
      
      // Register agent
      await agentService.registerAgent({
        projectId,
        name: agentName
      });

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

    it('should get next task for agent', async () => {
      const task = await agentService.getNextTask(agentName, projectId);

      expect(task).not.toBeNull();
      expect(task!.status).toBe('running');
      expect(task!.assignedTo).toBe(agentName);
      expect(task!.assignedAt).toBeInstanceOf(Date);
      expect(task!.leaseExpiresAt).toBeInstanceOf(Date);

      // Check that agent status was updated
      const agent = await storage.getAgentByName(agentName, projectId);
      expect(agent!.status).toBe('working');
      expect(agent!.currentTaskId).toBe(task!.id);
    });

    it('should return null when no tasks available', async () => {
      // Register additional agents
      await agentService.registerAgent({
        projectId,
        name: 'other-agent'
      });
      
      await agentService.registerAgent({
        projectId,
        name: 'third-agent'
      });

      // Assign all tasks first
      await agentService.getNextTask(agentName, projectId);
      await agentService.getNextTask('other-agent', projectId);

      const task = await agentService.getNextTask('third-agent', projectId);
      expect(task).toBeNull();
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentService.getNextTask('non-existent-agent', projectId))
        .rejects.toThrow('Agent non-existent-agent not found in project');
    });

    it('should throw error for disabled agent', async () => {
      const agents = await agentService.listAgents(projectId);
      const agent = agents.find(a => a.name === agentName)!;
      await agentService.disableAgent(agent.id);

      await expect(agentService.getNextTask(agentName, projectId))
        .rejects.toThrow('Agent task-agent is disabled');
    });
  });

  describe('completeTask', () => {
    let agentName: string;
    let taskId: string;

    beforeEach(async () => {
      agentName = 'complete-agent';
      
      // Register agent and create task
      await agentService.registerAgent({
        projectId,
        name: agentName
      });

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
      await agentService.getNextTask(agentName, projectId);
    });

    it('should complete task successfully', async () => {
      const taskResult = {
        success: true,
        output: 'Task completed successfully',
        metadata: { key: 'value' }
      };

      await agentService.completeTask(agentName, projectId, taskId, taskResult);

      // Check task status
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('completed');
      expect(task!.result).toEqual(taskResult);
      expect(task!.completedAt).toBeInstanceOf(Date);

      // Check agent status
      const agent = await storage.getAgentByName(agentName, projectId);
      expect(agent!.status).toBe('idle');
      expect(agent!.currentTaskId).toBeUndefined();
    });

    it('should throw error for non-existent agent', async () => {
      const taskResult = { success: true, output: 'test' };

      await expect(agentService.completeTask('non-existent-agent', projectId, taskId, taskResult))
        .rejects.toThrow('Agent non-existent-agent not found in project');
    });

    it('should throw error for task not assigned to agent', async () => {
      // Register another agent
      await agentService.registerAgent({
        projectId,
        name: 'other-agent'
      });

      const taskResult = { success: true, output: 'test' };

      await expect(agentService.completeTask('other-agent', projectId, taskId, taskResult))
        .rejects.toThrow('is not assigned to agent other-agent');
    });
  });

  describe('failTask', () => {
    let agentName: string;
    let taskId: string;

    beforeEach(async () => {
      agentName = 'fail-agent';
      
      // Register agent and create task
      await agentService.registerAgent({
        projectId,
        name: agentName
      });

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
      await agentService.getNextTask(agentName, projectId);
    });

    it('should fail task with retry', async () => {
      const taskResult = {
        success: false,
        error: 'Task failed with error',
        canRetry: true
      };

      await agentService.failTask(agentName, projectId, taskId, taskResult, true);

      // Check task status - should be queued for retry
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('queued');
      expect(task!.retryCount).toBe(1);

      // Check agent status
      const agent = await storage.getAgentByName(agentName, projectId);
      expect(agent!.status).toBe('idle');
      expect(agent!.currentTaskId).toBeUndefined();
    });

    it('should fail task without retry', async () => {
      const taskResult = {
        success: false,
        error: 'Fatal error',
        canRetry: false
      };

      await agentService.failTask(agentName, projectId, taskId, taskResult, false);

      // Check task status - should be permanently failed
      const task = await taskService.getTask(taskId);
      expect(task!.status).toBe('failed');
      expect(task!.result).toEqual(taskResult);
      expect(task!.failedAt).toBeInstanceOf(Date);
    });

    it('should throw error for non-existent agent', async () => {
      const taskResult = { success: false, error: 'test' };

      await expect(agentService.failTask('non-existent-agent', projectId, taskId, taskResult))
        .rejects.toThrow('Agent non-existent-agent not found in project');
    });
  });

  describe('updateAgentStatus', () => {
    let agentName: string;

    beforeEach(async () => {
      agentName = 'status-agent';
      await agentService.registerAgent({
        projectId,
        name: agentName
      });
    });

    it('should update agent status', async () => {
      const updatedAgent = await agentService.updateAgentStatus(agentName, projectId, 'disabled');

      expect(updatedAgent.status).toBe('disabled');
      expect(updatedAgent.lastSeen).toBeInstanceOf(Date);
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentService.updateAgentStatus('non-existent-agent', projectId, 'disabled'))
        .rejects.toThrow('Agent non-existent-agent not found in project');
    });
  });

  describe('listAgents', () => {
    beforeEach(async () => {
      // Create test agents
      await agentService.registerAgent({
        projectId,
        name: 'agent-1',
        capabilities: ['testing']
      });

      await agentService.registerAgent({
        projectId,
        name: 'agent-2',
        capabilities: ['automation']
      });

      // Create agent in different project
      const otherProject = await projectService.createProject({
        name: 'other-project',
        description: 'Other project'
      });

      await agentService.registerAgent({
        projectId: otherProject.id,
        name: 'other-agent'
      });
    });

    it('should list agents for specific project', async () => {
      const agents = await agentService.listAgents(projectId);

      expect(agents).toHaveLength(2);
      expect(agents.every(a => a.projectId === projectId)).toBe(true);
      expect(agents.map(a => a.name)).toContain('agent-1');
      expect(agents.map(a => a.name)).toContain('agent-2');
    });

    it('should return empty array for project with no agents', async () => {
      const emptyProject = await projectService.createProject({
        name: 'empty-project',
        description: 'Project with no agents'
      });

      const agents = await agentService.listAgents(emptyProject.id);
      expect(agents).toHaveLength(0);
    });

    it('should throw error for non-existent project', async () => {
      await expect(agentService.listAgents('non-existent-project'))
        .rejects.toThrow('Project non-existent-project not found');
    });
  });

  describe('updateAgent', () => {
    let agentId: string;

    beforeEach(async () => {
      const result = await agentService.registerAgent({
        projectId,
        name: 'update-agent',
        capabilities: ['original']
      });
      agentId = result.agent.id;
    });

    it('should update agent name', async () => {
      const updated = await agentService.updateAgent(agentId, {
        name: 'updated-agent'
      });

      expect(updated.name).toBe('updated-agent');
    });

    it('should update agent capabilities', async () => {
      const updated = await agentService.updateAgent(agentId, {
        capabilities: ['new', 'capabilities']
      });

      expect(updated.capabilities).toEqual(['new', 'capabilities']);
    });

    it('should throw error for duplicate name within project', async () => {
      await agentService.registerAgent({
        projectId,
        name: 'existing-agent'
      });

      await expect(agentService.updateAgent(agentId, { name: 'existing-agent' }))
        .rejects.toThrow('Agent with name \'existing-agent\' already exists in project');
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentService.updateAgent('non-existent-id', { name: 'test' }))
        .rejects.toThrow('Agent non-existent-id not found');
    });
  });

  describe('disableAgent', () => {
    let agentId: string;

    beforeEach(async () => {
      const result = await agentService.registerAgent({
        projectId,
        name: 'disable-agent'
      });
      agentId = result.agent.id;
    });

    it('should disable idle agent', async () => {
      const disabled = await agentService.disableAgent(agentId);
      expect(disabled.status).toBe('disabled');
    });

    it('should throw error when disabling working agent', async () => {
      // Make agent work on a task
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'disable-task-type',
        template: 'Disable task for {{resource}}'
      });

      await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Disable test task',
        variables: { resource: 'test-resource' }
      });

      await agentService.getNextTask('disable-agent', projectId);

      await expect(agentService.disableAgent(agentId))
        .rejects.toThrow('Cannot disable agent');
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentService.disableAgent('non-existent-id'))
        .rejects.toThrow('Agent non-existent-id not found');
    });
  });

  describe('deleteAgent', () => {
    let agentId: string;

    beforeEach(async () => {
      const result = await agentService.registerAgent({
        projectId,
        name: 'delete-agent'
      });
      agentId = result.agent.id;
    });

    it('should delete idle agent', async () => {
      await agentService.deleteAgent(agentId);

      const deleted = await agentService.getAgent(agentId);
      expect(deleted).toBeNull();
    });

    it('should throw error when deleting working agent', async () => {
      // Make agent work on a task
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'delete-task-type',
        template: 'Delete task for {{resource}}'
      });

      await taskService.createTask({
        projectId,
        typeId: taskType.id,
        instructions: 'Delete test task',
        variables: { resource: 'test-resource' }
      });

      await agentService.getNextTask('delete-agent', projectId);

      await expect(agentService.deleteAgent(agentId))
        .rejects.toThrow('Cannot delete agent');
    });

    it('should throw error for non-existent agent', async () => {
      await expect(agentService.deleteAgent('non-existent-id'))
        .rejects.toThrow('Agent non-existent-id not found');
    });
  });
});