import { 
  MongoClient, 
  Db, 
  Collection, 
  ClientSession,
  MongoServerError,
  OptionalUnlessRequiredId,
  Document
} from 'mongodb';
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
  BatchStatus,
  BatchCreateResult,
  TaskAttempt,
  Session,
  SessionCreateInput,
  SessionUpdateInput
} from '../types/index.js';
import { BaseStorageProvider } from './StorageProvider.js';

// MongoDB document interfaces
interface ProjectDocument extends Omit<Project, 'id'> {
  _id: string;
}

interface TaskTypeDocument extends Omit<TaskType, 'id'> {
  _id: string;
}

interface TaskDocument extends Omit<Task, 'id'> {
  _id: string;
}

interface AgentDocument extends Omit<Agent, 'id'> {
  _id: string;
}

/**
 * MongoDB storage provider for TaskDriver
 * Provides distributed, high-performance storage with atomic operations
 */
export class MongoStorageProvider extends BaseStorageProvider {
  private client: MongoClient;
  private db: Db | null = null;
  private collections: {
    projects: Collection<ProjectDocument>;
    taskTypes: Collection<TaskTypeDocument>;
    tasks: Collection<TaskDocument>;
    agents: Collection<AgentDocument>;
    sessions: Collection<any>;
  } | null = null;
  
  private connectionString: string;
  private databaseName: string;
  private useTransactions: boolean;

  constructor(connectionString: string, databaseName: string = 'taskdriver', useTransactions: boolean = true) {
    super();
    this.connectionString = connectionString;
    this.databaseName = databaseName;
    this.useTransactions = useTransactions;
    this.client = new MongoClient(connectionString);
  }

  protected async doInitialize(): Promise<void> {
    // Connect to MongoDB
    await this.client.connect();
    this.db = this.client.db(this.databaseName);
    
    // Get collections
    this.collections = {
      projects: this.db.collection<ProjectDocument>('projects'),
      taskTypes: this.db.collection<TaskTypeDocument>('taskTypes'),
      tasks: this.db.collection<TaskDocument>('tasks'),
      agents: this.db.collection<AgentDocument>('agents'),
      sessions: this.db.collection('sessions')
    };

    // Create indexes for performance
    await this.createIndexes();
  }

  protected async doClose(): Promise<void> {
    await this.client.close();
    this.db = null;
    this.collections = null;
  }

  private async createIndexes(): Promise<void> {
    if (!this.collections) {
      throw new Error('Collections not initialized');
    }

    // Project indexes
    await this.collections.projects.createIndex({ status: 1 });
    await this.collections.projects.createIndex({ createdAt: -1 });

    // Task type indexes
    await this.collections.taskTypes.createIndex({ projectId: 1 });
    await this.collections.taskTypes.createIndex({ projectId: 1, name: 1 }, { unique: true });

    // Task indexes
    await this.collections.tasks.createIndex({ projectId: 1 });
    await this.collections.tasks.createIndex({ status: 1 });
    await this.collections.tasks.createIndex({ typeId: 1 });
    await this.collections.tasks.createIndex({ assignedTo: 1 });
    await this.collections.tasks.createIndex({ batchId: 1 });
    await this.collections.tasks.createIndex({ leaseExpiresAt: 1 });
    await this.collections.tasks.createIndex({ createdAt: -1 });
    // Compound index for task assignment (critical for performance)
    await this.collections.tasks.createIndex({ 
      projectId: 1, 
      status: 1, 
      createdAt: 1 
    });

    // Agent indexes
    await this.collections.agents.createIndex({ projectId: 1 });
    await this.collections.agents.createIndex({ projectId: 1, name: 1 });
    await this.collections.agents.createIndex({ projectId: 1, apiKeyHash: 1 });
    await this.collections.agents.createIndex({ status: 1 });

    // Session indexes for optimization and TTL
    await this.collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.collections.sessions.createIndex({ agentId: 1 });
    await this.collections.sessions.createIndex({ projectId: 1 });
  }

  private ensureCollections(): {
    projects: Collection<ProjectDocument>;
    taskTypes: Collection<TaskTypeDocument>;
    tasks: Collection<TaskDocument>;
    agents: Collection<AgentDocument>;
    sessions: Collection<any>;
  } {
    if (!this.collections) {
      throw new Error('Storage provider not initialized');
    }
    return this.collections;
  }

  // Helper methods for document conversion
  private projectFromDocument(doc: ProjectDocument): Project {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }

  private taskTypeFromDocument(doc: TaskTypeDocument): TaskType {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }

  private taskFromDocument(doc: TaskDocument): Task {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
  }

  private agentFromDocument(doc: AgentDocument): Agent {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
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

    const { id, ...projectData } = project;
    const doc: OptionalUnlessRequiredId<ProjectDocument> = {
      _id: projectId,
      ...projectData
    };

    await collections.projects.insertOne(doc);
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.projects.findOne({ _id: projectId });
    if (!doc) {
      return null;
    }

    const project = this.projectFromDocument(doc);
    
    // Update stats with current task counts
    const tasks = await this.listTasks(projectId);
    const updatedProject = this.updateProjectStats(project, tasks);
    
    // Update the project with current stats if they changed
    if (JSON.stringify(updatedProject.stats) !== JSON.stringify(project.stats)) {
      await collections.projects.updateOne(
        { _id: projectId },
        { 
          $set: { 
            stats: updatedProject.stats,
            updatedAt: updatedProject.updatedAt
          }
        }
      );
    }
    
    return updatedProject;
  }

  async updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    // Simple non-transactional update for compatibility
    const currentDoc = await collections.projects.findOne({ _id: projectId });
    if (!currentDoc) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    const currentProject = this.projectFromDocument(currentDoc);
    const tasks = await this.listTasks(projectId);
    
    const updatedProject: Project = {
      ...currentProject,
      ...input,
      config: input.config ? { ...currentProject.config, ...input.config } : currentProject.config,
      updatedAt: new Date(),
    };
    
    const finalProject = this.updateProjectStats(updatedProject, tasks);
    
    const { id, ...updateDoc } = finalProject;
    await collections.projects.replaceOne({ _id: projectId }, updateDoc);
    
    return finalProject;
  }

  async listProjects(includeClosed: boolean = false): Promise<Project[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const filter = includeClosed ? {} : { status: 'active' as const };
    const docs = await collections.projects
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();
    
    return docs.map(doc => this.projectFromDocument(doc));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    await collections.projects.deleteOne({ _id: projectId });
  }

  // Task Type operations
  async createTaskType(input: TaskTypeCreateInput): Promise<TaskType> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    if (!this.useTransactions) {
      // Non-transactional version for testing
      const projectDoc = await collections.projects.findOne({ _id: input.projectId });
      if (!projectDoc) {
        throw new Error(`Project ${input.projectId} not found`);
      }
      
      const project = this.projectFromDocument(projectDoc);
      
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

      const { id, ...taskTypeData } = taskType;
      const doc: OptionalUnlessRequiredId<TaskTypeDocument> = {
        _id: taskType.id,
        ...taskTypeData
      };

      await collections.taskTypes.insertOne(doc);
      return taskType;
    }
    
    const session = this.client.startSession();
    
    try {
      let result: TaskType;
      
      await session.withTransaction(async () => {
        // Get project to inherit defaults
        const projectDoc = await collections.projects.findOne({ _id: input.projectId }, { session });
        if (!projectDoc) {
          throw new Error(`Project ${input.projectId} not found`);
        }
        
        const project = this.projectFromDocument(projectDoc);
        
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

        const { id, ...taskTypeData } = taskType;
        const doc: OptionalUnlessRequiredId<TaskTypeDocument> = {
          _id: taskType.id,
          ...taskTypeData
        };

        await collections.taskTypes.insertOne(doc, { session });
        result = taskType;
      });
      
      return result!;
    } finally {
      await session.endSession();
    }
  }

  async getTaskType(typeId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.taskTypes.findOne({ _id: typeId });
    return doc ? this.taskTypeFromDocument(doc) : null;
  }

  async updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const currentDoc = await collections.taskTypes.findOne({ _id: typeId });
    if (!currentDoc) {
      throw new Error(`Task type ${typeId} not found`);
    }
    
    const currentTaskType = this.taskTypeFromDocument(currentDoc);
    const updatedTaskType: TaskType = {
      ...currentTaskType,
      ...input,
      id: currentTaskType.id,
      projectId: currentTaskType.projectId,
      createdAt: currentTaskType.createdAt,
      updatedAt: new Date(),
    };
    
    const { id, ...updateDoc } = updatedTaskType;
    await collections.taskTypes.replaceOne({ _id: typeId }, updateDoc);
    
    return updatedTaskType;
  }

  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const docs = await collections.taskTypes
      .find({ projectId })
      .sort({ createdAt: -1 })
      .toArray();
    
    return docs.map(doc => this.taskTypeFromDocument(doc));
  }

  async deleteTaskType(typeId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const result = await collections.taskTypes.deleteOne({ _id: typeId });
    if (result.deletedCount === 0) {
      throw new Error(`Task type ${typeId} not found`);
    }
  }

  // Task operations
  async createTask(input: TaskCreateInput): Promise<Task> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    if (!this.useTransactions) {
      // Non-transactional version for testing
      const taskTypeDoc = await collections.taskTypes.findOne({ _id: input.typeId });
      if (!taskTypeDoc) {
        throw new Error(`Task type ${input.typeId} not found`);
      }
      
      const taskType = this.taskTypeFromDocument(taskTypeDoc);

      // Check for duplicates if required
      if (taskType.duplicateHandling !== 'allow') {
        const duplicateDoc = await collections.tasks.findOne({
          typeId: input.typeId,
          status: { $ne: 'failed' },
          variables: input.variables || {}
        });

        if (duplicateDoc) {
          if (taskType.duplicateHandling === 'fail') {
            throw new Error(`Duplicate task found for type ${taskType.name} with variables ${JSON.stringify(input.variables)}`);
          } else { // 'ignore'
            return this.taskFromDocument(duplicateDoc);
          }
        }
      }

      const now = new Date();
      const task: Task = {
        id: uuidv4(),
        projectId: input.projectId,
        typeId: input.typeId,
        instructions: input.instructions,
        variables: input.variables,
        status: 'queued',
        retryCount: 0,
        maxRetries: taskType.maxRetries,
        batchId: input.batchId,
        createdAt: now,
        attempts: [],
      };

      const { id, ...taskData } = task;
      const doc: OptionalUnlessRequiredId<TaskDocument> = {
        _id: task.id,
        ...taskData
      };

      await collections.tasks.insertOne(doc);
      return task;
    }
    
    const session = this.client.startSession();
    
    try {
      let result: Task;
      
      await session.withTransaction(async () => {
        // Get task type to check duplicate handling and get defaults
        const taskTypeDoc = await collections.taskTypes.findOne({ _id: input.typeId }, { session });
        if (!taskTypeDoc) {
          throw new Error(`Task type ${input.typeId} not found`);
        }
        
        const taskType = this.taskTypeFromDocument(taskTypeDoc);

        // Check for duplicates if required
        if (taskType.duplicateHandling !== 'allow') {
          const duplicateDoc = await collections.tasks.findOne({
            typeId: input.typeId,
            status: { $ne: 'failed' },
            variables: input.variables || {}
          }, { session });

          if (duplicateDoc) {
            if (taskType.duplicateHandling === 'fail') {
              throw new Error(`Duplicate task found for type ${taskType.name} with variables ${JSON.stringify(input.variables)}`);
            } else { // 'ignore'
              result = this.taskFromDocument(duplicateDoc);
              return;
            }
          }
        }

        const now = new Date();
        const task: Task = {
          id: uuidv4(),
          projectId: input.projectId,
          typeId: input.typeId,
          instructions: input.instructions,
          variables: input.variables,
          status: 'queued',
          retryCount: 0,
          maxRetries: taskType.maxRetries,
          batchId: input.batchId,
          createdAt: now,
          attempts: [],
        };

        const { id, ...taskData } = task;
        const doc: OptionalUnlessRequiredId<TaskDocument> = {
          _id: task.id,
          ...taskData
        };

        await collections.tasks.insertOne(doc, { session });
        result = task;
      });
      
      return result!;
    } finally {
      await session.endSession();
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.tasks.findOne({ _id: taskId });
    return doc ? this.taskFromDocument(doc) : null;
  }

  async updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const currentDoc = await collections.tasks.findOne({ _id: taskId });
    if (!currentDoc) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const currentTask = this.taskFromDocument(currentDoc);
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
    
    const { id, ...updateDoc } = updatedTask;
    await collections.tasks.replaceOne({ _id: taskId }, updateDoc);
    
    return updatedTask;
  }

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const query: Document = { projectId };
    
    // Apply filters
    if (filters) {
      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.assignedTo) {
        query.assignedTo = filters.assignedTo;
      }
      if (filters.batchId) {
        query.batchId = filters.batchId;
      }
      if (filters.typeId) {
        query.typeId = filters.typeId;
      }
    }
    
    // Apply pagination
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    
    const docs = await collections.tasks
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    
    return docs.map(doc => this.taskFromDocument(doc));
  }

  async deleteTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    await collections.tasks.deleteOne({ _id: taskId });
  }

  // CRITICAL: Atomic task assignment using MongoDB transactions
  async assignTask(projectId: string, agentName: string): Promise<Task | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    if (!this.useTransactions) {
      // Non-transactional version for testing (note: not truly atomic)
      const taskDoc = await collections.tasks.findOneAndUpdate(
        {
          projectId,
          status: 'queued'
        },
        {
          $set: {
            status: 'running',
            assignedTo: agentName,
            assignedAt: new Date()
          }
        },
        {
          sort: { createdAt: 1 }, // FIFO
          returnDocument: 'after'
        }
      );
      
      if (!taskDoc) {
        return null; // No tasks available
      }
      
      const task = this.taskFromDocument(taskDoc);
      
      // Get task type to determine lease duration
      const taskTypeDoc = await collections.taskTypes.findOne({ _id: task.typeId });
      if (!taskTypeDoc) {
        throw new Error(`Task type ${task.typeId} not found`);
      }
      
      const taskType = this.taskTypeFromDocument(taskTypeDoc);
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
      
      // Update task with lease and attempt
      const updatedDoc = await collections.tasks.findOneAndUpdate(
        { _id: task.id },
        {
          $set: {
            leaseExpiresAt,
          },
          $push: {
            attempts: attempt
          }
        },
        {
          returnDocument: 'after'
        }
      );
      
      return updatedDoc ? this.taskFromDocument(updatedDoc) : null;
    }
    
    const session = this.client.startSession();
    
    try {
      let result: Task | null = null;
      
      await session.withTransaction(async () => {
        // Find and update the first queued task atomically
        const taskDoc = await collections.tasks.findOneAndUpdate(
          {
            projectId,
            status: 'queued'
          },
          {
            $set: {
              status: 'running',
              assignedTo: agentName,
              assignedAt: new Date()
            }
          },
          {
            sort: { createdAt: 1 }, // FIFO
            returnDocument: 'after',
            session
          }
        );
        
        if (!taskDoc) {
          return; // No tasks available
        }
        
        const task = this.taskFromDocument(taskDoc);
        
        // Get task type to determine lease duration
        const taskTypeDoc = await collections.taskTypes.findOne({ _id: task.typeId }, { session });
        if (!taskTypeDoc) {
          throw new Error(`Task type ${task.typeId} not found`);
        }
        
        const taskType = this.taskTypeFromDocument(taskTypeDoc);
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
        
        // Update task with lease and attempt
        const updatedDoc = await collections.tasks.findOneAndUpdate(
          { _id: task.id },
          {
            $set: {
              leaseExpiresAt,
            },
            $push: {
              attempts: attempt
            }
          },
          {
            returnDocument: 'after',
            session
          }
        );
        
        if (updatedDoc) {
          result = this.taskFromDocument(updatedDoc);
        }
      });
      
      return result;
    } finally {
      await session.endSession();
    }
  }

  // Agent operations
  async createAgent(input: AgentCreateInput): Promise<Agent> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
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

    const { id, ...agentData } = agent;
    const doc: OptionalUnlessRequiredId<AgentDocument> = {
      _id: agent.id,
      ...agentData
    };

    await collections.agents.insertOne(doc);
    return agent;
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.agents.findOne({ _id: agentId });
    return doc ? this.agentFromDocument(doc) : null;
  }

  async getAgentByName(agentName: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.agents.findOne({ name: agentName, projectId });
    return doc ? this.agentFromDocument(doc) : null;
  }

  async getAgentByApiKey(hashedApiKey: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.agents.findOne({ apiKeyHash: hashedApiKey, projectId });
    return doc ? this.agentFromDocument(doc) : null;
  }

  async updateAgent(agentId: string, input: AgentUpdateInput): Promise<Agent> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const currentDoc = await collections.agents.findOne({ _id: agentId });
    if (!currentDoc) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const currentAgent = this.agentFromDocument(currentDoc);
    const updatedAgent: Agent = {
      ...currentAgent,
      ...input,
      id: currentAgent.id,
      projectId: currentAgent.projectId,
      createdAt: currentAgent.createdAt,
    };
    
    const { id, ...updateDoc } = updatedAgent;
    await collections.agents.replaceOne({ _id: agentId }, updateDoc);
    
    return updatedAgent;
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const docs = await collections.agents
      .find({ projectId })
      .sort({ createdAt: -1 })
      .toArray();
    
    return docs.map(doc => this.agentFromDocument(doc));
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const result = await collections.agents.deleteOne({ _id: agentId });
    if (result.deletedCount === 0) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  async completeTask(taskId: string, result: TaskResult): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    if (!this.useTransactions) {
      // Non-transactional version for testing
      const taskDoc = await collections.tasks.findOne({ _id: taskId });
      if (!taskDoc) {
        throw new Error(`Task ${taskId} not found`);
      }
      
      const task = this.taskFromDocument(taskDoc);
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
      await collections.tasks.updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'completed',
            completedAt: now,
            result,
            attempts: updatedAttempts
          },
          $unset: {
            assignedTo: '',
            leaseExpiresAt: '',
            assignedAt: ''
          }
        }
      );
      return;
    }
    
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        const taskDoc = await collections.tasks.findOne({ _id: taskId }, { session });
        if (!taskDoc) {
          throw new Error(`Task ${taskId} not found`);
        }
        
        const task = this.taskFromDocument(taskDoc);
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
        await collections.tasks.updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'completed',
              completedAt: now,
              result,
              attempts: updatedAttempts
            },
            $unset: {
              assignedTo: '',
              leaseExpiresAt: '',
              assignedAt: ''
            }
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async failTask(taskId: string, result: TaskResult, canRetry: boolean = true): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    if (!this.useTransactions) {
      // Non-transactional version for testing
      const taskDoc = await collections.tasks.findOne({ _id: taskId });
      if (!taskDoc) {
        throw new Error(`Task ${taskId} not found`);
      }
      
      const task = this.taskFromDocument(taskDoc);
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
      
      const updateDoc: Document = {
        status: shouldRetry ? 'queued' : 'failed',
        retryCount: newRetryCount,
        attempts: updatedAttempts
      };
      
      const unsetDoc: Document = {
        assignedTo: '',
        leaseExpiresAt: '',
        assignedAt: ''
      };
      
      if (!shouldRetry) {
        updateDoc.failedAt = now;
        updateDoc.result = result;
      }
      
      await collections.tasks.updateOne(
        { _id: taskId },
        {
          $set: updateDoc,
          $unset: unsetDoc
        }
      );
      return;
    }
    
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        const taskDoc = await collections.tasks.findOne({ _id: taskId }, { session });
        if (!taskDoc) {
          throw new Error(`Task ${taskId} not found`);
        }
        
        const task = this.taskFromDocument(taskDoc);
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
        
        const updateDoc: Document = {
          status: shouldRetry ? 'queued' : 'failed',
          retryCount: newRetryCount,
          attempts: updatedAttempts
        };
        
        const unsetDoc: Document = {
          assignedTo: '',
          leaseExpiresAt: '',
          assignedAt: ''
        };
        
        if (!shouldRetry) {
          updateDoc.failedAt = now;
          updateDoc.result = result;
        }
        
        await collections.tasks.updateOne(
          { _id: taskId },
          {
            $set: updateDoc,
            $unset: unsetDoc
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }
  }

  // Lease management operations
  async findExpiredLeases(): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const now = new Date();
    const docs = await collections.tasks
      .find({
        status: 'running',
        leaseExpiresAt: { $lt: now }
      })
      .toArray();
    
    return docs.map(doc => this.taskFromDocument(doc));
  }

  async requeueTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    await collections.tasks.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'queued'
        },
        $inc: {
          retryCount: 1
        },
        $unset: {
          assignedTo: '',
          leaseExpiresAt: '',
          assignedAt: ''
        }
      }
    );
  }

  async extendLease(taskId: string, additionalMinutes: number): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const taskDoc = await collections.tasks.findOne({ _id: taskId });
    if (!taskDoc) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const task = this.taskFromDocument(taskDoc);
    if (!task.leaseExpiresAt) {
      throw new Error(`Task ${taskId} has no active lease`);
    }
    
    const newLeaseExpiresAt = new Date(task.leaseExpiresAt.getTime() + additionalMinutes * 60 * 1000);
    
    await collections.tasks.updateOne(
      { _id: taskId },
      { $set: { leaseExpiresAt: newLeaseExpiresAt } }
    );
  }

  // Batch operations (simplified implementations)
  async createTasksBulk(projectId: string, tasks: TaskInput[]): Promise<BatchCreateResult> {
    // Simplified implementation - could be optimized with bulk operations
    const batchId = uuidv4();
    const createdTasks: Task[] = [];
    const errors: string[] = [];
    
    for (const taskInput of tasks) {
      try {
        const task = await this.createTask({
          ...taskInput,
          projectId,
          batchId
        });
        createdTasks.push(task);
      } catch (error) {
        errors.push(`Failed to create task: ${error}`);
      }
    }
    
    return {
      batchId,
      tasksCreated: createdTasks.length,
      errors
    };
  }

  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const tasks = await collections.tasks.find({ batchId }).toArray();
    
    const tasksByStatus = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const task = tasks[0];
    return {
      batchId,
      projectId: task?.projectId || '',
      total: tasks.length,
      completed: tasksByStatus.completed || 0,
      failed: tasksByStatus.failed || 0,
      running: tasksByStatus.running || 0,
      queued: tasksByStatus.queued || 0,
      createdAt: task?.createdAt || new Date()
    };
  }

  // Utility operations
  async findDuplicateTask(projectId: string, typeId: string, variables?: Record<string, string>): Promise<Task | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const doc = await collections.tasks.findOne({
      projectId,
      typeId,
      status: { $ne: 'failed' },
      variables: variables || {}
    });
    
    return doc ? this.taskFromDocument(doc) : null;
  }

  async getTaskHistory(taskId: string): Promise<Task[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    // For MongoDB, we'll just return the current task
    // In a full implementation, you might store task history separately
    const doc = await collections.tasks.findOne({ _id: taskId });
    return doc ? [this.taskFromDocument(doc)] : [];
  }

  // Health and metrics
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      this.ensureInitialized();
      const collections = this.ensureCollections();
      
      // Simple ping to check connectivity
      await collections.projects.findOne({}, { limit: 1 });
      
      return { healthy: true, message: 'MongoDB connection is healthy' };
    } catch (error) {
      return { 
        healthy: false, 
        message: `MongoDB health check failed: ${error}` 
      };
    }
  }

  async getMetrics(): Promise<Record<string, number>> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    try {
      const [
        totalProjects,
        activeProjects,
        totalTasks,
        queuedTasks,
        runningTasks,
        completedTasks,
        failedTasks,
        totalAgents,
        activeAgents
      ] = await Promise.all([
        collections.projects.countDocuments(),
        collections.projects.countDocuments({ status: 'active' }),
        collections.tasks.countDocuments(),
        collections.tasks.countDocuments({ status: 'queued' }),
        collections.tasks.countDocuments({ status: 'running' }),
        collections.tasks.countDocuments({ status: 'completed' }),
        collections.tasks.countDocuments({ status: 'failed' }),
        collections.agents.countDocuments(),
        collections.agents.countDocuments({ status: { $in: ['idle', 'working'] } })
      ]);
      
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
    const collections = this.ensureCollections();
    
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

    const sessionDoc = { ...session, _id: sessionId };
    await collections.sessions.insertOne(sessionDoc);
    
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const sessionDoc = await collections.sessions.findOne({ _id: sessionId });
    if (!sessionDoc) {
      return null;
    }

    // Check if session is expired
    if (new Date() > sessionDoc.expiresAt) {
      // Clean up expired session
      await this.deleteSession(sessionId);
      return null;
    }
    
    const { _id, ...session } = sessionDoc;
    return { ...session, id: _id } as Session;
  }

  async updateSession(sessionId: string, input: SessionUpdateInput): Promise<Session> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const updateDoc = {
      ...(input.lastAccessedAt && { lastAccessedAt: input.lastAccessedAt }),
      ...(input.expiresAt && { expiresAt: input.expiresAt }),
      ...(input.data !== undefined && { data: input.data })
    };

    const result = await collections.sessions.findOneAndUpdate(
      { _id: sessionId },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    if (!result) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const { _id, ...session } = result;
    return { ...session, id: _id } as Session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    await collections.sessions.deleteOne({ _id: sessionId });
  }

  async findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const sessionDocs = await collections.sessions.find({
      agentName,
      projectId,
      expiresAt: { $gt: new Date() } // Only active sessions
    }).toArray();

    return sessionDocs.map(doc => {
      const { _id, ...session } = doc;
      return { ...session, id: _id } as Session;
    });
  }

  async cleanupExpiredSessions(): Promise<number> {
    this.ensureInitialized();
    const collections = this.ensureCollections();
    
    const result = await collections.sessions.deleteMany({
      expiresAt: { $lt: new Date() }
    });

    return result.deletedCount || 0;
  }
}