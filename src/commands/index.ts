/**
 * Unified command definitions - all commands organized by category
 */

import { CommandDefinition } from './types.js';

// Import all command categories from definitions subdirectory
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  getProjectStats
} from './definitions/project.js';

import {
  createTaskType,
  listTaskTypes,
  getTaskType
} from './definitions/tasktype.js';

import {
  createTask,
  createTasksBulk,
  listTasks,
  getTask
} from './definitions/task.js';

import {
  getNextTask,
  peekNextTask,
  listActiveAgents,
  completeTask,
  failTask
} from './definitions/agent.js';

import {
  healthCheck,
  extendTaskLease,
  getLeaseStats,
  cleanupExpiredLeases
} from './definitions/system.js';

// Export all command definitions organized by category
export const COMMAND_DEFINITIONS: CommandDefinition<any>[] = [
  // Project Management
  createProject,
  listProjects,
  getProject,
  updateProject,
  getProjectStats,
  
  // Task Type Management
  createTaskType,
  listTaskTypes,
  getTaskType,
  
  // Task Management
  createTask,
  createTasksBulk,
  listTasks,
  getTask,
  
  // Task Execution (Lease-based Queue Workers)
  getNextTask,
  peekNextTask,
  listActiveAgents,
  completeTask,
  failTask,
  
  // System & Lease Management
  healthCheck,
  extendTaskLease,
  getLeaseStats,
  cleanupExpiredLeases
];

// Export individual commands for direct access
export {
  // Project Management
  createProject,
  listProjects,
  getProject,
  updateProject,
  getProjectStats,
  
  // Task Type Management
  createTaskType,
  listTaskTypes,
  getTaskType,
  
  // Task Management
  createTask,
  createTasksBulk,
  listTasks,
  getTask,
  
  // Task Execution (Lease-based Queue Workers)
  getNextTask,
  peekNextTask,
  listActiveAgents,
  completeTask,
  failTask,
  
  // System & Lease Management
  healthCheck,
  extendTaskLease,
  getLeaseStats,
  cleanupExpiredLeases
};