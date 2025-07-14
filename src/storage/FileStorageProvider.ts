import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
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
import { 
  ensureDirectory, 
  writeFileAtomic, 
  readFileSafe, 
  fileExists, 
  listFiles,
  removeFileSafe 
} from '../utils/fileUtils.js';

interface ProjectData {
  project: Project;
  taskTypes: TaskType[];
  tasks: Task[];
  agents: Agent[];
}

/**
 * File-based storage provider using JSON files with proper file locking
 * Suitable for single-machine deployments and development
 */
export class FileStorageProvider extends BaseStorageProvider {
  private dataDir: string;
  private lockTimeout: number;

  constructor(dataDir: string = './data', lockTimeout: number = 30000) {
    super();
    this.dataDir = dataDir;
    this.lockTimeout = lockTimeout;
  }

  protected async doInitialize(): Promise<void> {
    await ensureDirectory(this.dataDir);
    await ensureDirectory(path.join(this.dataDir, 'projects'));
    await ensureDirectory(path.join(this.dataDir, 'locks'));
  }

  protected async doClose(): Promise<void> {
    // No persistent connections to close for file storage
  }

  // Helper methods for file operations

  private getProjectFilePath(projectId: string): string {
    return path.join(this.dataDir, 'projects', `${projectId}.json`);
  }

  private getLockFilePath(projectId: string): string {
    return path.join(this.dataDir, 'locks', `${projectId}.lock`);
  }

  private async withProjectLock<T>(
    projectId: string, 
    operation: (data: ProjectData) => Promise<{ data: ProjectData; result: T }>
  ): Promise<T> {
    this.ensureInitialized();
    
    const projectFilePath = this.getProjectFilePath(projectId);
    
    // Ensure the project file exists for locking to work
    const projectExists = await fileExists(projectFilePath);
    if (!projectExists) {
      // For operations that require existing projects, throw immediately
      throw new Error(`Project ${projectId} not found`);
    }
    
    // Acquire exclusive lock on the project file itself
    const release = await lockfile.lock(projectFilePath, {
      retries: {
        retries: 10,
        minTimeout: 10,
        maxTimeout: 100,
        factor: 1.2
      },
      stale: this.lockTimeout,
    });

    try {
      // Read current data
      const currentData = await this.readProjectData(projectId);
      
      // Perform operation
      const { data: newData, result } = await operation(currentData);
      
      // Write back atomically
      await this.writeProjectData(projectId, newData);
      
      return result;
    } finally {
      await release();
    }
  }

  private async readProjectData(projectId: string): Promise<ProjectData> {
    const filePath = this.getProjectFilePath(projectId);
    const content = await readFileSafe(filePath);
    
    if (!content) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    try {
      const data = JSON.parse(content);
      // Convert date strings back to Date objects
      return this.deserializeDates(data);
    } catch (error) {
      throw new Error(`Failed to parse project data for ${projectId}: ${error}`);
    }
  }

  private async writeProjectData(projectId: string, data: ProjectData): Promise<void> {
    const filePath = this.getProjectFilePath(projectId);
    const serializedData = this.serializeDates(data);
    const content = JSON.stringify(serializedData, null, 2);
    await writeFileAtomic(filePath, content);
  }

  private serializeDates(obj: any): any {
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.serializeDates(item));
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.serializeDates(value);
      }
      return result;
    }
    return obj;
  }

  private deserializeDates(obj: any): any {
    if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(obj)) {
      return new Date(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.deserializeDates(item));
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Don't deserialize dates in metadata objects - they should stay as strings
        if (key === 'metadata' && typeof value === 'object' && value !== null) {
          result[key] = value;
        } else {
          result[key] = this.deserializeDates(value);
        }
      }
      return result;
    }
    return obj;
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

    const projectData: ProjectData = {
      project,
      taskTypes: [],
      tasks: [],
      agents: [],
    };

    await this.writeProjectData(projectId, projectData);
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      const updatedProject = this.updateProjectStats(data.project, data.tasks);
      
      // Update the project with current stats
      if (updatedProject.stats !== data.project.stats) {
        data.project = updatedProject;
        await this.writeProjectData(projectId, data);
      }
      
      return updatedProject;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  async updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
    return this.withProjectLock(projectId, async (data) => {
      const updatedProject: Project = {
        ...data.project,
        ...input,
        config: input.config ? { ...data.project.config, ...input.config } : data.project.config,
        updatedAt: new Date(),
      };
      
      const finalProject = this.updateProjectStats(updatedProject, data.tasks);
      
      return {
        data: { ...data, project: finalProject },
        result: finalProject,
      };
    });
  }

  async listProjects(includeClosed: boolean = false): Promise<Project[]> {
    this.ensureInitialized();
    
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    const projects: Project[] = [];
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const project = this.updateProjectStats(data.project, data.tasks);
          
          if (includeClosed || project.status === 'active') {
            projects.push(project);
          }
        }
      } catch (error) {
        // Skip corrupted files
        console.warn(`Failed to read project file ${filePath}:`, error);
      }
    }
    
    return projects.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteProject(projectId: string): Promise<void> {
    this.ensureInitialized();
    
    const projectFilePath = this.getProjectFilePath(projectId);
    await removeFileSafe(projectFilePath);
  }

  // Task Type operations

  async createTaskType(input: TaskTypeCreateInput): Promise<TaskType> {
    return this.withProjectLock(input.projectId, async (data) => {
      const now = new Date();
      const taskType: TaskType = {
        id: uuidv4(),
        name: input.name,
        projectId: input.projectId,
        template: input.template,
        variables: input.variables,
        duplicateHandling: input.duplicateHandling ?? 'allow',
        maxRetries: input.maxRetries ?? data.project.config.defaultMaxRetries,
        leaseDurationMinutes: input.leaseDurationMinutes ?? data.project.config.defaultLeaseDurationMinutes,
        createdAt: now,
        updatedAt: now,
      };

      data.taskTypes.push(taskType);
      
      return {
        data,
        result: taskType,
      };
    });
  }

  async getTaskType(typeId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskType = data.taskTypes.find(tt => tt.id === typeId);
          if (taskType) {
            return taskType;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    return null;
  }

  async updateTaskType(typeId: string, input: TaskTypeUpdateInput): Promise<TaskType> {
    this.ensureInitialized();
    
    // Find which project contains this task type
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskTypeIndex = data.taskTypes.findIndex(tt => tt.id === typeId);
          
          if (taskTypeIndex >= 0) {
            const projectId = data.project.id;
            
            return this.withProjectLock(projectId, async (lockedData) => {
              const currentTaskType = lockedData.taskTypes[taskTypeIndex];
              if (!currentTaskType) {
                throw new Error(`TaskType not found in project data`);
              }
              
              const updatedTaskType: TaskType = {
                ...currentTaskType,
                ...input,
                id: currentTaskType.id, // Ensure ID is preserved
                projectId: currentTaskType.projectId,
                name: input.name || currentTaskType.name,
                createdAt: currentTaskType.createdAt,
                updatedAt: new Date(),
              };
              
              lockedData.taskTypes[taskTypeIndex] = updatedTaskType;
              
              return {
                data: lockedData,
                result: updatedTaskType,
              };
            });
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Task type ${typeId} not found`);
  }

  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      return data.taskTypes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  async deleteTaskType(typeId: string): Promise<void> {
    // Find and remove from the appropriate project
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskTypeIndex = data.taskTypes.findIndex(tt => tt.id === typeId);
          
          if (taskTypeIndex >= 0) {
            const projectId = data.project.id;
            
            await this.withProjectLock(projectId, async (lockedData) => {
              lockedData.taskTypes.splice(taskTypeIndex, 1);
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Task type ${typeId} not found`);
  }

  // Task operations (continued in next part due to length)
  
  async createTask(input: TaskCreateInput): Promise<Task> {
    return this.withProjectLock(input.projectId, async (data) => {
      // Get task type to check duplicate handling
      const taskType = data.taskTypes.find(tt => tt.id === input.typeId);
      if (!taskType) {
        throw new Error(`Task type ${input.typeId} not found`);
      }

      // Check for duplicates if required
      if (taskType.duplicateHandling !== 'allow') {
        const duplicate = data.tasks.find(t => 
          t.typeId === input.typeId && 
          t.status !== 'failed' &&
          JSON.stringify(t.variables || {}) === JSON.stringify(input.variables || {})
        );

        if (duplicate) {
          if (taskType.duplicateHandling === 'fail') {
            throw new Error(`Duplicate task found for type ${taskType.name} with variables ${JSON.stringify(input.variables)}`);
          } else { // 'ignore'
            return { data, result: duplicate };
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

      data.tasks.push(task);
      
      return {
        data,
        result: task,
      };
    });
  }

  // We'll continue with the rest of the methods...
  // This is getting quite long, so I'll implement the critical atomic operations next

  // CRITICAL: Atomic task assignment
  async assignTask(projectId: string, agentName: string): Promise<Task | null> {
    return this.withProjectLock(projectId, async (data) => {
      // Find first queued task
      const taskIndex = data.tasks.findIndex(t => t.status === 'queued');
      
      if (taskIndex === -1) {
        return { data, result: null };
      }

      const task = data.tasks[taskIndex];
      if (!task) {
        return { data, result: null };
      }
      
      const taskType = data.taskTypes.find(tt => tt.id === task.typeId);
      if (!taskType) {
        throw new Error(`Task type ${task.typeId} not found`);
      }

      // Update task to running state with lease
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + taskType.leaseDurationMinutes * 60 * 1000);
      
      const attempt: TaskAttempt = {
        id: uuidv4(),
        agentName,
        startedAt: now,
        status: 'running',
        leaseExpiresAt,
      };

      const updatedTask: Task = {
        ...task,
        status: 'running' as const,
        assignedTo: agentName,
        leaseExpiresAt,
        assignedAt: now,
        attempts: [...task.attempts, attempt],
      };

      data.tasks[taskIndex] = updatedTask;
      
      return {
        data,
        result: updatedTask,
      };
    });
  }

  // For now, I'll implement stubs for the remaining methods to make it compile
  // These will be implemented in subsequent iterations

  async getTask(taskId: string): Promise<Task | null> {
    this.ensureInitialized();
    
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const task = data.tasks.find(t => t.id === taskId);
          if (task) {
            return task;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    return null;
  }

  async updateTask(taskId: string, input: TaskUpdateInput): Promise<Task> {
    this.ensureInitialized();
    
    // Find which project contains this task
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskIndex = data.tasks.findIndex(t => t.id === taskId);
          
          if (taskIndex >= 0) {
            const projectId = data.project.id;
            
            return this.withProjectLock(projectId, async (lockedData) => {
              const currentTask = lockedData.tasks[taskIndex];
              if (!currentTask) {
                throw new Error(`Task not found in project data`);
              }
              
              const updatedTask: Task = {
                ...currentTask,
                ...input,
                id: currentTask.id, // Ensure ID is preserved
                projectId: currentTask.projectId,
                typeId: currentTask.typeId,
                instructions: currentTask.instructions,
                status: input.status || currentTask.status,
                retryCount: input.retryCount !== undefined ? input.retryCount : currentTask.retryCount,
                maxRetries: currentTask.maxRetries,
                attempts: currentTask.attempts,
                createdAt: currentTask.createdAt,
                updatedAt: new Date(),
              };
              
              lockedData.tasks[taskIndex] = updatedTask;
              
              return {
                data: lockedData,
                result: updatedTask,
              };
            });
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      let tasks = [...data.tasks];
      
      // Apply filters
      if (filters) {
        if (filters.status) {
          tasks = tasks.filter(t => t.status === filters.status);
        }
        if (filters.assignedTo) {
          tasks = tasks.filter(t => t.assignedTo === filters.assignedTo);
        }
        if (filters.batchId) {
          tasks = tasks.filter(t => t.batchId === filters.batchId);
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
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    // Implementation needed
    throw new Error('Method not implemented');
  }

  async createAgent(input: AgentCreateInput): Promise<Agent> {
    return this.withProjectLock(input.projectId, async (data) => {
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

      data.agents.push(agent);
      
      return {
        data,
        result: agent,
      };
    });
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const agent = data.agents.find(a => a.id === agentId);
          if (agent) {
            return agent;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    return null;
  }

  async getAgentByName(agentName: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      return data.agents.find(a => a.name === agentName) || null;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  async getAgentByApiKey(hashedApiKey: string, projectId: string): Promise<Agent | null> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      return data.agents.find(a => a.apiKeyHash === hashedApiKey) || null;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  async updateAgent(agentId: string, input: AgentUpdateInput): Promise<Agent> {
    this.ensureInitialized();
    
    // Find which project contains this agent
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const agentIndex = data.agents.findIndex(a => a.id === agentId);
          
          if (agentIndex >= 0) {
            const projectId = data.project.id;
            
            return this.withProjectLock(projectId, async (lockedData) => {
              const currentAgent = lockedData.agents[agentIndex];
              if (!currentAgent) {
                throw new Error(`Agent not found in project data`);
              }
              
              const updatedAgent: Agent = {
                ...currentAgent,
                ...input,
                id: currentAgent.id, // Ensure ID is preserved
                projectId: currentAgent.projectId,
                name: input.name || currentAgent.name,
                status: input.status || currentAgent.status,
                lastSeen: input.lastSeen || currentAgent.lastSeen,
                createdAt: currentAgent.createdAt,
              };
              
              lockedData.agents[agentIndex] = updatedAgent;
              
              return {
                data: lockedData,
                result: updatedAgent,
              };
            });
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Agent ${agentId} not found`);
  }

  async listAgents(projectId: string): Promise<Agent[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      return data.agents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    
    // Find which project contains this agent
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const agentIndex = data.agents.findIndex(a => a.id === agentId);
          
          if (agentIndex >= 0) {
            const projectId = data.project.id;
            
            await this.withProjectLock(projectId, async (lockedData) => {
              lockedData.agents.splice(agentIndex, 1);
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Agent ${agentId} not found`);
  }

  async completeTask(taskId: string, result: TaskResult): Promise<void> {
    this.ensureInitialized();
    
    // Find which project contains this task
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskIndex = data.tasks.findIndex(t => t.id === taskId);
          
          if (taskIndex >= 0) {
            const projectId = data.project.id;
            
            await this.withProjectLock(projectId, async (lockedData) => {
              const task = lockedData.tasks[taskIndex];
              if (!task) {
                throw new Error(`Task ${taskId} not found in project data`);
              }
              
              const now = new Date();
              
              // Update the current attempt
              const currentAttempt = task.attempts[task.attempts.length - 1];
              if (currentAttempt) {
                currentAttempt.completedAt = now;
                currentAttempt.status = 'completed';
                currentAttempt.result = result;
              }
              
              // Update task status
              const updatedTask: Task = {
                ...task,
                status: 'completed' as const,
                completedAt: now,
                result,
                assignedTo: undefined,
                leaseExpiresAt: undefined,
              };
              
              lockedData.tasks[taskIndex] = updatedTask;
              
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async failTask(taskId: string, result: TaskResult, canRetry: boolean = true): Promise<void> {
    this.ensureInitialized();
    
    // Find which project contains this task
    const projectFiles = await listFiles(path.join(this.dataDir, 'projects'), '.json');
    
    for (const filePath of projectFiles) {
      try {
        const content = await readFileSafe(filePath);
        if (content) {
          const data: ProjectData = this.deserializeDates(JSON.parse(content));
          const taskIndex = data.tasks.findIndex(t => t.id === taskId);
          
          if (taskIndex >= 0) {
            const projectId = data.project.id;
            
            await this.withProjectLock(projectId, async (lockedData) => {
              const task = lockedData.tasks[taskIndex];
              if (!task) {
                throw new Error(`Task ${taskId} not found in project data`);
              }
              
              const now = new Date();
              
              // Update the current attempt
              const currentAttempt = task.attempts[task.attempts.length - 1];
              if (currentAttempt) {
                currentAttempt.completedAt = now;
                currentAttempt.status = 'failed';
                currentAttempt.result = result;
              }
              
              // Determine if we should retry (check if we haven't exceeded max retries)
              const shouldRetry = canRetry && task.retryCount < task.maxRetries;
              const newRetryCount = task.retryCount + 1;
              
              const updatedTask: Task = {
                ...task,
                status: shouldRetry ? 'queued' as const : 'failed' as const,
                retryCount: newRetryCount,
                failedAt: shouldRetry ? task.failedAt : now,
                result: shouldRetry ? task.result : result,
                assignedTo: undefined,
                leaseExpiresAt: undefined,
                assignedAt: undefined,
              };
              
              lockedData.tasks[taskIndex] = updatedTask;
              
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async findExpiredLeases(): Promise<Task[]> {
    // Implementation needed
    throw new Error('Method not implemented');
  }

  async requeueTask(taskId: string): Promise<void> {
    // Implementation needed
    throw new Error('Method not implemented');
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
    
    await this.updateTask(taskId, {
      leaseExpiresAt: newLeaseExpiresAt
    });
  }

  async createTasksBulk(projectId: string, tasks: TaskInput[]): Promise<BatchCreateResult> {
    this.ensureInitialized();
    
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
    
    // Find all tasks with this batch ID across all projects
    const projectIds = await this.listProjects(true).then(projects => projects.map(p => p.id));
    let batchTasks: Task[] = [];
    let projectId = '';
    
    for (const pId of projectIds) {
      const tasks = await this.listTasks(pId, { batchId });
      if (tasks.length > 0) {
        batchTasks = tasks;
        projectId = pId;
        break;
      }
    }
    
    const tasksByStatus = batchTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const firstTask = batchTasks[0];
    return {
      batchId,
      projectId,
      total: batchTasks.length,
      completed: tasksByStatus.completed || 0,
      failed: tasksByStatus.failed || 0,
      running: tasksByStatus.running || 0,
      queued: tasksByStatus.queued || 0,
      createdAt: firstTask?.createdAt || new Date()
    };
  }

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
    // Implementation needed
    throw new Error('Method not implemented');
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true, message: 'File storage is healthy' };
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

    const sessionsDir = path.join(this.dataDir, 'sessions');
    await ensureDirectory(sessionsDir);
    
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    await writeFileAtomic(sessionFile, JSON.stringify(session, null, 2));
    
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    this.ensureInitialized();
    
    const sessionFile = path.join(this.dataDir, 'sessions', `${sessionId}.json`);
    
    if (!await fileExists(sessionFile)) {
      return null;
    }

    try {
      const content = await readFileSafe(sessionFile);
      if (!content) {
        return null;
      }
      const session: Session = JSON.parse(content);
      
      // Check if session is expired
      if (new Date() > new Date(session.expiresAt)) {
        // Clean up expired session
        await this.deleteSession(sessionId);
        return null;
      }
      
      return session;
    } catch (error) {
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

    const sessionFile = path.join(this.dataDir, 'sessions', `${sessionId}.json`);
    await writeFileAtomic(sessionFile, JSON.stringify(updatedSession, null, 2));
    
    return updatedSession;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    
    const sessionFile = path.join(this.dataDir, 'sessions', `${sessionId}.json`);
    await removeFileSafe(sessionFile);
  }

  async findSessionsByAgent(agentName: string, projectId: string): Promise<Session[]> {
    this.ensureInitialized();
    
    const sessionsDir = path.join(this.dataDir, 'sessions');
    
    if (!await fileExists(sessionsDir)) {
      return [];
    }

    const sessionFiles = await listFiles(sessionsDir, '.json');
    const sessions: Session[] = [];
    const now = new Date();

    for (const file of sessionFiles) {
      try {
        const content = await readFileSafe(file);
        if (!content) {
          continue;
        }
        const session: Session = JSON.parse(content);
        
        // Skip expired sessions
        if (now > new Date(session.expiresAt)) {
          continue;
        }
        
        // Match agent and project
        if (session.agentName === agentName && session.projectId === projectId) {
          sessions.push(session);
        }
      } catch (error) {
        // Ignore corrupt session files
      }
    }

    return sessions;
  }

  async cleanupExpiredSessions(): Promise<number> {
    this.ensureInitialized();
    
    const sessionsDir = path.join(this.dataDir, 'sessions');
    
    if (!await fileExists(sessionsDir)) {
      return 0;
    }

    const sessionFiles = await listFiles(sessionsDir, '.json');
    const now = new Date();
    let cleanedCount = 0;

    for (const file of sessionFiles) {
      try {
        const content = await readFileSafe(file);
        if (!content) {
          continue;
        }
        const session: Session = JSON.parse(content);
        
        if (now > new Date(session.expiresAt)) {
          await removeFileSafe(file);
          cleanedCount++;
        }
      } catch (error) {
        // If we can't parse the session file, remove it
        await removeFileSafe(file);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  async getMetrics(): Promise<Record<string, number>> {
    // Implementation needed
    return {};
  }
}