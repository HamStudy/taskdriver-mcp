/**
 * Unified command definitions - all commands organized by category
 */

import { CommandDefinition, CommandParameter, CommandResult } from './types.js';

// Import all command categories from definitions subdirectory
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  getProjectStats
} from './definitions/project.js';

import type {
  CreateProjectTypes,
  ListProjectsTypes,
  GetProjectTypes,
  UpdateProjectTypes,
  GetProjectStatsTypes
} from './definitions/project.js';

import {
  createTaskType,
  listTaskTypes,
  getTaskType,
  updateTaskType
} from './definitions/tasktype.js';

import type {
  CreateTaskTypeTypes,
  ListTaskTypesTypes,
  GetTaskTypeTypes,
  UpdateTaskTypeTypes
} from './definitions/tasktype.js';

import {
  createTask,
  createTasksBulk,
  listTasks,
  getTask
} from './definitions/task.js';

import type {
  CreateTaskTypes,
  CreateTasksBulkTypes,
  ListTasksTypes,
  GetTaskTypes
} from './definitions/task.js';

import {
  getNextTask,
  peekNextTask,
  listActiveAgents,
  completeTask,
  failTask,
  extendLease
} from './definitions/agent.js';

import type {
  GetNextTaskTypes,
  PeekNextTaskTypes,
  ListActiveAgentsTypes,
  CompleteTaskTypes,
  FailTaskTypes,
  ExtendLeaseTypes
} from './definitions/agent.js';

import {
  healthCheck,
  extendTaskLease,
  getLeaseStats,
  cleanupExpiredLeases
} from './definitions/system.js';

import type {
  HealthCheckTypes,
  ExtendTaskLeaseTypes,
  GetLeaseStatsTypes,
  CleanupExpiredLeasesTypes
} from './definitions/system.js';

// Export all command definitions organized by category
export const COMMAND_DEFINITIONS = [
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
  updateTaskType,
  
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
  extendLease,
  
  // System & Lease Management
  healthCheck,
  extendTaskLease,
  getLeaseStats,
  cleanupExpiredLeases
] as const satisfies CommandDefinition[];

export type AllCommandTypes = CreateProjectTypes |
  ListProjectsTypes |
  GetProjectTypes |
  UpdateProjectTypes |
  GetProjectStatsTypes |
  CreateTaskTypeTypes |
  ListTaskTypesTypes |
  GetTaskTypeTypes |
  UpdateTaskTypeTypes |
  CreateTaskTypes |
  CreateTasksBulkTypes |
  ListTasksTypes |
  GetTaskTypes |
  GetNextTaskTypes |
  PeekNextTaskTypes |
  ListActiveAgentsTypes |
  CompleteTaskTypes |
  FailTaskTypes |
  ExtendLeaseTypes |
  HealthCheckTypes |
  ExtendTaskLeaseTypes |
  GetLeaseStatsTypes |
  CleanupExpiredLeasesTypes;

export type CommandDefinitions = AllCommandTypes['def'];
export type CommandNames = AllCommandTypes['name'] | AllCommandTypes['cliName'] | AllCommandTypes['mcpName'];
export type CommandBaseNames = AllCommandTypes['name'];
export type CommandCliNames = AllCommandTypes['cliName'];
export type CommandMcpNames = AllCommandTypes['mcpName'];

export type GenericCommandDefinition = CommandDefinition<readonly CommandParameter[], CommandResult<any>, CommandBaseNames>;

export type InferTypesFromName<T extends CommandNames> = AllCommandTypes & ({name: T } | {cliName: T} | {mcpName: T});
export type InferCommandFromName<T extends CommandNames> = InferTypesFromName<T>['def'];
export type InferReturnTypeFromCommandName<T extends CommandNames> = InferTypesFromName<T>['returnType'];
export type InferArgsFromCommandName<T extends CommandNames> = InferTypesFromName<T>['args'];
