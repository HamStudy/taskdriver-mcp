import { createClient, RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { 
  Project, 
  ProjectCreateInput, 
  ProjectUpdateInput,
  Task, 
  TaskCreateInput, 
  TaskUpdateInput, 
  TaskFilters,
  TaskResult,
  TaskType, 
  TaskTypeCreateInput, 
  TaskTypeUpdateInput,
  TaskAssignmentResult,
  AgentStatus,
  TaskAttempt,
  Session,
  SessionCreateInput,
  SessionUpdateInput
} from '../types/index.js';
import { BaseStorageProvider } from './StorageProvider.js';
import { logger } from '../utils/logger.js';

/**
 * Redis storage provider for TaskDriver
 * Provides high-performance, distributed storage with atomic operations
 */
export class RedisStorageProvider extends BaseStorageProvider {
  private client: RedisClientType;
  private keyPrefix: string;

  constructor(connectionString: string, database: number = 0, keyPrefix: string = 'taskdriver:') {
    super();
    this.keyPrefix = keyPrefix;
    this.client = createClient({
      url: connectionString,
      database: database,
    });
  }

  protected async doInitialize(): Promise<void> {
    // Connect to Redis
    await this.client.connect();
    
    // Test connection
    await this.client.ping();
  }

  protected async doClose(): Promise<void> {
    await this.client.quit();
  }

  // Helper methods for key generation
  private projectKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}`;
  }

  private projectsSetKey(): string {
    return `${this.keyPrefix}projects`;
  }

  private taskTypeKey(typeId: string): string {
    return `${this.keyPrefix}tasktype:${typeId}`;
  }

  private taskTypesSetKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}:tasktypes`;
  }

  private taskKey(taskId: string): string {
    return `${this.keyPrefix}task:${taskId}`;
  }

  private tasksSetKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}:tasks`;
  }

  private queuedTasksKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}:queued`;
  }

  private runningTasksKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}:running`;
  }


  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}session:${sessionId}`;
  }

  private sessionAgentSetKey(agentId: string): string {
    return `${this.keyPrefix}session_agent:${agentId}`;
  }

  private sessionProjectSetKey(projectId: string): string {
    return `${this.keyPrefix}session_project:${projectId}`;
  }

  private updateProjectStats(project: Project, tasks: Task[]): Project {
    const stats = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      failedTasks: tasks.filter(t => t.status === 'failed').length,
      queuedTasks: tasks.filter(t => t.status === 'queued').length,
      runningTasks: tasks.filter(t => t.status === 'running').length,
    };
    
    return {
      ...project,
      stats,
      updatedAt: new Date(),
    };
  }

  // Project operations
  async createProject(input: ProjectCreateInput): Promise<Project> {
    this.ensureInitialized();
    
    const projectId = uuidv4();
    const now = new Date();
    
    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      config: {
        defaultMaxRetries: input.config?.defaultMaxRetries ?? 3,
        defaultLeaseDurationMinutes: input.config?.defaultLeaseDurationMinutes ?? 10,
      },
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        queuedTasks: 0,
        runningTasks: 0,
      },
    };

    // Store project data and add to projects set
    await Promise.all([
      this.client.hSet(this.projectKey(projectId), {
        data: JSON.stringify(project)
      }),
      this.client.sAdd(this.projectsSetKey(), projectId)
    ]);

    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    this.ensureInitialized();
    
    const projectData = await this.client.hGet(this.projectKey(projectId), 'data');
    if (!projectData) {
      return null;
    }

    const project: Project = JSON.parse(projectData);
    // Parse dates that were stringified
    project.createdAt = new Date(project.createdAt);
    project.updatedAt = new Date(project.updatedAt);
    
    // Update stats with current task counts
    const tasks = await this.listTasks(projectId);
    const updatedProject = this.updateProjectStats(project, tasks);
    
    // Update the project with current stats if they changed
    if (JSON.stringify(updatedProject.stats) !== JSON.stringify(project.stats)) {
      await this.client.hSet(this.projectKey(projectId), {
        data: JSON.stringify(updatedProject)
      });
    }
    
    return updatedProject;
  }

  async getProjectByNameOrId(nameOrId: string): Promise<Project | null> {
    this.ensureInitialized();
    
    // First try to get by ID
    const projectById = await this.getProject(nameOrId);
    if (projectById) {
      return projectById;
    }
    
    // If not found by ID, search by name
    const projectIds = await this.client.sMembers(this.projectsSetKey());
    
    for (const projectId of projectIds) {
      const project = await this.getProject(projectId);
      if (project && project.name === nameOrId) {
        return project;
      }
    }
    
    return null;
  }

  async updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
    this.ensureInitialized();
    
    const currentProject = await this.getProject(projectId);
    if (!currentProject) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    const tasks = await this.listTasks(projectId);
    
    const updatedProject: Project = {
      ...currentProject,
      ...input,
      config: input.config ? { ...currentProject.config, ...input.config } : currentProject.config,
      updatedAt: new Date(),
    };
    
    const finalProject = this.updateProjectStats(updatedProject, tasks);
    
    await this.client.hSet(this.projectKey(projectId), {
      data: JSON.stringify(finalProject)
    });
    
    return finalProject;
  }

  async listProjects(includeClosed: boolean = false): Promise<Project[]> {
    this.ensureInitialized();
    
    const projectIds = await this.client.sMembers(this.projectsSetKey());
    
    const projects: Project[] = [];
    for (const projectId of projectIds) {
      const project = await this.getProject(projectId);
      if (project && (includeClosed || project.status === 'active')) {
        projects.push(project);
      }
    }
    
    // Sort by creation date (newest first)
    return projects.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteProject(projectId: string): Promise<void> {
    this.ensureInitialized();
    
    await Promise.all([
      this.client.del(this.projectKey(projectId)),
      this.client.sRem(this.projectsSetKey(), projectId)
    ]);
  }

  // Task Type operations
  async createTaskType(input: TaskTypeCreateInput): Promise<TaskType> {
    this.ensureInitialized();
    
    const project = await this.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project ${input.projectId} not found`);
    }
    
    const now = new Date();
    const taskType: TaskType = {
      id: uuidv4(),
      name: input.name,
      projectId: input.projectId,
      template: input.template,
      variables: input.variables,
      duplicateHandling: input.duplicateHandling ?? 'allow',
      maxRetries: input.maxRetries ?? project.config.defaultMaxRetries,
      leaseDurationMinutes: input.leaseDurationMinutes ?? project.config.defaultLeaseDurationMinutes,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      this.client.hSet(this.taskTypeKey(taskType.id), {
        data: JSON.stringify(taskType)
      }),
      this.client.sAdd(this.taskTypesSetKey(input.projectId), taskType.id)
    ]);

    return taskType;
  }

  async getTaskType(typeId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    
    const taskTypeData = await this.client.hGet(this.taskTypeKey(typeId), 'data');
    if (!taskTypeData) {
      return null;
    }

    const taskType: TaskType = JSON.parse(taskTypeData);
    // Parse dates that were stringified
    taskType.createdAt = new Date(taskType.createdAt);
    taskType.updatedAt = new Date(taskType.updatedAt);

    return taskType;
  }

  async updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType> {
    this.ensureInitialized();
    
    const currentTaskType = await this.getTaskType(typeId);
    if (!currentTaskType) {
      throw new Error(`Task type ${typeId} not found`);
    }
    
    const updatedTaskType: TaskType = {
      ...currentTaskType,
      ...input,
      id: currentTaskType.id,
      projectId: currentTaskType.projectId,
      createdAt: currentTaskType.createdAt,
      updatedAt: new Date(),
    };
    
    await this.client.hSet(this.taskTypeKey(typeId), {
      data: JSON.stringify(updatedTaskType)
    });
    
    return updatedTaskType;
  }

  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    this.ensureInitialized();
    
    const taskTypeIds = await this.client.sMembers(this.taskTypesSetKey(projectId));
    
    const taskTypes: TaskType[] = [];
    for (const typeId of taskTypeIds) {
      const taskType = await this.getTaskType(typeId);
      if (taskType) {
        taskTypes.push(taskType);
      }
    }
    
    // Sort by creation date (newest first)
    return taskTypes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteTaskType(typeId: string): Promise<void> {
    this.ensureInitialized();
    
    const taskType = await this.getTaskType(typeId);
    if (!taskType) {
      throw new Error(`Task type ${typeId} not found`);
    }

    await Promise.all([
      this.client.del(this.taskTypeKey(typeId)),
      this.client.sRem(this.taskTypesSetKey(taskType.projectId), typeId)
    ]);
  }

  async getTaskTypeByNameOrId(projectNameOrId: string, nameOrId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    
    // First get the project
    const project = await this.getProjectByNameOrId(projectNameOrId);
    if (!project) {
      return null;
    }
    
    // First try to get by ID
    const taskTypeById = await this.getTaskType(nameOrId);
    if (taskTypeById && taskTypeById.projectId === project.id) {
      return taskTypeById;
    }
    
    // If not found by ID, search by name within the project
    const taskTypes = await this.listTaskTypes(project.id);
    
    for (const taskType of taskTypes) {
      if (taskType.name === nameOrId) {
        return taskType;
      }
    }
    
    return null;
  }

  // Task operations
  async createTask(input: TaskCreateInput): Promise<Task> {
    this.ensureInitialized();
    
    const taskType = await this.getTaskType(input.typeId);
    if (!taskType) {
      throw new Error(`Task type ${input.typeId} not found`);
    }

    // Check for duplicates if required
    if (taskType.duplicateHandling !== 'allow') {
      const existingTask = await this.findDuplicateTask(
        input.projectId, 
        input.typeId, 
        input.variables
      );

      if (existingTask) {
        if (taskType.duplicateHandling === 'fail') {
          throw new Error(`Duplicate task found for type ${taskType.name} with variables ${JSON.stringify(input.variables)}`);
        } else { // 'ignore'
          return existingTask;
        }
      }
    }

    // Generate or validate task ID
    let taskId: string;
    if (input.id) {
      // Check if custom ID already exists
      const existingTask = await this.client.hGet(this.taskKey(input.id), 'data');
      if (existingTask) {
        const task = JSON.parse(existingTask);
        if (task.projectId === input.projectId) {
          throw new Error(`Task with ID '${input.id}' already exists in this project`);
        }
      }
      taskId = input.id;
    } else {
      // Generate sequential ID like 'task-1', 'task-2', etc.
      let counter = 1;
      do {
        taskId = `task-${counter}`;
        counter++;
      } while (await this.client.hGet(this.taskKey(taskId), 'data'));
    }

    // Generate description if not provided
    const description = input.description || 
      (taskType.name ? `Task of type ${taskType.name}` : 'Default task type');

    const now = new Date();
    const task: Task = {
      id: taskId,
      projectId: input.projectId,
      typeId: input.typeId,
      description,
      instructions: input.instructions,
      variables: input.variables,
      status: 'queued',
      retryCount: 0,
      maxRetries: taskType.maxRetries,
      createdAt: now,
      attempts: [],
    };

    // Store task and add to appropriate sets
    await Promise.all([
      this.client.hSet(this.taskKey(task.id), {
        data: JSON.stringify(task)
      }),
      this.client.sAdd(this.tasksSetKey(input.projectId), task.id),
      this.client.lPush(this.queuedTasksKey(input.projectId), task.id) // FIFO queue
    ]);

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.ensureInitialized();
    
    const taskData = await this.client.hGet(this.taskKey(taskId), 'data');
    if (!taskData) {
      return null;
    }

    const task: Task = JSON.parse(taskData);
    // Parse dates that were stringified
    task.createdAt = new Date(task.createdAt);
    if (task.completedAt) task.completedAt = new Date(task.completedAt);
    if (task.failedAt) task.failedAt = new Date(task.failedAt);
    if (task.assignedAt) task.assignedAt = new Date(task.assignedAt);
    if (task.leaseExpiresAt) task.leaseExpiresAt = new Date(task.leaseExpiresAt);
    
    // Parse attempt dates
    if (task.attempts) {
      task.attempts = task.attempts.map(attempt => ({
        ...attempt,
        startedAt: new Date(attempt.startedAt),
        completedAt: attempt.completedAt ? new Date(attempt.completedAt) : undefined,
        leaseExpiresAt: attempt.leaseExpiresAt ? new Date(attempt.leaseExpiresAt) : new Date()
      }));
    }

    return task;
  }

  async updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
    this.ensureInitialized();
    
    const currentTask = await this.getTask(taskId);
    if (!currentTask) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const updatedTask: Task = {
      ...currentTask,
      ...input,
      id: currentTask.id,
      projectId: currentTask.projectId,
      typeId: currentTask.typeId,
      instructions: currentTask.instructions,
      createdAt: currentTask.createdAt,
      updatedAt: new Date(),
    };
    
    await this.client.hSet(this.taskKey(taskId), {
      data: JSON.stringify(updatedTask)
    });
    
    return updatedTask;
  }

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    this.ensureInitialized();
    
    const taskIds = await this.client.sMembers(this.tasksSetKey(projectId));
    
    let tasks: Task[] = [];
    
    // Get all task types for this project to create a lookup map
    const taskTypes = await this.listTaskTypes(projectId);
    const taskTypeMap = new Map<string, string>();
    for (const taskType of taskTypes) {
      taskTypeMap.set(taskType.id, taskType.name);
    }
    
    for (const taskId of taskIds) {
      const task = await this.getTask(taskId);
      if (task) {
        // Add typeName to the task
        const taskWithTypeName = {
          ...task,
          typeName: taskTypeMap.get(task.typeId)
        };
        tasks.push(taskWithTypeName);
      }
    }
    
    // Apply filters
    if (filters) {
      if (filters.status) {
        tasks = tasks.filter(t => t.status === filters.status);
      }
      if (filters.assignedTo) {
        tasks = tasks.filter(t => t.assignedTo === filters.assignedTo);
      }
      if (filters.typeId) {
        tasks = tasks.filter(t => t.typeId === filters.typeId);
      }
    }
    
    // Sort by creation date (newest first)
    tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    
    return tasks.slice(offset, offset + limit);
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    
    const task = await this.getTask(taskId);
    if (task) {
      await Promise.all([
        this.client.del(this.taskKey(taskId)),
        this.client.sRem(this.tasksSetKey(task.projectId), taskId),
        this.client.lRem(this.queuedTasksKey(task.projectId), 0, taskId),
        this.client.sRem(this.runningTasksKey(task.projectId), taskId)
      ]);
    }
  }

  // CRITICAL: Atomic task assignment using Redis Lua scripts
  async getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult> {
    this.ensureInitialized();
    
    logger.trace('Redis: Starting getNextTask', { projectId, agentName });
    
    // Check if agent already has a running task
    if (agentName) {
      const runningTaskIds = await this.client.sMembers(this.runningTasksKey(projectId));
      
      for (const taskId of runningTaskIds) {
        const task = await this.getTask(taskId);
        if (task && task.assignedTo === agentName) {
          logger.trace('Redis: Found existing task for agent', { taskId, agentName });
          return {
            task,
            agentName: agentName
          };
        }
      }
    }
    
    // Use Redis Lua script for atomic task assignment
    const queueKey = this.queuedTasksKey(projectId);
    const runningKey = this.runningTasksKey(projectId);
    
    // Lua script for atomic task assignment
    const luaScript = `
      local queueKey = KEYS[1]
      local runningKey = KEYS[2]
      
      -- Pop a task from the queue
      local taskId = redis.call('RPOP', queueKey)
      if not taskId then
        return nil
      end
      
      -- Add to running set
      redis.call('SADD', runningKey, taskId)
      
      return taskId
    `;
    
    const taskId = await this.client.eval(luaScript, {
      keys: [queueKey, runningKey],
      arguments: []
    }) as string | null;
    
    if (!taskId) {
      logger.trace('Redis: No tasks available in queue', { projectId });
      return {
        task: null,
        agentName: agentName || `agent-${Date.now()}`
      };
    }
    
    const task = await this.getTask(taskId);
    if (!task) {
      logger.trace('Redis: Task not found after dequeue', { taskId });
      return {
        task: null,
        agentName: agentName || `agent-${Date.now()}`
      };
    }
    
    // Get task type to determine lease duration
    const taskType = await this.getTaskType(task.typeId);
    if (!taskType) {
      throw new Error(`Task type ${task.typeId} not found`);
    }
    
    const now = new Date();
    const assignedAgentName = agentName || `agent-${Date.now()}`;
    const leaseExpiresAt = new Date(now.getTime() + taskType.leaseDurationMinutes * 60 * 1000);
    
    // Create attempt record
    const attempt: TaskAttempt = {
      id: uuidv4(),
      agentName: assignedAgentName,
      startedAt: now,
      status: 'running',
      leaseExpiresAt,
    };
    
    // Update task status
    const updatedTask: Task = {
      ...task,
      status: 'running',
      assignedTo: assignedAgentName,
      assignedAt: now,
      leaseExpiresAt,
      attempts: [...task.attempts, attempt]
    };
    
    // Update task
    await this.client.hSet(this.taskKey(taskId), {
      data: JSON.stringify(updatedTask)
    });
    
    logger.trace('Redis: Task assigned successfully', { taskId, agentName: assignedAgentName });
    
    return {
      task: updatedTask,
      agentName: assignedAgentName
    };
  }

  // Agent status operations (for monitoring/compatibility)
  // These work with the lease data, no persistent agent storage
  async listActiveAgents(projectId: string): Promise<AgentStatus[]> {
    this.ensureInitialized();
    
    const runningTaskIds = await this.client.sMembers(this.runningTasksKey(projectId));
    const agentMap = new Map<string, AgentStatus>();
    
    for (const taskId of runningTaskIds) {
      const task = await this.getTask(taskId);
      if (task?.assignedTo) {
        const agentName = task.assignedTo;
        
        if (!agentMap.has(agentName)) {
          agentMap.set(agentName, {
            name: agentName,
            projectId,
            status: 'working',
            currentTaskId: task.id,
            assignedAt: task.assignedAt || new Date(),
            leaseExpiresAt: task.leaseExpiresAt
          });
        }
      }
    }
    
    return Array.from(agentMap.values());
  }

  async getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null> {
    this.ensureInitialized();
    
    const runningTaskIds = await this.client.sMembers(this.runningTasksKey(projectId));
    
    for (const taskId of runningTaskIds) {
      const task = await this.getTask(taskId);
      if (task?.assignedTo === agentName) {
        return {
          name: agentName,
          projectId,
          status: 'working',
          currentTaskId: task.id,
          assignedAt: task.assignedAt || new Date(),
          leaseExpiresAt: task.leaseExpiresAt
        };
      }
    }
    
    return null;
  }

  async completeTask(taskId: string, _agentName: string, result: TaskResult): Promise<void> {
    this.ensureInitialized();
    
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const now = new Date();
    
    // Update the current attempt
    const updatedAttempts = [...task.attempts];
    if (updatedAttempts.length > 0) {
      const currentAttempt = updatedAttempts[updatedAttempts.length - 1];
      if (currentAttempt) {
        currentAttempt.completedAt = now;
        currentAttempt.status = 'completed';
        currentAttempt.result = result;
      }
    }
    
    // Update task status
    const updatedTask: Task = {
      ...task,
      status: 'completed',
      completedAt: now,
      result,
      attempts: updatedAttempts,
      assignedTo: undefined,
      leaseExpiresAt: undefined,
      assignedAt: undefined
    };
    
    await Promise.all([
      this.client.hSet(this.taskKey(taskId), {
        data: JSON.stringify(updatedTask)
      }),
      this.client.sRem(this.runningTasksKey(task.projectId), taskId)
    ]);
  }

  async failTask(taskId: string, _agentName: string, result: TaskResult, canRetry: boolean = true): Promise<void> {
    this.ensureInitialized();
    
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const now = new Date();
    
    // Update the current attempt
    const updatedAttempts = [...task.attempts];
    if (updatedAttempts.length > 0) {
      const currentAttempt = updatedAttempts[updatedAttempts.length - 1];
      if (currentAttempt) {
        currentAttempt.completedAt = now;
        currentAttempt.status = 'failed';
        currentAttempt.result = result;
      }
    }
    
    // Determine if we should retry - FIXED: use < instead of <=
    const newRetryCount = task.retryCount + 1;
    const shouldRetry = canRetry && newRetryCount < task.maxRetries;
    
    logger.trace('Redis: failTask retry logic', { 
      taskId, 
      newRetryCount, 
      maxRetries: task.maxRetries, 
      shouldRetry,
      canRetry 
    });
    
    const updatedTask: Task = {
      ...task,
      status: shouldRetry ? 'queued' : 'failed',
      retryCount: newRetryCount,
      attempts: updatedAttempts,
      assignedTo: undefined,
      leaseExpiresAt: undefined,
      assignedAt: undefined,
      failedAt: shouldRetry ? undefined : now,
      result: shouldRetry ? undefined : result
    };
    
    const operations = [
      this.client.hSet(this.taskKey(taskId), {
        data: JSON.stringify(updatedTask)
      }),
      this.client.sRem(this.runningTasksKey(task.projectId), taskId)
    ];
    
    // Re-queue if retrying
    if (shouldRetry) {
      operations.push(
        this.client.rPush(this.queuedTasksKey(task.projectId), taskId)
      );
    }
    
    await Promise.all(operations);
  }

  // Lease management operations
  async findExpiredLeases(): Promise<Task[]> {
    this.ensureInitialized();
    
    const now = new Date();
    const expiredTasks: Task[] = [];
    
    // Get all project IDs
    const projectIds = await this.client.sMembers(this.projectsSetKey());
    
    for (const projectId of projectIds) {
      const runningTaskIds = await this.client.sMembers(this.runningTasksKey(projectId));
      
      for (const taskId of runningTaskIds) {
        const task = await this.getTask(taskId);
        if (task && task.leaseExpiresAt && task.leaseExpiresAt < now) {
          expiredTasks.push(task);
        }
      }
    }
    
    return expiredTasks;
  }

  async requeueTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    
    const task = await this.getTask(taskId);
    if (!task) {
      return;
    }
    
    const updatedTask: Task = {
      ...task,
      status: 'queued',
      retryCount: task.retryCount + 1,
      assignedTo: undefined,
      leaseExpiresAt: undefined,
      assignedAt: undefined
    };
    
    await Promise.all([
      this.client.hSet(this.taskKey(taskId), {
        data: JSON.stringify(updatedTask)
      }),
      this.client.sRem(this.runningTasksKey(task.projectId), taskId),
      this.client.rPush(this.queuedTasksKey(task.projectId), taskId)
    ]);
  }

  async extendLease(taskId: string, additionalMinutes: number): Promise<void> {
    this.ensureInitialized();
    
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    if (!task.leaseExpiresAt) {
      throw new Error(`Task ${taskId} has no active lease`);
    }
    
    const newLeaseExpiresAt = new Date(task.leaseExpiresAt.getTime() + additionalMinutes * 60 * 1000);
    
    const updatedTask: Task = {
      ...task,
      leaseExpiresAt: newLeaseExpiresAt
    };
    
    await this.client.hSet(this.taskKey(taskId), {
      data: JSON.stringify(updatedTask)
    });
  }

  async countAvailableTasks(projectId: string): Promise<number> {
    this.ensureInitialized();
    
    const tasks = await this.listTasks(projectId);
    const now = new Date();
    
    return tasks.filter(task => 
      task.status === 'queued' || 
      (task.status === 'running' && task.leaseExpiresAt && task.leaseExpiresAt < now)
    ).length;
  }

  // Utility operations
  async findDuplicateTask(projectId: string, typeId: string, variables?: Record<string, string>): Promise<Task | null> {
    this.ensureInitialized();
    
    const tasks = await this.listTasks(projectId, { typeId });
    
    for (const task of tasks) {
      if (task.status !== 'failed' && 
          JSON.stringify(task.variables || {}) === JSON.stringify(variables || {})) {
        return task;
      }
    }
    
    return null;
  }

  async getTaskHistory(taskId: string): Promise<Task[]> {
    this.ensureInitialized();
    
    // For Redis, we'll just return the current task
    // In a full implementation, you might store task history separately
    const task = await this.getTask(taskId);
    return task ? [task] : [];
  }

  // Health and metrics
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      this.ensureInitialized();
      
      // Simple ping to check connectivity
      const response = await this.client.ping();
      
      if (response === 'PONG') {
        return { healthy: true, message: 'Redis connection is healthy' };
      } else {
        return { healthy: false, message: 'Redis ping failed' };
      }
    } catch (error) {
      return { 
        healthy: false, 
        message: `Redis health check failed: ${error}` 
      };
    }
  }

  async getMetrics(): Promise<Record<string, number>> {
    this.ensureInitialized();
    
    try {
      const projectIds = await this.client.sMembers(this.projectsSetKey());
      
      let totalProjects = projectIds.length;
      let activeProjects = 0;
      let totalTasks = 0;
      let queuedTasks = 0;
      let runningTasks = 0;
      let completedTasks = 0;
      let failedTasks = 0;
      let totalAgents = 0;
      let activeAgents = 0;
      
      for (const projectId of projectIds) {
        const project = await this.getProject(projectId);
        if (project?.status === 'active') {
          activeProjects++;
        }
        
        const tasks = await this.listTasks(projectId);
        totalTasks += tasks.length;
        queuedTasks += tasks.filter(t => t.status === 'queued').length;
        runningTasks += tasks.filter(t => t.status === 'running').length;
        completedTasks += tasks.filter(t => t.status === 'completed').length;
        failedTasks += tasks.filter(t => t.status === 'failed').length;
        
        // Use lease-based agent counting instead of persistent agents
        const activeAgentStatuses = await this.listActiveAgents(projectId);
        const currentActiveAgents = activeAgentStatuses.length;
        totalAgents += currentActiveAgents;
        activeAgents += currentActiveAgents;
      }
      
      return {
        totalProjects,
        activeProjects,
        totalTasks,
        queuedTasks,
        runningTasks,
        completedTasks,
        failedTasks,
        totalAgents,
        activeAgents
      };
    } catch (error) {
      return {};
    }
  }

  // Session management operations
  async createSession(input: SessionCreateInput): Promise<Session> {
    this.ensureInitialized();
    
    const sessionId = uuidv4();
    const now = new Date();
    const ttlSeconds = input.ttlSeconds || 3600; // Default 1 hour
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    
    const session: Session = {
      id: sessionId,
      agentId: input.agentId,
      projectId: input.projectId,
      agentName: input.agentName,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
      data: input.data || {}
    };

    const sessionKey = this.sessionKey(sessionId);
    await this.client.setEx(sessionKey, ttlSeconds, JSON.stringify(session));
    
    // Add to session indexes for efficient cleanup
    if (input.agentId) {
      await this.client.sAdd(this.sessionAgentSetKey(input.agentId), sessionId);
    }
    if (input.projectId) {
      await this.client.sAdd(this.sessionProjectSetKey(input.projectId), sessionId);
    }
    
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureInitialized();
    
    const sessionKey = this.sessionKey(sessionId);
    const sessionData = await this.client.get(sessionKey);
    
    if (!sessionData) {
      return null;
    }

    try {
      const session: Session = JSON.parse(sessionData);
      
      // Check if session is expired (redundant with Redis TTL, but good practice)
      if (new Date() > new Date(session.expiresAt)) {
        await this.deleteSession(sessionId);
        return null;
      }
      
      return session;
    } catch (error) {
      await this.deleteSession(sessionId);
      return null;
    }
  }

  async updateSession(sessionId: string, input: SessionUpdateInput): Promise<Session> {
    this.ensureInitialized();
    
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedSession: Session = {
      ...session,
      lastAccessedAt: input.lastAccessedAt || new Date(),
      expiresAt: input.expiresAt || session.expiresAt,
      data: input.data !== undefined ? input.data : session.data
    };

    // Calculate new TTL
    const now = new Date();
    const ttlSeconds = Math.max(0, Math.floor((new Date(updatedSession.expiresAt).getTime() - now.getTime()) / 1000));
    
    const sessionKey = this.sessionKey(sessionId);
    await this.client.setEx(sessionKey, ttlSeconds, JSON.stringify(updatedSession));
    
    return updatedSession;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    
    // Get session first to clean up indexes
    const session = await this.getSession(sessionId);
    
    const sessionKey = this.sessionKey(sessionId);
    await this.client.del(sessionKey);
    
    // Clean up indexes
    if (session?.agentId) {
      await this.client.sRem(this.sessionAgentSetKey(session.agentId), sessionId);
    }
    if (session?.projectId) {
      await this.client.sRem(this.sessionProjectSetKey(session.projectId), sessionId);
    }
  }

  async findSessionsByAgent(agentName: string, _projectId: string): Promise<Session[]> {
    this.ensureInitialized();
    
    // For Redis implementation, we'll search through project sessions
    // This could be optimized with better indexing if needed
    const projectIds = await this.client.sMembers(this.projectsSetKey());
    const sessions: Session[] = [];

    for (const projectId of projectIds) {
      const sessionIds = await this.client.sMembers(this.sessionProjectSetKey(projectId));
      
      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session && session.agentName === agentName && session.projectId === _projectId) {
          sessions.push(session);
        }
      }
    }

    return sessions;
  }

  async cleanupExpiredSessions(): Promise<number> {
    this.ensureInitialized();
    
    // Redis automatically expires sessions with TTL, so we mainly need to clean up indexes
    // This is a more complex operation that would require scanning all session keys
    // For now, return 0 as Redis handles expiration automatically
    return 0;
  }

}