import { StorageProvider } from '../storage/index.js';
import { Task, Project } from '../types/index.js';
import { ProjectService } from './ProjectService.js';

/**
 * Service for cleaning up expired leases and zombie tasks
 */
export class ReaperService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private storage: StorageProvider,
    private projectService: ProjectService
  ) {}

  /**
   * Start the reaper for a specific project
   */
  async startReaper(projectId: string): Promise<void> {
    // Stop existing reaper if running
    this.stopReaper(projectId);

    const project = await this.projectService.validateProjectAccess(projectId);
    const intervalMinutes = project.config.reaperIntervalMinutes;

    const interval = setInterval(async () => {
      try {
        await this.reapExpiredTasks(projectId);
      } catch (error) {
        console.error(`Reaper error for project ${projectId}:`, error);
      }
    }, intervalMinutes * 60 * 1000);

    this.intervals.set(projectId, interval);
    console.log(`Reaper started for project ${projectId} (interval: ${intervalMinutes} minutes)`);
  }

  /**
   * Stop the reaper for a specific project
   */
  stopReaper(projectId: string): void {
    const interval = this.intervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(projectId);
      console.log(`Reaper stopped for project ${projectId}`);
    }
  }

  /**
   * Start reapers for all active projects
   */
  async startAllReapers(): Promise<void> {
    const projects = await this.storage.listProjects(false); // Only active projects
    
    for (const project of projects) {
      await this.startReaper(project.id);
    }
  }

  /**
   * Stop all reapers
   */
  stopAllReapers(): void {
    for (const [projectId] of this.intervals) {
      this.stopReaper(projectId);
    }
  }

  /**
   * Manually reap expired tasks for a project
   */
  async reapExpiredTasks(projectId: string): Promise<{ reaped: number; errors: string[] }> {
    const project = await this.projectService.validateProjectAccess(projectId);
    const now = new Date();
    const errors: string[] = [];
    let reaped = 0;

    try {
      // Get all running tasks for this project
      const runningTasks = await this.storage.listTasks(projectId, { status: 'running' });
      
      for (const task of runningTasks) {
        try {
          // Check if task lease has expired
          if (task.leaseExpiresAt && task.leaseExpiresAt < now) {
            await this.reapTask(task, 'Lease expired');
            reaped++;
          }
        } catch (error: any) {
          errors.push(`Failed to reap task ${task.id}: ${error.message}`);
        }
      }

      // Also check for agents that haven't been seen in a while
      await this.reapZombieAgents(projectId, errors);

    } catch (error: any) {
      errors.push(`Failed to reap tasks for project ${projectId}: ${error.message}`);
    }

    if (reaped > 0) {
      console.log(`Reaped ${reaped} expired tasks for project ${projectId}`);
    }

    return { reaped, errors };
  }

  /**
   * Reap a specific task that has expired
   */
  private async reapTask(task: Task, reason: string): Promise<void> {
    console.log(`Reaping task ${task.id}: ${reason}`);

    // Mark the task as failed due to lease expiry
    await this.storage.failTask(task.id, task.assignedTo || 'unknown', {
      success: false,
      output: '',
      error: `Task reaped: ${reason}`,
      duration: 0,
      metadata: {
        reapedAt: new Date().toISOString(),
        reason,
      },
    }, true); // Allow retry

    // In lease-based model, no agent state to clean up - leases are task-scoped
  }

  /**
   * In lease-based model, zombie agents don't exist since agents are ephemeral
   * This method is kept for compatibility but is a no-op
   */
  private async reapZombieAgents(projectId: string, errors: string[]): Promise<void> {
    // In the lease-based model, agents are ephemeral and only exist 
    // when they have active task leases. There are no "zombie agents"
    // to clean up - just expired task leases.
  }

  /**
   * Get reaper status for all projects
   */
  getReaperStatus(): { projectId: string; active: boolean }[] {
    const projects = [...this.intervals.keys()];
    return projects.map(projectId => ({
      projectId,
      active: this.intervals.has(projectId),
    }));
  }

  /**
   * Manually force reap all projects
   */
  async forceReapAll(): Promise<{ [projectId: string]: { reaped: number; errors: string[] } }> {
    const projects = await this.storage.listProjects(false);
    const results: { [projectId: string]: { reaped: number; errors: string[] } } = {};

    for (const project of projects) {
      results[project.id] = await this.reapExpiredTasks(project.id);
    }

    return results;
  }
}