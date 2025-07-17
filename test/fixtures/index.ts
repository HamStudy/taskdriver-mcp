import { v4 as uuidv4 } from 'uuid';
import {
  Project,
  ProjectCreateInput,
  Task,
  TaskCreateInput,
  TaskType,
  TaskTypeCreateInput,
  Agent,
  AgentCreateInput,
  TaskResult,
  TaskAttempt
} from '../../src/types/index.js';

export const createMockProject = (overrides?: Partial<Project>): Project => {
  const id = uuidv4();
  return {
    id,
    name: 'test-project',
    description: 'A test project',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    config: {
      defaultMaxRetries: 3,
      defaultLeaseDurationMinutes: 10,
    },
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      queuedTasks: 0,
      runningTasks: 0,
    },
    ...overrides,
  };
};

export const createMockProjectInput = (overrides?: Partial<ProjectCreateInput>): ProjectCreateInput => {
  return {
    name: 'test-project',
    description: 'A test project',
    config: {
      defaultMaxRetries: 3,
      defaultLeaseDurationMinutes: 10,
    },
    ...overrides,
  };
};

export const createMockTaskType = (overrides?: Partial<TaskType>): TaskType => {
  const id = uuidv4();
  const projectId = uuidv4();
  return {
    id,
    name: 'test-task-type',
    projectId,
    template: 'Execute {{action}} on {{target}}',
    variables: ['action', 'target'],
    duplicateHandling: 'allow',
    maxRetries: 3,
    leaseDurationMinutes: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

export const createMockTaskTypeInput = (overrides?: Partial<TaskTypeCreateInput>): TaskTypeCreateInput => {
  const projectId = uuidv4();
  return {
    name: 'test-task-type',
    projectId,
    template: 'Execute {{action}} on {{target}}',
    variables: ['action', 'target'],
    duplicateHandling: 'allow',
    maxRetries: 3,
    leaseDurationMinutes: 10,
    ...overrides,
  };
};

export const createMockTask = (overrides?: Partial<Task>): Task => {
  const id = uuidv4();
  const projectId = uuidv4();
  const typeId = uuidv4();
  return {
    id,
    projectId,
    typeId,
    instructions: 'Complete this task',
    variables: { action: 'test', target: 'system' },
    status: 'queued',
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date(),
    attempts: [],
    ...overrides,
  };
};

export const createMockTaskInput = (overrides?: Partial<TaskCreateInput>): TaskCreateInput => {
  const projectId = uuidv4();
  const typeId = uuidv4();
  return {
    projectId,
    typeId,
    instructions: 'Complete this task',
    variables: { action: 'test', target: 'system' },
    ...overrides,
  };
};

export const createMockAgent = (overrides?: Partial<Agent>): Agent => {
  const id = uuidv4();
  const projectId = uuidv4();
  return {
    id,
    name: 'test-agent',
    projectId,
    status: 'idle',
    apiKeyHash: 'hashed-api-key',
    lastSeen: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
};

export const createMockAgentInput = (overrides?: Partial<AgentCreateInput>): AgentCreateInput => {
  const projectId = uuidv4();
  return {
    name: 'test-agent',
    projectId,
    ...overrides,
  };
};

export const createMockTaskResult = (overrides?: Partial<TaskResult>): TaskResult => {
  return {
    success: true,
    output: 'Task completed successfully',
    explanation: 'Task was executed without errors',
    duration: 1000,
    metadata: { processedAt: new Date().toISOString() },
    ...overrides,
  };
};

export const createMockTaskAttempt = (overrides?: Partial<TaskAttempt>): TaskAttempt => {
  const id = uuidv4();
  return {
    id,
    agentName: 'test-agent',
    startedAt: new Date(),
    status: 'running',
    leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
    ...overrides,
  };
};

export const createMockFailedTaskResult = (overrides?: Partial<TaskResult>): TaskResult => {
  return {
    success: false,
    error: 'Task failed to execute',
    explanation: 'An error occurred during task execution',
    duration: 500,
    metadata: { failedAt: new Date().toISOString() },
    canRetry: true,
    ...overrides,
  };
};

// Helper function to create a complete project hierarchy
export const createMockProjectHierarchy = () => {
  const project = createMockProject();
  const taskType = createMockTaskType({ projectId: project.id });
  const agent = createMockAgent({ projectId: project.id });
  const task = createMockTask({ 
    projectId: project.id, 
    typeId: taskType.id 
  });
  
  return {
    project,
    taskType,
    agent,
    task,
  };
};

// Helper function to create a running task with attempt
export const createMockRunningTask = (agentName: string = 'test-agent'): Task => {
  const task = createMockTask({ status: 'running', assignedTo: agentName });
  const attempt = createMockTaskAttempt({ agentName });
  task.attempts = [attempt];
  task.leaseExpiresAt = attempt.leaseExpiresAt;
  task.assignedAt = attempt.startedAt;
  
  return task;
};

// Helper function to create a completed task
export const createMockCompletedTask = (agentName: string = 'test-agent'): Task => {
  const task = createMockTask({ 
    status: 'completed', 
    completedAt: new Date(),
    result: createMockTaskResult() 
  });
  const attempt = createMockTaskAttempt({ 
    agentName, 
    status: 'completed',
    completedAt: new Date(),
    result: createMockTaskResult()
  });
  task.attempts = [attempt];
  
  return task;
};

// Helper function to create a failed task
export const createMockFailedTask = (agentName: string = 'test-agent'): Task => {
  const task = createMockTask({ 
    status: 'failed', 
    failedAt: new Date(),
    result: createMockFailedTaskResult(),
    retryCount: 1
  });
  const attempt = createMockTaskAttempt({ 
    agentName, 
    status: 'failed',
    completedAt: new Date(),
    result: createMockFailedTaskResult()
  });
  task.attempts = [attempt];
  
  return task;
};

// Helper function to create test data directories
export const createTestDataDir = (suffix: string = ''): string => {
  const testDir = `/tmp/taskdriver-test-${Date.now()}${suffix}`;
  return testDir;
};

// Helper function to wait for a certain time (useful for testing time-based operations)
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Helper function to create expired task
export const createMockExpiredTask = (agentName: string = 'test-agent'): Task => {
  const expiredTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
  const task = createMockTask({ 
    status: 'running', 
    assignedTo: agentName,
    leaseExpiresAt: expiredTime,
    assignedAt: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
  });
  const attempt = createMockTaskAttempt({ 
    agentName, 
    leaseExpiresAt: expiredTime,
    startedAt: new Date(Date.now() - 10 * 60 * 1000)
  });
  task.attempts = [attempt];
  
  return task;
};