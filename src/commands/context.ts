/**
 * Service context creation for command handlers
 */

import { StorageProvider } from '../storage/StorageProvider.js';
import { ProjectService } from '../services/ProjectService.js';
import { TaskService } from '../services/TaskService.js';
import { TaskTypeService } from '../services/TaskTypeService.js';
import { AgentService } from '../services/AgentService.js';
import { LeaseService } from '../services/LeaseService.js';
import { ServiceContext } from './types.js';

/**
 * Create service context from storage provider
 */
export function createServiceContext(storage: StorageProvider): ServiceContext {
  const project = new ProjectService(storage);
  const taskType = new TaskTypeService(storage, project);
  const task = new TaskService(storage, project, taskType);
  const agent = new AgentService(storage, project, task);
  const lease = new LeaseService(storage);

  return {
    storage,
    project,
    task,
    taskType,
    agent,
    lease
  };
}