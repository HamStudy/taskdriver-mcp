/**
 * System Commands (Health Check, Lease Management)
 */

import { CommandDefinition } from '../types.js';
import { findProjectByNameOrId } from '../utils.js';

// Health Check Command
const healthCheckParams = [] as const;

export const healthCheck: CommandDefinition<typeof healthCheckParams> = {
  name: 'healthCheck',
  mcpName: 'health_check',
  cliName: 'health-check',
  description: 'Check TaskDriver system health including storage connectivity, resource availability, and system status. Use this to verify the system is operational before starting work or to troubleshoot issues.',
  parameters: healthCheckParams,
  async handler(context) {
    const healthStatus = await context.storage.healthCheck();

    return {
      success: healthStatus.healthy,
      data: {
        status: healthStatus.healthy ? 'healthy' : 'unhealthy',
        storage: healthStatus,
        timestamp: new Date().toISOString()
      }
    };
  }
};

// Extend Task Lease Command
const extendTaskLeaseParams = [
  {
    name: 'taskId',
    type: 'string',
    description: 'Task ID',
    required: true,
    positional: true
  },
  {
    name: 'extensionMinutes',
    type: 'number',
    description: 'Minutes to extend lease by',
    required: true,
    positional: true
  }
] as const;

export const extendTaskLease: CommandDefinition<typeof extendTaskLeaseParams> = {
  name: 'extendTaskLease',
  mcpName: 'extend_task_lease',
  cliName: 'extend-task-lease',
  description: 'Extend the lease duration for a long-running task to prevent it from being reassigned to another agent. Use this when tasks take longer than expected to prevent timeout-based reassignment.',
  parameters: extendTaskLeaseParams,
  async handler(context, args) {
    await context.lease.extendTaskLease(args.taskId, args.extensionMinutes);

    // Get updated task to return new expiry
    const updatedTask = await context.task.getTask(args.taskId);

    return {
      success: true,
      data: {
        taskId: args.taskId,
        extensionMinutes: args.extensionMinutes,
        newExpiresAt: updatedTask?.leaseExpiresAt
      },
      message: `Task lease extended by ${args.extensionMinutes} minutes`
    };
  }
};

// Get Lease Stats Command
const getLeaseStatsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const getLeaseStats: CommandDefinition<typeof getLeaseStatsParams> = {
  name: 'getLeaseStats',
  mcpName: 'get_lease_stats',
  cliName: 'get-lease-stats',
  description: 'Get statistics about task leases including active leases, expired leases, and lease duration metrics. Use this to monitor system performance, identify stuck tasks, or analyze task execution patterns.',
  parameters: getLeaseStatsParams,
  async handler(context, args) {
    // Find project
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    const stats = await context.lease.getLeaseStats(project.id);

    return {
      success: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        stats
      }
    };
  }
};

// Cleanup Expired Leases Command
const cleanupExpiredLeasesParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const;

export const cleanupExpiredLeases: CommandDefinition<typeof cleanupExpiredLeasesParams> = {
  name: 'cleanupExpiredLeases',
  mcpName: 'cleanup_expired_leases',
  cliName: 'cleanup-leases',
  description: 'Clean up expired task leases and make abandoned tasks available for reassignment. Use this to recover from agent failures, clean up stuck tasks, or perform maintenance on the task queue.',
  parameters: cleanupExpiredLeasesParams,
  async handler(context, args) {
    // Find project
    const projects = await context.project.listProjects(true);
    const project = findProjectByNameOrId(projects, args.projectId);
    if (!project) {
      return {
        success: false,
        error: `Project '${args.projectId}' not found`
      };
    }

    const result = await context.lease.cleanupExpiredLeases(project.id);

    return {
      success: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        reclaimedTasks: result.reclaimedTasks,
        cleanedAgents: result.cleanedAgents
      },
      message: `Cleaned up ${result.reclaimedTasks} expired leases, cleaned ${result.cleanedAgents} agents`
    };
  }
};