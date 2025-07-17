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
import { 
  ensureDirectory, 
  writeFileAtomic, 
  readFileSafe, 
  fileExists, 
  listFiles,
  removeFileSafe 
} from '../utils/fileUtils.js';
import { uuidSchema } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

interface ProjectData {
  project: Project;
  taskTypes: TaskType[];
  tasks: Task[];
  // No more persistent agents - they're ephemeral queue workers
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  try {
    const { error } = uuidSchema.validate(str);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Find project data by UUID (direct file lookup)
 */
async function findProjectByUUID(dataDir: string, projectId: string): Promise<{ projectId: string; data: ProjectData } | null> {
  const projectFilePath = path.join(dataDir, 'projects', `${projectId}.json`);
  try {
    const content = await readFileSafe(projectFilePath);
    if (content) {
      const data: ProjectData = JSON.parse(content);
      return { projectId, data };
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find project data by name (grep-based search)
 */
async function findProjectByName(dataDir: string, projectName: string): Promise<{ projectId: string; data: ProjectData } | null> {
  const projectsDir = path.join(dataDir, 'projects');
  const projectFiles = await listFiles(projectsDir, '.json');

  for (const filePath of projectFiles) {
    try {
      const content = await readFileSafe(filePath);
      if (content && new RegExp(`"name"\\s*:\\s*"${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g').test(content)) {
        const data: ProjectData = JSON.parse(content);
        if (data.project.name === projectName) {
          return { projectId: data.project.id, data };
        }
      }
    } catch (error) {
      // Skip files that can't be read
      continue;
    }
  }

  return null;
}

/**
 * File-based storage provider using JSON files with proper file locking
 * Suitable for single-machine deployments and development
 */
export class FileStorageProvider extends BaseStorageProvider {
  private dataDir: string;
  private lockTimeout: number;
  private memoryLocks: Map<string, Promise<any>> = new Map();

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
    
    // FIRST: Acquire in-memory lock to prevent concurrent operations on the same project
    const memoryLockKey = `project:${projectId}`;
    while (this.memoryLocks.has(memoryLockKey)) {
      logger.trace('Waiting for in-memory lock', {
        operation: 'withProjectLock',
        projectId,
        memoryLockKey
      });
      await this.memoryLocks.get(memoryLockKey);
    }
    
    // Create a new promise for this lock
    let resolveMemoryLock: () => void;
    const memoryLockPromise = new Promise<void>((resolve) => {
      resolveMemoryLock = resolve;
    });
    this.memoryLocks.set(memoryLockKey, memoryLockPromise);
    logger.trace('Acquired in-memory lock', {
      operation: 'withProjectLock',
      projectId,
      memoryLockKey
    });
    
    try {
      // SECOND: Acquire file lock
      logger.trace('Acquiring file lock', {
        operation: 'withProjectLock',
        projectId
      });
      const lockStart = Date.now();
      const release = await lockfile.lock(projectFilePath, {
        retries: {
          retries: 50,  // Increased retries for high concurrency
          minTimeout: 5,  // Faster retry start
          maxTimeout: 200,  // Higher max timeout
          factor: 1.1  // More gradual backoff
        },
        stale: this.lockTimeout,
      });
      const lockEnd = Date.now();
      logger.trace('File lock acquired', {
        operation: 'withProjectLock',
        projectId,
        duration: lockEnd - lockStart
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
        logger.trace('Releasing file lock', {
          operation: 'withProjectLock',
          projectId
        });
        const releaseStart = Date.now();
        await release();
        const releaseEnd = Date.now();
        logger.trace('File lock released', {
          operation: 'withProjectLock',
          projectId,
          duration: releaseEnd - releaseStart
        });
      }
    } finally {
      // Release in-memory lock
      this.memoryLocks.delete(memoryLockKey);
      resolveMemoryLock!();
      logger.trace('In-memory lock released', {
        operation: 'withProjectLock',
        projectId,
        memoryLockKey
      });
    }
  }

  private async readProjectData(projectId: string): Promise<ProjectData> {
    const filePath = this.getProjectFilePath(projectId);
    logger.trace('Reading project data', {
      operation: 'readProjectData',
      projectId
    });
    const readStart = Date.now();
    const content = await readFileSafe(filePath);
    const readEnd = Date.now();
    
    if (!content) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    try {
      const data = JSON.parse(content);
      // Convert date strings back to Date objects
      const result: ProjectData = this.deserializeDates(data);
      logger.trace('Project data read successfully', {
        operation: 'readProjectData',
        projectId,
        duration: readEnd - readStart,
        queuedTasks: result.tasks.filter(t => t.status === 'queued').length
      });
      return result;
    } catch (error) {
      throw new Error(`Failed to parse project data for ${projectId}: ${error}`);
    }
  }

  private async writeProjectData(projectId: string, data: ProjectData): Promise<void> {
    const filePath = this.getProjectFilePath(projectId);
    const serializedData = this.serializeDates(data);
    const content = JSON.stringify(serializedData, null, 2);
    logger.trace('Writing project data', {
      operation: 'writeProjectData',
      projectId,
      queuedTasks: data.tasks.filter(t => t.status === 'queued').length
    });
    const writeStart = Date.now();
    await writeFileAtomic(filePath, content);
    const writeEnd = Date.now();
    logger.trace('Project data written successfully', {
      operation: 'writeProjectData',
      projectId,
      duration: writeEnd - writeStart
    });
    
    // FORCE FILE SYSTEM SYNC: Add small delay and force sync to ensure data is persisted
    await new Promise(resolve => setTimeout(resolve, 1)); // 1ms delay
    
    // VERIFICATION: Immediately read back the data to verify write was successful
    const verifyStart = Date.now();
    const verifiedContent = await readFileSafe(filePath);
    const verifyEnd = Date.now();
    if (verifiedContent) {
      const verifiedData = JSON.parse(verifiedContent) as typeof data;
      logger.trace('Data verification completed', {
        operation: 'writeProjectData',
        projectId,
        duration: verifyEnd - verifyStart,
        verifiedQueuedTasks: verifiedData.tasks.filter(t => t.status === 'queued').length
      });
      
      // DOUBLE CHECK: Compare with what we expected to write
      const expectedQueuedTasks = data.tasks.filter(t => t.status === 'queued').map(t => `${t.id}:${t.status}`).join(', ');
      const actualQueuedTasks = verifiedData.tasks.filter(t => t.status === 'queued').map(t => `${t.id}:${t.status}`).join(', ');
      if (expectedQueuedTasks !== actualQueuedTasks) {
        logger.trace('Write verification mismatch detected', {
          operation: 'writeProjectData',
          projectId,
          expected: expectedQueuedTasks,
          actual: actualQueuedTasks
        });
        throw new Error(`Data write verification failed: expected ${expectedQueuedTasks}, got ${actualQueuedTasks}`);
      }
    } else {
      logger.trace('Failed to read back written data for verification', {
        operation: 'writeProjectData',
        projectId
      });
      throw new Error(`Failed to read back written data for verification`);
    }
  }

  /**
   * Recursively serializes Date objects to ISO strings for JSON storage.
   * 
   * @param obj - The object that may contain Date objects
   * @returns The same object structure with Date objects converted to ISO strings
   */
  private serializeDates<T>(obj: T): T {
    if (obj instanceof Date) {
      return obj.toISOString() as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.serializeDates(item)) as unknown as T;
    }
    if (obj && typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.serializeDates(value);
      }
      return result as T;
    }
    return obj;
  }

  /**
   * Recursively deserializes ISO date strings back to Date objects in JSON data.
   * 
   * When data is stored as JSON, Date objects are serialized as ISO strings.
   * This function walks through the entire object tree and converts any string
   * that matches the ISO date format back to a Date object.
   * 
   * Special handling:
   * - Preserves metadata objects as-is (keeps dates as strings for external storage)
   * - Handles nested objects and arrays recursively
   * - Only converts strings that match exact ISO format: YYYY-MM-DDTHH:mm:ss.sssZ
   * 
   * @param obj - The parsed JSON object that may contain ISO date strings
   * @returns The same object structure with ISO date strings converted to Date objects
   */
  private deserializeDates<T>(obj: T): T {
    // Convert ISO date strings to Date objects
    if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(obj)) {
      return new Date(obj) as unknown as T;
    }
    
    // Handle arrays recursively
    if (Array.isArray(obj)) {
      return obj.map(item => this.deserializeDates(item)) as unknown as T;
    }
    
    // Handle objects recursively
    if (obj && typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Don't deserialize dates in metadata objects - they should stay as strings
        // for external storage compatibility and debugging purposes
        if (key === 'metadata' && typeof value === 'object' && value !== null) {
          result[key] = value;
        } else {
          result[key] = this.deserializeDates(value);
        }
      }
      return result as T;
    }
    
    // Return primitive values unchanged
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
      instructions: input.instructions,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      config: {
        defaultMaxRetries: input.config?.defaultMaxRetries ?? 3,
        defaultLeaseDurationMinutes: input.config?.defaultLeaseDurationMinutes ?? 1.5,
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
    };

    await this.writeProjectData(projectId, projectData);
    return project;
  }

  async getProject(projectNameOrId: string): Promise<Project | null> {
    this.ensureInitialized();
    
    // Find project data using appropriate method
    const result = isValidUUID(projectNameOrId) 
      ? await findProjectByUUID(this.dataDir, projectNameOrId)
      : await findProjectByName(this.dataDir, projectNameOrId);
    
    if (!result) {
      return null;
    }
    
    // For consistent project stats, use the lock to read/update if needed
    const { projectId } = result;
    return this.withProjectLock(projectId, async (data) => {
      const updatedProject = this.updateProjectStats(data.project, data.tasks);
      
      // Update the project with current stats if needed
      const needsUpdate = JSON.stringify(updatedProject.stats) !== JSON.stringify(data.project.stats);
      
      if (needsUpdate) {
        const newData = {
          ...data,
          project: updatedProject
        };
        return { data: newData, result: updatedProject };
      } else {
        return { data, result: updatedProject };
      }
    });
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

  async getProjectByNameOrId(nameOrId: string): Promise<Project | null> {
    return this.getProject(nameOrId);
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
        logger.trace('Failed to read project file', {
          operation: 'listProjects',
          filePath,
          error: error instanceof Error ? error.message : String(error)
        });
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

  async getTaskTypeByNameOrId(projectNameOrId: string, nameOrId: string): Promise<TaskType | null> {
    this.ensureInitialized();
    
    // First resolve the project, then search by name or id within the project
    const project = await this.getProjectByNameOrId(projectNameOrId);
    if (!project) {
      return null;
    }
    
    const taskTypes = await this.listTaskTypes(project.id);
    return taskTypes.find(tt => tt.id === nameOrId || tt.name === nameOrId) || null;
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
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file', {
            operation: 'updateTaskType',
            error: error.message
          });
        }
      }
    }
    
    throw new Error(`Task type ${typeId} not found`);
  }

  async listTaskTypes(projectId: string): Promise<TaskType[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      return data.taskTypes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
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
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file', {
            operation: 'deleteTaskType',
            error: error.message
          });
        }
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

      // Generate or validate task ID
      let taskId: string;
      if (input.id) {
        // Check if custom ID already exists
        const existingTask = data.tasks.find(t => t.id === input.id);
        if (existingTask) {
          throw new Error(`Task with ID '${input.id}' already exists in this project`);
        }
        taskId = input.id;
      } else {
        // Generate sequential ID like 'task-1', 'task-2', etc.
        let counter = 1;
        do {
          taskId = `task-${counter}`;
          counter++;
        } while (data.tasks.find(t => t.id === taskId));
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

      data.tasks.push(task);
      
      return {
        data,
        result: task,
      };
    });
  }

  // We'll continue with the rest of the methods...
  // This is getting quite long, so I'll implement the critical atomic operations next

  // CRITICAL: Lease-based task assignment for ephemeral agents
  async getNextTask(projectId: string, agentName?: string): Promise<TaskAssignmentResult> {
    return this.withProjectLock<TaskAssignmentResult>(projectId, async (data) => {
      const now = new Date();
      
      // Generate agent name if not provided
      const finalAgentName = agentName || `agent-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // First, reclaim any expired leases
      const expiredTasks = data.tasks.filter(t => 
        t.status === 'running' && 
        t.leaseExpiresAt && 
        t.leaseExpiresAt.getTime() <= now.getTime()
      );
      
      let reclaimedCount = 0;
      const reclaimedAgents = new Set<string>();
      
      for (const expiredTask of expiredTasks) {
        // Track agent before clearing
        if (expiredTask.assignedTo) {
          reclaimedAgents.add(expiredTask.assignedTo);
        }
        
        // Reset task to queued state
        expiredTask.status = 'queued';
        expiredTask.assignedTo = undefined;
        expiredTask.assignedAt = undefined;
        expiredTask.leaseExpiresAt = undefined;
        
        reclaimedCount++;
      }
      
      // Log reclaimed tasks
      if (reclaimedCount > 0) {
        logger.info(`Reclaimed ${reclaimedCount} expired tasks for project ${projectId}`, {
          projectId,
          reclaimedTasks: reclaimedCount,
          cleanedAgents: reclaimedAgents.size
        });
      }
      
      // If agent name was provided, check if they have an existing running task
      if (agentName) {
        const existingTask = data.tasks.find(t => 
          t.assignedTo === agentName && 
          t.status === 'running' && 
          t.leaseExpiresAt && 
          t.leaseExpiresAt.getTime() > now.getTime()
        );
        
        if (existingTask) {
          // Resume existing task
          return {
            data,
            result: {
              task: existingTask,
              agentName: finalAgentName
            }
          };
        }
      }
      
      // Find first queued task that hasn't exceeded retry limits
      const queuedTasks = data.tasks.filter(t => t.status === 'queued');
      logger.trace('Checking available queued tasks', {
        operation: 'getNextTask',
        projectId,
        agentName: finalAgentName,
        queuedTasksCount: queuedTasks.length,
        queuedTasks: queuedTasks.map(t => ({
          id: t.id,
          retryCount: t.retryCount,
          maxRetries: t.maxRetries,
          canAssign: t.retryCount <= t.maxRetries
        }))
      });
      
      const taskIndex = data.tasks.findIndex(t => 
        t.status === 'queued' && t.retryCount <= t.maxRetries
      );
      
      if (taskIndex === -1) {
        // No tasks available
        return {
          data,
          result: {
            task: null,
            agentName: finalAgentName
          }
        };
      }

      const task = data.tasks[taskIndex];
      if (!task) {
        return {
          data,
          result: {
            task: null,
            agentName: finalAgentName
          }
        };
      }
      
      logger.trace('Agent attempting task assignment', {
        operation: 'getNextTask',
        projectId,
        agentName: finalAgentName,
        taskId: task.id,
        taskIndex,
        taskStatus: task.status,
        currentQueuedTasks: data.tasks.filter(t => t.status === 'queued').length
      });
      
      // Double-check the task is still queued (race condition prevention)
      if (task.status !== 'queued') {
        logger.trace('Task status changed during assignment', {
          operation: 'getNextTask',
          projectId,
          agentName: finalAgentName,
          taskId: task.id,
          newStatus: task.status,
          warning: 'race_condition_prevented'
        });
        return {
          data,
          result: {
            task: null,
            agentName: finalAgentName
          }
        };
      }
      
      const taskType = data.taskTypes.find(tt => tt.id === task.typeId);
      if (!taskType) {
        throw new Error(`Task type ${task.typeId} not found`);
      }

      // Update task to running state with lease
      const leaseExpiresAt = new Date(now.getTime() + taskType.leaseDurationMinutes * 60 * 1000);
      
      const attempt: TaskAttempt = {
        id: uuidv4(),
        agentName: finalAgentName,
        startedAt: now,
        status: 'running',
        leaseExpiresAt,
      };

      const updatedTask: Task = {
        ...task,
        status: 'running' as const,
        assignedTo: finalAgentName,
        leaseExpiresAt,
        assignedAt: now,
        attempts: [...task.attempts, attempt],
      };

      data.tasks[taskIndex] = updatedTask;
      
      logger.trace('Task assignment successful', {
        operation: 'getNextTask',
        projectId,
        agentName: finalAgentName,
        taskId: updatedTask.id,
        taskStatus: updatedTask.status,
        remainingQueuedTasks: data.tasks.filter(t => t.status === 'queued').length
      });
      
      return {
        data,
        result: {
          task: updatedTask,
          agentName: finalAgentName
        }
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
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file', {
            operation: 'getTask',
            error: error.message
          });
        }
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
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file during updateTask', {
            operation: 'updateTask',
            error: error.message
          });
        }
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      let tasks = [...data.tasks];
      
      // Create a map of typeId to typeName for efficient lookup
      const taskTypeMap = new Map<string, string>();
      for (const taskType of data.taskTypes) {
        taskTypeMap.set(taskType.id, taskType.name);
      }
      
      // Add typeName to each task
      tasks = tasks.map(task => ({
        ...task,
        typeName: taskTypeMap.get(task.typeId)
      }));
      
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
      
      // Sort by creation date (oldest first - FIFO)
      tasks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      
      // Apply pagination only if limit is specified
      if (filters?.limit !== undefined || filters?.offset !== undefined) {
        const offset = filters?.offset || 0;
        const limit = filters?.limit || 100;
        return tasks.slice(offset, offset + limit);
      }
      
      // Return all tasks if no pagination specified
      return tasks;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  async deleteTask(_taskId: string): Promise<void> {
    logger.trace('Task deletion not implemented for file storage', {
      operation: 'deleteTask'
    });
    throw new Error('Method not implemented');
  }

  // Lease-based agent operations (agents are ephemeral queue workers)

  async listActiveAgents(projectId: string): Promise<AgentStatus[]> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      const now = new Date();
      
      // Find all tasks currently assigned to agents with active leases
      const agentMap = new Map<string, AgentStatus>();
      
      for (const task of data.tasks) {
        if (task.status === 'running' && task.assignedTo && task.leaseExpiresAt && task.leaseExpiresAt.getTime() > now.getTime()) {
          if (!agentMap.has(task.assignedTo)) {
            agentMap.set(task.assignedTo, {
              name: task.assignedTo,
              projectId: projectId,
              status: 'working',
              currentTaskId: task.id,
              assignedAt: task.assignedAt || new Date(),
              leaseExpiresAt: task.leaseExpiresAt
            });
          }
        }
      }
      
      return Array.from(agentMap.values()).sort((a, b) => 
        (a.assignedAt?.getTime() || 0) - (b.assignedAt?.getTime() || 0)
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  async getAgentStatus(agentName: string, projectId: string): Promise<AgentStatus | null> {
    this.ensureInitialized();
    
    try {
      const data = await this.readProjectData(projectId);
      const now = new Date();
      
      // Find the task currently assigned to this agent
      const activeTask = data.tasks.find(t => 
        t.status === 'running' && 
        t.assignedTo === agentName && 
        t.leaseExpiresAt && 
        t.leaseExpiresAt.getTime() > now.getTime()
      );
      
      if (!activeTask) {
        return null; // Agent has no active lease
      }
      
      return {
        name: agentName,
        projectId: projectId,
        status: 'working',
        currentTaskId: activeTask.id,
        assignedAt: activeTask.assignedAt || new Date(),
        leaseExpiresAt: activeTask.leaseExpiresAt
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  // REMOVED DUPLICATE: extendLease implementation moved to line 1015

  async completeTask(taskId: string, agentName: string, result: TaskResult): Promise<void> {
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
              // Re-find the task index within the lock to avoid race conditions
              const currentTaskIndex = lockedData.tasks.findIndex(t => t.id === taskId);
              if (currentTaskIndex === -1) {
                throw new Error(`Task ${taskId} not found in locked project data`);
              }
              
              const task = lockedData.tasks[currentTaskIndex];
              if (!task) {
                throw new Error(`Task ${taskId} not found in project data`);
              }
              
              // Validate agent assignment
              if (task.assignedTo !== agentName) {
                throw new Error(`Task ${taskId} is not assigned to agent ${agentName}`);
              }

              if (task.status !== 'running') {
                throw new Error(`Task ${taskId} is not in running state`);
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
              
              lockedData.tasks[currentTaskIndex] = updatedTask;
              
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file', {
            operation: 'completeTask',
            error: error.message
          });
        }
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async failTask(taskId: string, agentName: string, result: TaskResult, canRetry: boolean = true): Promise<void> {
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
              // Re-find the task index within the lock to avoid race conditions
              const currentTaskIndex = lockedData.tasks.findIndex(t => t.id === taskId);
              if (currentTaskIndex === -1) {
                throw new Error(`Task ${taskId} not found in locked project data`);
              }
              
              const task = lockedData.tasks[currentTaskIndex];
              if (!task) {
                throw new Error(`Task ${taskId} not found in project data`);
              }
              
              // Validate agent assignment
              if (task.assignedTo !== agentName) {
                throw new Error(`Task ${taskId} is not assigned to agent ${agentName}`);
              }

              if (task.status !== 'running') {
                throw new Error(`Task ${taskId} is not in running state`);
              }
              
              const now = new Date();
              
              // Update the current attempt
              const currentAttempt = task.attempts[task.attempts.length - 1];
              if (currentAttempt) {
                currentAttempt.completedAt = now;
                currentAttempt.status = 'failed';
                currentAttempt.result = result;
              }
              
              // Determine if we should retry (check if new retry count won't exceed max retries)
              const newRetryCount = task.retryCount + 1;
              const shouldRetry = canRetry && newRetryCount <= task.maxRetries;
              
              logger.trace('Task retry logic evaluation', {
                operation: 'failTask',
                taskId,
                retryCount: task.retryCount,
                maxRetries: task.maxRetries,
                canRetry,
                shouldRetry,
                newRetryCount
              });
              
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
              
              lockedData.tasks[currentTaskIndex] = updatedTask;
              
              return { data: lockedData, result: undefined };
            });
            
            return;
          }
        }
      } catch (error) {
        // Skip corrupted files - log for debugging
        if (error instanceof Error) {
          logger.trace('Skipped corrupted project file', {
            operation: 'failTask',
            error: error.message
          });
        }
      }
    }
    
    throw new Error(`Task ${taskId} not found`);
  }

  async findExpiredLeases(): Promise<Task[]> {
    // Implementation needed
    throw new Error('Method not implemented');
  }

  async requeueTask(_taskId: string): Promise<void> {
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

  async countAvailableTasks(projectId: string): Promise<number> {
    this.ensureInitialized();
    
    const tasks = await this.listTasks(projectId);
    const now = new Date();
    
    return tasks.filter(task => 
      task.status === 'queued' || 
      (task.status === 'running' && task.leaseExpiresAt && task.leaseExpiresAt.getTime() < now.getTime())
    ).length;
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

  async getTaskHistory(_taskId: string): Promise<Task[]> {
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