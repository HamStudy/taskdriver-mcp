import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { TaskTypeService } from '../../src/services/TaskTypeService.js';
import { ProjectService } from '../../src/services/ProjectService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('TaskTypeService', () => {
  let storage: FileStorageProvider;
  let taskTypeService: TaskTypeService;
  let projectService: ProjectService;
  let testDataDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    
    projectService = new ProjectService(storage);
    taskTypeService = new TaskTypeService(storage, projectService);

    // Create a test project
    const project = await projectService.createProject({
      name: 'test-project',
      description: 'Test project for task types'
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('createTaskType', () => {
    it('should create a task type with minimal input', async () => {
      const input = {
        projectId,
        name: 'simple-task',
        template: 'Simple task with no variables'
      };

      const taskType = await taskTypeService.createTaskType(input);

      expect(taskType.id).toBeDefined();
      expect(taskType.name).toBe('simple-task');
      expect(taskType.projectId).toBe(projectId);
      expect(taskType.template).toBe('Simple task with no variables');
      expect(taskType.variables).toEqual([]); // Auto-detected from template
      expect(taskType.duplicateHandling).toBe('allow');
      expect(taskType.maxRetries).toBe(3); // Default from project config
      expect(taskType.leaseDurationMinutes).toBe(10); // Default from project config
      expect(taskType.createdAt).toBeInstanceOf(Date);
      expect(taskType.updatedAt).toBeInstanceOf(Date);
    });

    it('should create task type with template and variables', async () => {
      const input = {
        projectId,
        name: 'templated-task',
        template: 'Process {{item}} with {{action}}',
        variables: ['item', 'action']
      };

      const taskType = await taskTypeService.createTaskType(input);

      expect(taskType.template).toBe('Process {{item}} with {{action}}');
      expect(taskType.variables).toEqual(['item', 'action']);
    });

    it('should auto-detect variables from template', async () => {
      const input = {
        projectId,
        name: 'auto-detect-task',
        template: 'Process {{item}} with {{action}} and {{mode}}'
        // No variables provided - should be auto-detected
      };

      const taskType = await taskTypeService.createTaskType(input);

      expect(taskType.template).toBe('Process {{item}} with {{action}} and {{mode}}');
      expect(taskType.variables).toEqual(['action', 'item', 'mode']); // Variables are sorted alphabetically
    });

    it('should create task type with custom configuration', async () => {
      const input = {
        projectId,
        name: 'custom-task',
        template: 'Custom task for {{category}}',
        duplicateHandling: 'fail' as const,
        maxRetries: 5,
        leaseDurationMinutes: 30
      };

      const taskType = await taskTypeService.createTaskType(input);

      expect(taskType.template).toBe('Custom task for {{category}}');
      expect(taskType.variables).toEqual(['category']); // Auto-detected from template
      expect(taskType.duplicateHandling).toBe('fail');
      expect(taskType.maxRetries).toBe(5);
      expect(taskType.leaseDurationMinutes).toBe(30);
    });

    it('should throw validation error for invalid input', async () => {
      const input = {
        projectId,
        name: '', // Invalid empty name
        template: 'Test template'
      };

      await expect(taskTypeService.createTaskType(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw validation error for invalid project ID format', async () => {
      const input = {
        projectId: 'non-existent-project',
        name: 'test-task',
        template: 'Test template'
      };

      await expect(taskTypeService.createTaskType(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw error for duplicate task type name in project', async () => {
      const input = {
        projectId,
        name: 'duplicate-task',
        template: 'Duplicate task for {{id}}'
      };

      await taskTypeService.createTaskType(input);

      await expect(taskTypeService.createTaskType(input))
        .rejects.toThrow('Task type with name \'duplicate-task\' already exists in project');
    });

    it('should allow same task type name in different projects', async () => {
      const secondProject = await projectService.createProject({
        name: 'second-project',
        description: 'Second test project'
      });

      const input = {
        projectId,
        name: 'shared-name',
        template: 'Shared task for {{user}}'
      };

      const input2 = {
        projectId: secondProject.id,
        name: 'shared-name',
        template: 'Shared task for {{user}}'
      };

      const taskType1 = await taskTypeService.createTaskType(input);
      const taskType2 = await taskTypeService.createTaskType(input2);

      expect(taskType1.name).toBe('shared-name');
      expect(taskType2.name).toBe('shared-name');
      expect(taskType1.projectId).toBe(projectId);
      expect(taskType2.projectId).toBe(secondProject.id);
    });
  });

  describe('getTaskType', () => {
    it('should retrieve existing task type', async () => {
      const created = await taskTypeService.createTaskType({
        projectId,
        name: 'retrieve-task',
        template: 'Retrieve task for {{resource}}'
      });

      const retrieved = await taskTypeService.getTaskType(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('retrieve-task');
      expect(retrieved!.template).toBe('Retrieve task for {{resource}}');
    });

    it('should return null for non-existent task type', async () => {
      const result = await taskTypeService.getTaskType('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateTaskType', () => {
    let taskTypeId: string;

    beforeEach(async () => {
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'update-task',
        template: 'Original template',
        variables: ['original']
      });
      taskTypeId = taskType.id;
    });

    it('should update task type template', async () => {
      const updated = await taskTypeService.updateTaskType(taskTypeId, {
        template: 'Updated template {{new_var}}',
        variables: ['new_var']
      });

      expect(updated.template).toBe('Updated template {{new_var}}');
      expect(updated.variables).toEqual(['new_var']);
      expect(updated.name).toBe('update-task'); // Should remain unchanged
    });

    it('should update task type configuration', async () => {
      const updated = await taskTypeService.updateTaskType(taskTypeId, {
        duplicateHandling: 'ignore',
        maxRetries: 10,
        leaseDurationMinutes: 60
      });

      expect(updated.duplicateHandling).toBe('ignore');
      expect(updated.maxRetries).toBe(10);
      expect(updated.leaseDurationMinutes).toBe(60);
    });

    it('should throw error for non-existent task type', async () => {
      await expect(taskTypeService.updateTaskType('non-existent-id', { template: 'test' }))
        .rejects.toThrow('Task type non-existent-id not found');
    });

    it('should throw error for duplicate name within project', async () => {
      await taskTypeService.createTaskType({
        projectId,
        name: 'existing-name',
        template: 'Existing task for {{type}}'
      });

      await expect(taskTypeService.updateTaskType(taskTypeId, { name: 'existing-name' }))
        .rejects.toThrow('Task type with name \'existing-name\' already exists in project');
    });
  });

  describe('listTaskTypes', () => {
    beforeEach(async () => {
      // Create test task types
      await taskTypeService.createTaskType({
        projectId,
        name: 'task-type-1',
        template: 'Task type 1 for {{context}}'
      });

      await taskTypeService.createTaskType({
        projectId,
        name: 'task-type-2',
        template: 'Task type 2 for {{context}}'
      });

      // Create task type in different project
      const otherProject = await projectService.createProject({
        name: 'other-project',
        description: 'Other project'
      });

      await taskTypeService.createTaskType({
        projectId: otherProject.id,
        name: 'other-task-type',
        template: 'Other task type for {{context}}'
      });
    });

    it('should list task types for specific project', async () => {
      const taskTypes = await taskTypeService.listTaskTypes(projectId);

      expect(taskTypes).toHaveLength(2);
      expect(taskTypes.every(tt => tt.projectId === projectId)).toBe(true);
      expect(taskTypes.map(tt => tt.name)).toContain('task-type-1');
      expect(taskTypes.map(tt => tt.name)).toContain('task-type-2');
    });

    it('should return empty array for project with no task types', async () => {
      const emptyProject = await projectService.createProject({
        name: 'empty-project',
        description: 'Project with no task types'
      });

      const taskTypes = await taskTypeService.listTaskTypes(emptyProject.id);
      expect(taskTypes).toHaveLength(0);
    });

    it('should throw error for non-existent project', async () => {
      await expect(taskTypeService.listTaskTypes('non-existent-project'))
        .rejects.toThrow('Project non-existent-project not found');
    });
  });

  describe('deleteTaskType', () => {
    it('should delete existing task type', async () => {
      const taskType = await taskTypeService.createTaskType({
        projectId,
        name: 'delete-task',
        template: 'Delete task for {{resource}}'
      });

      await taskTypeService.deleteTaskType(taskType.id);

      const retrieved = await taskTypeService.getTaskType(taskType.id);
      expect(retrieved).toBeNull();
    });

    it('should throw error for non-existent task type', async () => {
      await expect(taskTypeService.deleteTaskType('non-existent-id'))
        .rejects.toThrow('Task type non-existent-id not found');
    });
  });

});