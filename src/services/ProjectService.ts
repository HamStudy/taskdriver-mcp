import { 
  Project, 
  ProjectCreateInput, 
  ProjectUpdateInput, 
  ProjectStatus 
} from '../types/index.js';
import { StorageProvider } from '../storage/index.js';
import { validate, createProjectSchema } from '../utils/validation.js';

/**
 * Service for managing projects
 */
export class ProjectService {
  constructor(private storage: StorageProvider) {}

  /**
   * Create a new project
   */
  async createProject(input: ProjectCreateInput): Promise<Project> {
    const validatedInput = validate(createProjectSchema, input);
    return this.storage.createProject(validatedInput);
  }

  /**
   * Get a project by ID
   */
  async getProject(projectId: string): Promise<Project | null> {
    return this.storage.getProject(projectId);
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    return this.storage.updateProject(projectId, input);
  }

  /**
   * List projects (active by default)
   */
  async listProjects(includeClosed: boolean = false): Promise<Project[]> {
    return this.storage.listProjects(includeClosed);
  }

  /**
   * Close a project (mark as inactive)
   */
  async closeProject(projectId: string): Promise<Project> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (project.status === 'closed') {
      throw new Error(`Project ${projectId} is already closed`);
    }

    return this.storage.updateProject(projectId, { status: 'closed' });
  }

  /**
   * Delete a project (permanent removal)
   */
  async deleteProject(projectId: string): Promise<void> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    return this.storage.deleteProject(projectId);
  }

  /**
   * Get detailed project status with metrics
   */
  async getProjectStatus(projectId: string): Promise<ProjectStatus> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const agents = await this.storage.listAgents(projectId);
    const activeAgents = agents.filter(agent => 
      agent.status === 'working' || 
      (Date.now() - agent.lastSeen.getTime()) < 5 * 60 * 1000 // Active within 5 minutes
    ).length;

    // Calculate recent activity (would need more sophisticated queries in real implementation)
    const recentActivity = {
      tasksCompletedLastHour: 0, // TODO: Implement time-based queries
      tasksFailedLastHour: 0,
      averageTaskDuration: 0,
    };

    return {
      project,
      queueDepth: project.stats.queuedTasks,
      activeAgents,
      recentActivity,
    };
  }

  /**
   * Validate that a project exists and is active
   */
  async validateProjectAccess(projectId: string): Promise<Project> {
    const project = await this.storage.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (project.status === 'closed') {
      throw new Error(`Project ${projectId} is closed and cannot accept new tasks or agents`);
    }

    return project;
  }
}