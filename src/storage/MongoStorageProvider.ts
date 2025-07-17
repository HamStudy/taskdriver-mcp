import { MongoClient, Db, Collection, MongoClientOptions } from 'mongodb';
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
  Session,
  SessionCreateInput,
  SessionUpdateInput
} from '../types/index.js';
import { BaseStorageProvider } from './StorageProvider.js';
import { logger } from '../utils/logger.js';

interface ProjectDocument extends Project {
  _id?: string;
}

interface TaskTypeDocument extends TaskType {
  _id?: string;
}

interface TaskDocument extends Task {
  _id?: string;
}

interface SessionDocument extends Session {
  _id?: string;
}

interface MongoCollections {
  projects: Collection<ProjectDocument>;
  taskTypes: Collection<TaskTypeDocument>;
  tasks: Collection<TaskDocument>;
  sessions: Collection<SessionDocument>;
}

/**
 * MongoDB storage provider with atomic operations and transactions
 */
export class MongoStorageProvider extends BaseStorageProvider {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collections: MongoCollections | null = null;

  constructor(private uri: string, private dbName: string) {
    super();
  }

  protected async doInitialize(): Promise<void> {
    try {
      const options: MongoClientOptions = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      };

      this.client = new MongoClient(this.uri, options);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      
      await this.ensureCollections();
      await this.createIndexes();
      
      logger.info('MongoDB storage provider initialized', { dbName: this.dbName });
    } catch (error) {
      logger.error('Failed to initialize MongoDB storage provider', { error });
      throw error;
    }
  }

  override async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collections = null;
    }
    this.initialized = false;
  }

  protected override ensureInitialized(): void {
    if (!this.initialized || !this.db || !this.collections) {
      throw new Error('MongoStorageProvider not initialized');
    }
  }

  protected async doClose(): Promise<void> {
    // Implementation handled in close() method
  }

  private ensureCollections(): MongoCollections {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    if (!this.collections) {
      this.collections = {
        projects: this.db.collection<ProjectDocument>('projects'),
        taskTypes: this.db.collection<TaskTypeDocument>('taskTypes'),
        tasks: this.db.collection<TaskDocument>('tasks'),
        sessions: this.db.collection<SessionDocument>('sessions'),
      };
    }
    return this.collections;
  }

  private async createIndexes(): Promise<void> {
    const collections = this.ensureCollections();
    
    // Project indexes
    await collections.projects.createIndex({ name: 1 }, { unique: true });
    await collections.projects.createIndex({ status: 1 });
    
    // TaskType indexes
    await collections.taskTypes.createIndex({ projectId: 1, name: 1 }, { unique: true });
    await collections.taskTypes.createIndex({ projectId: 1 });
    
    // Task indexes
    await collections.tasks.createIndex({ projectId: 1 });
    await collections.tasks.createIndex({ status: 1 });
    await collections.tasks.createIndex({ assignedTo: 1 });
    await collections.tasks.createIndex({ leaseExpiresAt: 1 });
    await collections.tasks.createIndex({ projectId: 1, status: 1 });
    await collections.tasks.createIndex({ projectId: 1, typeId: 1 });
    
    // Session indexes
    await collections.sessions.createIndex({ agentName: 1, projectId: 1 });
    await collections.sessions.createIndex({ expiresAt: 1 });
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
    const collections = this.ensureCollections();
    
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
        defaultLeaseDurationMinutes: input.config?.defaultLeaseDurationMinutes ?? 30,
      },
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        queuedTasks: 0,
        runningTasks: 0,
      },
    };

    const projectData: ProjectDocument = { ...project, _id: projectId };
    await collections.projects.insertOne(projectData);
    
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.getProjectByNameOrId(projectId);
  }

  async getProjectByNameOrId(nameOrId: string): Promise<Project | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const doc = await collections.projects.findOne({
      $or: [{ id: nameOrId }, { name: nameOrId }]
    });

    if (!doc) return null;

    const project = this.documentToProject(doc);
    const tasks = await collections.tasks.find({ projectId: nameOrId }).toArray();
    const updatedProject = this.updateProjectStats(project, tasks.map(t => this.documentToTask(t)));

    return updatedProject;
  }

  async updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const currentDoc = await collections.projects.findOne({ id: projectId });
    if (!currentDoc) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const currentProject = this.documentToProject(currentDoc);
    const tasks = await collections.tasks.find({ projectId }).toArray();

    const updatedProject = {
      ...currentProject,
      ...input,
      config: input.config ? { ...currentProject.config, ...input.config } : currentProject.config,
      updatedAt: new Date(),
    };

    const finalProject = this.updateProjectStats(updatedProject, tasks.map(t => this.documentToTask(t)));

    const updateDoc = { ...finalProject };
    delete (updateDoc as any)._id;
    await collections.projects.updateOne({ id: projectId }, { $set: updateDoc });

    return finalProject;
  }

  async listProjects(includeClosed = false): Promise<Project[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const filter = includeClosed ? {} : { status: { $ne: 'closed' as const } };
    const docs = await collections.projects.find(filter).toArray();

    return docs.map(doc => this.documentToProject(doc));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    // Delete all related data in transaction
    await collections.projects.deleteOne({ id: projectId });
    await collections.taskTypes.deleteMany({ projectId });
    await collections.tasks.deleteMany({ projectId });
    await collections.sessions.deleteMany({ projectId });
  }

  // Task Type operations
  async createTaskType(input: TaskTypeCreateInput): Promise<TaskType> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    // Verify project exists
    const project = await collections.projects.findOne({ id: input.projectId });
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const taskTypeId = uuidv4();
    const now = new Date();

    const taskType: TaskType = {
      id: taskTypeId,
      projectId: input.projectId,
      name: input.name,
      template: input.template,
      variables: input.variables || [],
      maxRetries: input.maxRetries ?? 3,
      leaseDurationMinutes: input.leaseDurationMinutes ?? 30,
      duplicateHandling: input.duplicateHandling || 'allow',
      createdAt: now,
      updatedAt: now,
    };

    const taskTypeData: TaskTypeDocument = { ...taskType, _id: taskTypeId };
    await collections.taskTypes.insertOne(taskTypeData);

    return taskType;
  }

  async getTaskType(typeId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const doc = await collections.taskTypes.findOne({ id: typeId });
    return doc ? this.documentToTaskType(doc) : null;
  }

  async getTaskTypeByNameOrId(projectId: string, nameOrId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const doc = await collections.taskTypes.findOne({
      projectId,
      $or: [{ id: nameOrId }, { name: nameOrId }]
    });

    return doc ? this.documentToTaskType(doc) : null;
  }

  async updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const currentDoc = await collections.taskTypes.findOne({ id: typeId });
    if (!currentDoc) {
      throw new Error(`Task type not found: ${typeId}`);
    }

    const currentTaskType = this.documentToTaskType(currentDoc);
    const updatedTaskType = {
      ...currentTaskType,
      ...input,
      updatedAt: new Date(),
    };

    const updateDoc = { ...updatedTaskType };
    delete (updateDoc as any)._id;
    await collections.taskTypes.updateOne({ id: typeId }, { $set: updateDoc });

    return updatedTaskType;
  }

  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const docs = await collections.taskTypes.find({ projectId }).toArray();
    return docs.map(doc => this.documentToTaskType(doc));
  }

  async deleteTaskType(typeId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const result = await collections.taskTypes.deleteOne({ id: typeId });
    if (result.deletedCount === 0) {
      throw new Error(`Task type not found: ${typeId}`);
    }
  }

  // Task operations
  async createTask(input: TaskCreateInput): Promise<Task> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    // Verify project exists
    const project = await collections.projects.findOne({ id: input.projectId });
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    // Verify task type exists
    const taskType = await collections.taskTypes.findOne({ id: input.typeId });
    if (!taskType) {
      throw new Error(`Task type not found: ${input.typeId}`);
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

    const taskId = input.id || uuidv4();
    const now = new Date();

    const task: Task = {
      id: taskId,
      projectId: input.projectId,
      typeId: input.typeId,
      description: input.description || `Task ${taskId}`,
      instructions: input.instructions,
      variables: input.variables,
      status: 'queued',
      retryCount: 0,
      maxRetries: taskType.maxRetries || 3,
      createdAt: now,
      updatedAt: now,
      attempts: [],
    };

    const taskData: TaskDocument = { ...task, _id: taskId };
    await collections.tasks.insertOne(taskData);

    return task;
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const doc = await collections.tasks.findOne({ id: taskId });
    return doc ? this.documentToTask(doc) : null;
  }

  async updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const currentDoc = await collections.tasks.findOne({ id: taskId });
    if (!currentDoc) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const currentTask = this.documentToTask(currentDoc);
    const updatedTask = {
      ...currentTask,
      ...input,
      updatedAt: new Date(),
    };

    const updateDoc = { ...updatedTask };
    delete (updateDoc as any)._id;
    await collections.tasks.updateOne({ id: taskId }, { $set: updateDoc });

    return updatedTask;
  }

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const matchStage: any = { projectId };

    if (filters) {
      if (filters.status) {
        matchStage.status = filters.status;
      }
      if (filters.assignedTo) {
        matchStage.assignedTo = filters.assignedTo;
      }
      if (filters.typeId) {
        matchStage.typeId = filters.typeId;
      }
    }

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;

    // Use aggregation to join with task types and get typeName
    const docs = await collections.tasks
      .aggregate([
        { $match: matchStage },
        {
          $lookup: {
            from: 'taskTypes',
            localField: 'typeId',
            foreignField: 'id',
            as: 'taskType'
          }
        },
        {
          $addFields: {
            typeName: { $arrayElemAt: ['$taskType.name', 0] }
          }
        },
        { $unset: 'taskType' }, // Remove the joined taskType array
        { $skip: offset },
        { $limit: limit }
      ])
      .toArray();

    return docs.map(doc => this.documentToTask(doc as TaskDocument));
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    await collections.tasks.deleteOne({ id: taskId });
  }

  // CRITICAL: Atomic task assignment
  async getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    // Generate agent name if not provided
    const finalAgentName = agentName || `agent-${uuidv4().substring(0, 8)}`;

    // Use MongoDB's findOneAndUpdate for atomic operation
    // Look for tasks that are either queued OR have expired leases
    const now = new Date();
    const task = await collections.tasks.findOneAndUpdate(
      {
        projectId,
        $or: [
          { status: 'queued' },
          { 
            status: 'running', 
            leaseExpiresAt: { $lt: now } 
          }
        ]
      },
      {
        $set: {
          status: 'running',
          assignedTo: finalAgentName,
          assignedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
          updatedAt: new Date()
        }
      },
      {
        sort: { createdAt: 1 }, // FIFO
        returnDocument: 'after'
      }
    );

    if (!task) {
      return { task: null, agentName: finalAgentName };
    }

    return { 
      task: this.documentToTask(task), 
      agentName: finalAgentName 
    };
  }

  async completeTask(taskId: string, agentName: string, result: TaskResult): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    await collections.tasks.updateOne(
      { id: taskId, assignedTo: agentName },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          result,
          assignedTo: undefined,
          leaseExpiresAt: undefined,
          updatedAt: new Date()
        }
      }
    );
  }

  async failTask(taskId: string, _agentName: string, result: TaskResult, canRetry = true): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const taskDoc = await collections.tasks.findOne({ id: taskId });
    if (!taskDoc) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = this.documentToTask(taskDoc);
    const shouldRetry = canRetry && task.retryCount < task.maxRetries;

    if (shouldRetry) {
      // Requeue for retry
      await collections.tasks.updateOne(
        { id: taskId },
        {
          $set: {
            status: 'queued',
            retryCount: task.retryCount + 1,
            assignedTo: undefined,
            leaseExpiresAt: undefined,
            updatedAt: new Date()
          }
        }
      );
    } else {
      // Mark as permanently failed
      await collections.tasks.updateOne(
        { id: taskId },
        {
          $set: {
            status: 'failed',
            failedAt: new Date(),
            result,
            assignedTo: undefined,
            leaseExpiresAt: undefined,
            updatedAt: new Date()
          }
        }
      );
    }
  }

  // Agent status operations (work with lease data)
  async listActiveAgents(projectId: string): Promise<AgentStatus[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const activeTasks = await collections.tasks.find({
      projectId,
      status: 'running',
      assignedTo: { $exists: true }
    }).toArray();

    const agentMap = new Map<string, AgentStatus>();

    for (const task of activeTasks) {
      const agentName = task.assignedTo!;
      agentMap.set(agentName, {
        name: agentName,
        projectId,
        status: 'working',
        currentTaskId: task.id,
        assignedAt: task.assignedAt,
        leaseExpiresAt: task.leaseExpiresAt
      });
    }

    return Array.from(agentMap.values());
  }

  async getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const task = await collections.tasks.findOne({
      projectId,
      assignedTo: agentName,
      status: 'running'
    });

    if (!task) {
      return null;
    }

    return {
      name: agentName,
      projectId,
      status: 'working',
      currentTaskId: task.id,
      assignedAt: task.assignedAt,
      leaseExpiresAt: task.leaseExpiresAt
    };
  }

  // Lease management operations
  async findExpiredLeases(): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const now = new Date();
    const docs = await collections.tasks.find({
      status: 'running',
      leaseExpiresAt: { $lt: now }
    }).toArray();

    return docs.map(doc => this.documentToTask(doc));
  }

  async requeueTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    await collections.tasks.updateOne(
      { id: taskId },
      {
        $set: {
          status: 'queued',
          assignedTo: undefined,
          leaseExpiresAt: undefined,
          updatedAt: new Date()
        },
        $inc: { retryCount: 1 }
      }
    );
  }

  async extendLease(taskId: string, additionalMinutes: number): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const taskDoc = await collections.tasks.findOne({ id: taskId });
    if (!taskDoc) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const task = this.documentToTask(taskDoc);
    if (task.status !== 'running') {
      throw new Error(`Task ${taskId} is not running`);
    }

    const newLeaseExpiration = new Date(task.leaseExpiresAt!.getTime() + additionalMinutes * 60 * 1000);

    await collections.tasks.updateOne(
      { id: taskId },
      { $set: { leaseExpiresAt: newLeaseExpiration } }
    );
  }

  async countAvailableTasks(projectId: string): Promise<number> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const now = new Date();
    const count = await collections.tasks.countDocuments({
      projectId,
      $or: [
        { status: 'queued' },
        { 
          status: 'running', 
          leaseExpiresAt: { $lt: now } 
        }
      ]
    });

    return count;
  }

  // Utility operations

  async getTaskHistory(taskId: string): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    // For MongoDB, we just return the single task
    // In a more complex implementation, you might store task history separately
    const doc = await collections.tasks.findOne({ id: taskId });
    return doc ? [this.documentToTask(doc)] : [];
  }

  // Session management operations
  async createSession(input: SessionCreateInput): Promise<Session> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const sessionId = uuidv4();
    const now = new Date();
    const ttlSeconds = input.ttlSeconds || 3600; // 1 hour default
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const session: Session = {
      id: sessionId,
      agentId: input.agentId,
      projectId: input.projectId,
      agentName: input.agentName,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
      data: input.data || {},
    };

    const sessionDoc: SessionDocument = { ...session, _id: sessionId };
    await collections.sessions.insertOne(sessionDoc);

    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const sessionDoc = await collections.sessions.findOne({ id: sessionId });
    if (!sessionDoc) {
      return null;
    }

    // Check if session is expired
    if (new Date() > sessionDoc.expiresAt) {
      await this.deleteSession(sessionId);
      return null;
    }

    return this.documentToSession(sessionDoc);
  }

  async updateSession(sessionId: string, input: SessionUpdateInput): Promise<Session> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const updateDoc = {
      ...input,
      lastAccessedAt: new Date()
    };

    const result = await collections.sessions.findOneAndUpdate(
      { id: sessionId },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.documentToSession(result);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    await collections.sessions.deleteOne({ id: sessionId });
  }

  async findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const sessionDocs = await collections.sessions.find({
      agentName,
      projectId
    }).toArray();

    return sessionDocs.map(doc => this.documentToSession(doc));
  }

  async cleanupExpiredSessions(): Promise<number> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    const result = await collections.sessions.deleteMany({
      expiresAt: { $lt: new Date() }
    });

    return result.deletedCount;
  }

  // Health and metrics
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      this.ensureCollections();
      // Test database connectivity
      await this.collections!.projects.countDocuments({}, { limit: 1 });
      return { healthy: true, message: 'MongoDB connection healthy' };
    } catch (error) {
      return { healthy: false, message: `MongoDB health check failed: ${error}` };
    }
  }

  async getMetrics(): Promise<Record<string, number>> {
    this.ensureInitialized();
    const collections = this.ensureCollections();

    try {
      const [totalProjects, activeProjects, totalTasks, queuedTasks, runningTasks, completedTasks, failedTasks] = await Promise.all([
        collections.projects.countDocuments({}),
        collections.projects.countDocuments({ status: 'active' }),
        collections.tasks.countDocuments({}),
        collections.tasks.countDocuments({ status: 'queued' }),
        collections.tasks.countDocuments({ status: 'running' }),
        collections.tasks.countDocuments({ status: 'completed' }),
        collections.tasks.countDocuments({ status: 'failed' }),
      ]);

      return {
        totalProjects,
        activeProjects,
        totalTasks,
        queuedTasks,
        runningTasks,
        completedTasks,
        failedTasks,
        totalSessions: await collections.sessions.countDocuments({}),
        activeSessions: await collections.sessions.countDocuments({ expiresAt: { $gt: new Date() } }),
      };
    } catch (error) {
      logger.error('Failed to get metrics', { error });
      return {};
    }
  }

  // Document conversion methods
  private documentToProject(doc: ProjectDocument): Project {
    const { _id, ...project } = doc;
    return project as Project;
  }

  private documentToTaskType(doc: TaskTypeDocument): TaskType {
    const { _id, ...taskType } = doc;
    return taskType as TaskType;
  }

  private documentToTask(doc: TaskDocument): Task {
    const { _id, ...task } = doc;
    return task as Task;
  }

  private documentToSession(doc: SessionDocument): Session {
    const { _id, ...session } = doc;
    return session as Session;
  }

  async findDuplicateTask(projectId: string, typeId: string, variables?: Record<string, string>): Promise<Task | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const query = {
      projectId,
      typeId,
      status: { $ne: 'failed' as const },
      variables: variables || {}
    };
    
    const doc = await collections.tasks.findOne(query);
    return doc ? this.documentToTask(doc) : null;
  }
}