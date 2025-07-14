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
  TaskInput,
  TaskType, 
  TaskTypeCreateInput, 
  TaskTypeUpdateInput,
  Agent, 
  AgentCreateInput, 
  AgentUpdateInput,
  TaskAttempt,
  Session,
  SessionCreateInput,
  SessionUpdateInput
} from '../types/index.js';
import { BaseStorageProvider } from './StorageProvider.js';

/**
 * Redis storage provider for TaskDriver
 * Provides high-performance, distributed storage with atomic operations
 */
export class RedisStorageProvider extends BaseStorageProvider {
  private client: RedisClientType;
  private connectionString: string;
  private keyPrefix: string;
  private database: number;

  constructor(connectionString: string, database: number = 0, keyPrefix: string = 'taskdriver:') {
    super();
    this.connectionString = connectionString;
    this.database = database;
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

  private agentKey(agentId: string): string {
    return `${this.keyPrefix}agent:${agentId}`;
  }

  private agentsSetKey(projectId: string): string {
    return `${this.keyPrefix}project:${projectId}:agents`;
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
        reaperIntervalMinutes: input.config?.reaperIntervalMinutes ?? 1,
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
    for (const taskId of taskIds) {
      const task = await this.getTask(taskId);
      if (task) {
        tasks.push(task);
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

  // CRITICAL: Atomic task assignment using Redis transactions
  async assignTask(projectId: string, agentName: string): Promise<Task | null> {
    this.ensureInitialized();
    
    // Use Redis WATCH for optimistic concurrency control
    const queueKey = this.queuedTasksKey(projectId);
    const runningKey = this.runningTasksKey(projectId);
    
    // Pop a task from the queue atomically
    const taskId = await this.client.rPop(queueKey);
    if (!taskId) {
      return null; // No tasks available
    }
    
    const task = await this.getTask(taskId);
    if (!task) {
      return null; // Task was deleted
    }
    
    // Get task type to determine lease duration
    const taskType = await this.getTaskType(task.typeId);
    if (!taskType) {
      throw new Error(`Task type ${task.typeId} not found`);
    }
    
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + taskType.leaseDurationMinutes * 60 * 1000);
    
    // Create attempt record
    const attempt: TaskAttempt = {
      id: uuidv4(),
      agentName,
      startedAt: now,
      status: 'running',
      leaseExpiresAt,
    };
    
    // Update task status
    const updatedTask: Task = {
      ...task,
      status: 'running',
      assignedTo: agentName,
      assignedAt: now,
      leaseExpiresAt,
      attempts: [...task.attempts, attempt]
    };
    
    // Update task and add to running set
    await Promise.all([
      this.client.hSet(this.taskKey(taskId), {
        data: JSON.stringify(updatedTask)
      }),
      this.client.sAdd(runningKey, taskId)
    ]);
    
    return updatedTask;
  }

  // Agent operations
  async createAgent(input: AgentCreateInput): Promise<Agent> {
    this.ensureInitialized();
    
    const now = new Date();
    const agent: Agent = {
      id: uuidv4(),
      name: input.name || `agent-${Date.now()}`,
      projectId: input.projectId,
      status: 'idle',
      apiKeyHash: input.apiKeyHash || '',
      capabilities: input.capabilities || [],
      createdAt: now,
      lastSeen: now,
    };

    await Promise.all([
      this.client.hSet(this.agentKey(agent.id), {
        data: JSON.stringify(agent)
      }),
      this.client.sAdd(this.agentsSetKey(input.projectId), agent.id)
    ]);

    return agent;
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    const agentData = await this.client.hGet(this.agentKey(agentId), 'data');
    if (!agentData) {
      return null;
    }

    const agent: Agent = JSON.parse(agentData);
    // Parse dates
    agent.createdAt = new Date(agent.createdAt);
    agent.lastSeen = new Date(agent.lastSeen);

    return agent;
  }

  async getAgentByName(agentName: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    const agentIds = await this.client.sMembers(this.agentsSetKey(projectId));
    
    for (const agentId of agentIds) {
      const agent = await this.getAgent(agentId);
      if (agent && agent.name === agentName) {
        return agent;
      }
    }
    
    return null;
  }

  async getAgentByApiKey(hashedApiKey: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    const agentIds = await this.client.sMembers(this.agentsSetKey(projectId));
    
    for (const agentId of agentIds) {
      const agent = await this.getAgent(agentId);
      if (agent && agent.apiKeyHash === hashedApiKey) {
        return agent;
      }
    }
    
    return null;
  }

  async updateAgent(agentId: string, input: AgentUpdateInput): Promise<Agent> {
    this.ensureInitialized();
    
    const currentAgent = await this.getAgent(agentId);
    if (!currentAgent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const updatedAgent: Agent = {
      ...currentAgent,
      ...input,
      id: currentAgent.id,
      projectId: currentAgent.projectId,
      createdAt: currentAgent.createdAt,
    };
    
    await this.client.hSet(this.agentKey(agentId), {
      data: JSON.stringify(updatedAgent)
    });
    
    return updatedAgent;
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    this.ensureInitialized();
    
    const agentIds = await this.client.sMembers(this.agentsSetKey(projectId));
    
    const agents: Agent[] = [];
    for (const agentId of agentIds) {
      const agent = await this.getAgent(agentId);
      if (agent) {
        agents.push(agent);
      }
    }
    
    // Sort by creation date (newest first)
    return agents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    await Promise.all([
      this.client.del(this.agentKey(agentId)),
      this.client.sRem(this.agentsSetKey(agent.projectId), agentId)
    ]);
  }

  async completeTask(taskId: string, result: TaskResult): Promise<void> {
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

  async failTask(taskId: string, result: TaskResult, canRetry: boolean = true): Promise<void> {
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
    
    // Determine if we should retry
    const shouldRetry = canRetry && task.retryCount < task.maxRetries;
    const newRetryCount = task.retryCount + 1;
    
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
        
        const agents = await this.listAgents(projectId);
        totalAgents += agents.length;
        activeAgents += agents.filter(a => a.status === 'idle' || a.status === 'working').length;
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

  async findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]> {
    this.ensureInitialized();
    
    // Use the agent index to find sessions
    const agent = await this.getAgentByName(agentName, projectId);
    if (!agent) {
      return [];
    }

    const sessionIds = await this.client.sMembers(this.sessionAgentSetKey(agent.id));
    const sessions: Session[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.projectId === projectId) {
        sessions.push(session);
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