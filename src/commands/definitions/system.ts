/**
 * System Commands (Health Check, Lease Management)
 */

import chalk from 'chalk';
import { CommandParameter, defineCommand, TaskTypes } from '../types.js';
import { findProjectByNameOrId } from '../utils.js';

export interface HealthCheckData {
  status?: string;
  timestamp?: Date | string;
  storage?: {
    healthy?: boolean;
    status?: string;
    message?: string;
  };
}

export interface ExtendTaskLeaseData {
  taskId: string;
  extensionMinutes: number;
  newExpiresAt?: Date | string;
}

export interface LeaseStatsData {
  projectId: string;
  projectName: string;
  stats: {
    totalRunningTasks?: number;
    expiredTasks?: number;
    tasksByStatus?: Record<string, number>;
  };
}

export interface CleanupResultsData {
  projectId: string;
  projectName: string;
  reclaimedTasks: number;
  cleanedAgents: number;
}

function formatHealthCheck(data: HealthCheckData): string {
  const statusColor = data.status === 'healthy' ? chalk.green : chalk.red;
  let output = `\n${chalk.bold('System Status:')} ${statusColor(data.status?.toUpperCase() || 'UNKNOWN')}\n`;
  
  if (data.timestamp) {
    output += `${chalk.gray('Timestamp:')} ${new Date(data.timestamp).toLocaleString()}\n`;
  }

  if (data.storage) {
    output += `\n${chalk.bold('Storage:')}\n`;
    const isHealthy = data.storage.healthy === true || data.storage.status === 'healthy';
    const storageStatus = isHealthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy');
    output += `  Status: ${storageStatus}\n`;
    if (data.storage.message) {
      output += `  Message: ${data.storage.message}\n`;
    }
  }

  return output;
}

function formatExtendTaskLease(data: ExtendTaskLeaseData): string {
  let output = `\n${chalk.bold('Task Lease Extended:')}\n`;
  output += `${chalk.gray('Task ID:')} ${data.taskId}\n`;
  output += `${chalk.gray('Extension:')} ${data.extensionMinutes} minutes\n`;
  if (data.newExpiresAt) {
    output += `${chalk.gray('New Expiry:')} ${new Date(data.newExpiresAt).toLocaleString()}\n`;
  }
  return output;
}

function formatLeaseStats(data: LeaseStatsData): string {
  let output = `\n${chalk.bold('Lease Statistics for Project:')} ${data.projectName || 'Unknown'}\n`;
  
  if (data.stats) {
    const stats = data.stats;
    
    if (stats.totalRunningTasks !== undefined) {
      output += `\n${chalk.bold('Lease Statistics:')}\n`;
      output += `  Running Tasks: ${chalk.blue(stats.totalRunningTasks)}\n`;
      output += `  Expired Tasks: ${chalk.red(stats.expiredTasks)}\n`;
      
      if (stats.tasksByStatus) {
        output += `\n${chalk.bold('Tasks by Status:')}\n`;
        for (const [status, count] of Object.entries(stats.tasksByStatus)) {
          output += `  ${status}: ${count}\n`;
        }
      }
    }
  }
  
  return output;
}

function formatCleanupResults(data: CleanupResultsData): string {
  let output = `\n${chalk.bold('Cleanup Results:')}\n`;
  output += `${chalk.gray('Project:')} ${data.projectName || 'Unknown'}\n`;
  output += `${chalk.gray('Reclaimed Tasks:')} ${chalk.green(data.reclaimedTasks || 0)}\n`;
  output += `${chalk.gray('Cleaned Agents:')} ${chalk.blue(data.cleanedAgents || 0)}\n`;
  return output;
}

// Health Check Command
const healthCheckParams = [] as const satisfies CommandParameter[];

export const healthCheck = defineCommand({
  name: 'healthCheck',
  mcpName: 'health_check',
  cliName: 'health-check',
  description: 'Check TaskDriver system health including storage connectivity, resource availability, and system status. Use this to verify the system is operational before starting work or to troubleshoot issues.',
  parameters: healthCheckParams,
  returnDataType: 'health',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatHealthCheck(result.data!);
  },
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
});

export type HealthCheckTypes = TaskTypes<typeof healthCheck>;

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
] as const satisfies CommandParameter[];

export const extendTaskLease = defineCommand({
  name: 'extendTaskLease',
  mcpName: 'extend_task_lease',
  cliName: 'extend-task-lease',
  description: 'Extend the lease duration for a long-running task to prevent it from being reassigned to another agent. Use this when tasks take longer than expected to prevent timeout-based reassignment.',
  parameters: extendTaskLeaseParams,
  returnDataType: 'single',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatExtendTaskLease(result.data!);
  },
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
});

export type ExtendTaskLeaseTypes = TaskTypes<typeof extendTaskLease>;

// Get Lease Stats Command
const getLeaseStatsParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const getLeaseStats = defineCommand({
  name: 'getLeaseStats',
  mcpName: 'get_lease_stats',
  cliName: 'get-lease-stats',
  description: 'Get statistics about task leases including active leases, expired leases, and lease duration metrics. Use this to monitor system performance, identify stuck tasks, or analyze task execution patterns.',
  parameters: getLeaseStatsParams,
  returnDataType: 'stats',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatLeaseStats(result.data!);
  },
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
});

export type GetLeaseStatsTypes = TaskTypes<typeof getLeaseStats>;

// Cleanup Expired Leases Command
const cleanupExpiredLeasesParams = [
  {
    name: 'projectId',
    type: 'string',
    description: 'Project ID or name',
    required: true,
    positional: true
  }
] as const satisfies CommandParameter[];

export const cleanupExpiredLeases = defineCommand({
  name: 'cleanupExpiredLeases',
  mcpName: 'cleanup_expired_leases',
  cliName: 'cleanup-expired-leases',
  description: 'Clean up expired task leases and make abandoned tasks available for reassignment. Use this to recover from agent failures, clean up stuck tasks, or perform maintenance on the task queue.',
  parameters: cleanupExpiredLeasesParams,
  returnDataType: 'generic',
  formatResult: (result, args) => {
    if (!result.success) {
      return `${chalk.red('Error:')} ${result.error || 'Unknown error'}`;
    }
    
    return formatCleanupResults(result.data!);
  },
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
});

export type CleanupExpiredLeasesTypes = TaskTypes<typeof cleanupExpiredLeases>;