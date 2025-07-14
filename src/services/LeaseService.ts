import { StorageProvider } from '../storage/index.js';
import { Task, TaskResult } from '../types/index.js';

/**
 * Service for managing task leases and expired task recovery
 * Implements lease cleanup as part of task assignment flow
 */
export class LeaseService {
  constructor(private storage: StorageProvider) {}

  /**
   * Clean up expired leases for a project before assigning new tasks
   * This is called during task assignment to ensure expired tasks are reclaimed
   */
  async cleanupExpiredLeases(projectId: string): Promise<{
    reclaimedTasks: number;
    cleanedAgents: number;
  }> {
    let reclaimedTasks = 0;
    let cleanedAgents = 0;

    try {
      // Get all running tasks for this project
      const runningTasks = await this.storage.listTasks(projectId, {
        status: 'running'
      });

      const now = new Date();
      const expiredTasks = runningTasks.filter(task => 
        task.leaseExpiresAt && task.leaseExpiresAt < now
      );

      // Reclaim expired tasks
      for (const task of expiredTasks) {
        try {
          // Get agent state before reclaiming the task
          let agentToClean: any = null;
          if (task.assignedTo) {
            const agent = await this.storage.getAgentByName(task.assignedTo, projectId);
            if (agent && agent.currentTaskId === task.id) {
              agentToClean = agent;
            }
          }

          // Reclaim the task
          await this.reclaimExpiredTask(task);
          reclaimedTasks++;

          // Clean up the agent state if needed
          if (agentToClean) {
            await this.storage.updateAgent(agentToClean.id, {
              status: 'idle',
              currentTaskId: undefined,
              lastSeen: new Date()
            });
            cleanedAgents++;
          }
        } catch (error) {
          console.error(`❌ Failed to reclaim expired task ${task.id}:`, error);
        }
      }

      if (reclaimedTasks > 0) {
        console.log(`🔄 Reclaimed ${reclaimedTasks} expired tasks for project ${projectId}`);
      }

    } catch (error) {
      console.error(`❌ Failed to cleanup expired leases for project ${projectId}:`, error);
    }

    return { reclaimedTasks, cleanedAgents };
  }

  /**
   * Reclaim a specific expired task
   */
  private async reclaimExpiredTask(task: Task): Promise<void> {
    console.log(`⏰ Reclaiming expired task ${task.id} from agent ${task.assignedTo}`);

    // Create a task result indicating timeout
    const timeoutResult: TaskResult = {
      success: false,
      error: 'Task lease expired - agent did not complete task within allotted time',
      explanation: `Task was assigned to agent ${task.assignedTo} but the lease expired at ${task.leaseExpiresAt?.toISOString()}`,
      canRetry: true,
      metadata: {
        reclaimedAt: new Date().toISOString(),
        originalAssignedTo: task.assignedTo,
        originalAssignedAt: task.assignedAt?.toISOString()
      }
    };

    // Fail the task with timeout reason - this will handle retry logic
    await this.storage.failTask(task.id, timeoutResult, true);

    console.log(`✅ Task ${task.id} reclaimed and requeued for retry`);
  }

  /**
   * Extend a task lease (for agents that need more time)
   */
  async extendTaskLease(taskId: string, extensionMinutes: number): Promise<void> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running`);
    }

    const currentExpiry = task.leaseExpiresAt || new Date();
    const newExpiry = new Date(currentExpiry.getTime() + extensionMinutes * 60 * 1000);

    await this.storage.updateTask(taskId, {
      leaseExpiresAt: newExpiry
    });

    console.log(`⏱️ Extended lease for task ${taskId} by ${extensionMinutes} minutes until ${newExpiry.toISOString()}`);
  }

  /**
   * Get lease statistics for monitoring
   */
  async getLeaseStats(projectId: string): Promise<{
    totalRunningTasks: number;
    expiredTasks: number;
    tasksByStatus: Record<string, number>;
  }> {
    const now = new Date();
    
    // Get all tasks for the project
    const allTasks = await this.storage.listTasks(projectId);
    
    const tasksByStatus = allTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const runningTasks = allTasks.filter(task => task.status === 'running');
    const expiredTasks = runningTasks.filter(task => 
      task.leaseExpiresAt && task.leaseExpiresAt < now
    );

    return {
      totalRunningTasks: runningTasks.length,
      expiredTasks: expiredTasks.length,
      tasksByStatus
    };
  }
}