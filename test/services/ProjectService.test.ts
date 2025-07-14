import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync } from 'fs';
import { ProjectService } from '../../src/services/ProjectService.js';
import { FileStorageProvider } from '../../src/storage/FileStorageProvider.js';
import { createTestDataDir } from '../fixtures/index.js';

describe('ProjectService', () => {
  let storage: FileStorageProvider;
  let projectService: ProjectService;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = createTestDataDir();
    storage = new FileStorageProvider(testDataDir);
    await storage.initialize();
    projectService = new ProjectService(storage);
  });

  afterEach(async () => {
    await storage.close();
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('createProject', () => {
    it('should create a project with valid input', async () => {
      const input = {
        name: 'test-project',
        description: 'A test project'
      };

      const project = await projectService.createProject(input);

      expect(project.id).toBeDefined();
      expect(project.name).toBe('test-project');
      expect(project.description).toBe('A test project');
      expect(project.status).toBe('active');
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
      expect(project.config).toBeDefined();
      expect(project.stats).toBeDefined();
    });

    it('should create project with custom config', async () => {
      const input = {
        name: 'config-project',
        description: 'Project with custom config',
        config: {
          defaultMaxRetries: 5,
          defaultLeaseDurationMinutes: 15
        }
      };

      const project = await projectService.createProject(input);

      expect(project.config.defaultMaxRetries).toBe(5);
      expect(project.config.defaultLeaseDurationMinutes).toBe(15);
    });

    it('should throw validation error for invalid input', async () => {
      const input = {
        name: '', // Invalid empty name
        description: 'Test project'
      };

      await expect(projectService.createProject(input))
        .rejects.toThrow('Validation failed');
    });

    it('should throw error for duplicate project names', async () => {
      const input = {
        name: 'duplicate-project',
        description: 'First project'
      };

      const project1 = await projectService.createProject(input);
      expect(project1.name).toBe('duplicate-project');

      await expect(projectService.createProject(input))
        .rejects.toThrow('Project with name \'duplicate-project\' already exists');
    });
  });

  describe('getProject', () => {
    it('should retrieve existing project', async () => {
      const input = {
        name: 'retrieve-project',
        description: 'Project to retrieve'
      };

      const created = await projectService.createProject(input);
      const retrieved = await projectService.getProject(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('retrieve-project');
    });

    it('should return null for non-existent project', async () => {
      const result = await projectService.getProject('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateProject', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await projectService.createProject({
        name: 'update-project',
        description: 'Project to update'
      });
      projectId = project.id;
    });

    it('should update project description', async () => {
      const updated = await projectService.updateProject(projectId, {
        description: 'Updated description'
      });

      expect(updated.description).toBe('Updated description');
      expect(updated.name).toBe('update-project'); // Should remain unchanged
    });

    it('should update project config', async () => {
      const updated = await projectService.updateProject(projectId, {
        config: {
          defaultMaxRetries: 10
        }
      });

      expect(updated.config.defaultMaxRetries).toBe(10);
      expect(updated.config.defaultLeaseDurationMinutes).toBe(10); // Should retain default
    });

    it('should update project status', async () => {
      const updated = await projectService.updateProject(projectId, {
        status: 'closed'
      });

      expect(updated.status).toBe('closed');
    });

    it('should throw error for non-existent project', async () => {
      await expect(projectService.updateProject('non-existent-id', { description: 'test' }))
        .rejects.toThrow('Project non-existent-id not found');
    });

    it('should throw error for duplicate name during update', async () => {
      // Create two projects
      const project1 = await projectService.createProject({
        name: 'project-1',
        description: 'First project'
      });
      const project2 = await projectService.createProject({
        name: 'project-2',
        description: 'Second project'
      });

      // Try to rename project2 to have same name as project1
      await expect(projectService.updateProject(project2.id, { name: 'project-1' }))
        .rejects.toThrow('Project with name \'project-1\' already exists');
    });
  });

  describe('listProjects', () => {
    beforeEach(async () => {
      // Create test projects
      await projectService.createProject({
        name: 'active-project-1',
        description: 'Active project 1'
      });

      await projectService.createProject({
        name: 'active-project-2',
        description: 'Active project 2'
      });

      const closedProject = await projectService.createProject({
        name: 'closed-project',
        description: 'Project to close'
      });

      await projectService.updateProject(closedProject.id, {
        status: 'closed'
      });
    });

    it('should list active projects by default', async () => {
      const projects = await projectService.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects.every(p => p.status === 'active')).toBe(true);
      expect(projects.map(p => p.name)).toContain('active-project-1');
      expect(projects.map(p => p.name)).toContain('active-project-2');
    });

    it('should list all projects when includeClosed is true', async () => {
      const projects = await projectService.listProjects(true);

      expect(projects).toHaveLength(3);
      expect(projects.map(p => p.name)).toContain('closed-project');
    });

    it('should return empty array when no projects exist', async () => {
      // Clean up existing projects
      const existingProjects = await projectService.listProjects(true);
      for (const project of existingProjects) {
        await projectService.deleteProject(project.id);
      }

      const projects = await projectService.listProjects();
      expect(projects).toHaveLength(0);
    });
  });

  describe('deleteProject', () => {
    it('should delete existing project', async () => {
      const project = await projectService.createProject({
        name: 'delete-project',
        description: 'Project to delete'
      });

      await projectService.deleteProject(project.id);

      const retrieved = await projectService.getProject(project.id);
      expect(retrieved).toBeNull();
    });

    it('should throw error when deleting non-existent project', async () => {
      await expect(projectService.deleteProject('non-existent-id'))
        .rejects.toThrow('Project non-existent-id not found');
    });
  });

  describe('validateProjectAccess', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await projectService.createProject({
        name: 'access-project',
        description: 'Project for access validation'
      });
      projectId = project.id;
    });

    it('should pass validation for existing active project', async () => {
      const project = await projectService.validateProjectAccess(projectId);
      expect(project).toBeDefined();
      expect(project.status).toBe('active');
    });

    it('should throw error for non-existent project', async () => {
      await expect(projectService.validateProjectAccess('non-existent-id'))
        .rejects.toThrow('Project non-existent-id not found');
    });

    it('should throw error for closed project', async () => {
      await projectService.updateProject(projectId, { status: 'closed' });

      await expect(projectService.validateProjectAccess(projectId))
        .rejects.toThrow('is closed and cannot accept new tasks or agents');
    });
  });
});