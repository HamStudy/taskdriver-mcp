import { 
  Agent, 
  AgentCreateInput, 
  AgentUpdateInput,
  Task,
  TaskResult,
  TaskStatus,
  AgentStatus
} from '../types/index.js';
import { StorageProvider } from '../storage/index.js';
import { 
  validate, 
  createAgentSchema,
  agentNameSchema 
} from '../utils/validation.js';
import { generateApiKey, hashApiKey } from '../utils/index.js';
import { ProjectService } from './ProjectService.js';
import { TaskService } from './TaskService.js';

/**
 * Service for managing agents and their interactions with tasks
 */
export class AgentService {
  constructor(
    private storage: StorageProvider,
    private projectService: ProjectService,
    private taskService: TaskService
  ) {}

  /**
   * Register a new agent with a project
   */
  async registerAgent(input: AgentCreateInput): Promise<{ agent: Agent; apiKey: string }> {
    const validatedInput = validate(createAgentSchema, input);

    // Validate project exists and is active
    await this.projectService.validateProjectAccess(validatedInput.projectId);

    // Generate API key and hash for storage
    const apiKey = generateApiKey();
    const hashedApiKey = hashApiKey(apiKey);

    // Create agent with generated name if not provided
    const agentInput: AgentCreateInput = {
      ...validatedInput,
      name: validatedInput.name || `agent-${Date.now()}`,
      apiKeyHash: hashedApiKey,
    };

    const agent = await this.storage.createAgent(agentInput);

    return {
      agent,
      apiKey, // Return plain API key only once during registration
    };
  }

  /**
   * Authenticate an agent using their API key
   */
  async authenticateAgent(apiKey: string, projectId: string): Promise<Agent> {
    const hashedApiKey = hashApiKey(apiKey);
    const agent = await this.storage.getAgentByApiKey(hashedApiKey, projectId);
    
    if (!agent) {
      throw new Error('Invalid API key or agent not found');
    }

    if (agent.status === 'disabled') {
      throw new Error('Agent is disabled');
    }

    // Update last seen timestamp
    await this.storage.updateAgent(agent.id, { lastSeen: new Date() });

    return agent;
  }

  /**
   * Get the next available task for an agent
   */
  async getNextTask(agentName: string, projectId: string): Promise<Task | null> {
    // Validate agent exists and is active
    const agent = await this.validateAgent(agentName, projectId);
    
    if (agent.status !== 'idle' && agent.status !== 'working') {
      throw new Error(`Agent ${agentName} is not available for tasks (status: ${agent.status})`);
    }

    // Use the atomic assignTask operation from storage
    const task = await this.taskService.getNextTaskForAgent(projectId, agentName);
    
    if (task) {
      // Update agent status to working
      await this.storage.updateAgent(agent.id, { 
        status: 'working',
        lastSeen: new Date(),
        currentTaskId: task.id
      });
    }

    return task;
  }

  /**
   * Complete a task
   */
  async completeTask(
    agentName: string, 
    projectId: string, 
    taskId: string, 
    result: TaskResult
  ): Promise<void> {
    // Validate agent and task assignment
    const agent = await this.validateAgent(agentName, projectId);
    await this.taskService.validateTaskAssignment(taskId, agentName);

    // Complete the task
    await this.storage.completeTask(taskId, result);

    // Update agent status back to idle
    await this.storage.updateAgent(agent.id, { 
      status: 'idle',
      lastSeen: new Date(),
      currentTaskId: undefined
    });
  }

  /**
   * Fail a task
   */
  async failTask(
    agentName: string, 
    projectId: string, 
    taskId: string, 
    result: TaskResult,
    canRetry: boolean = true
  ): Promise<void> {
    // Validate agent and task assignment
    const agent = await this.validateAgent(agentName, projectId);
    await this.taskService.validateTaskAssignment(taskId, agentName);

    // Fail the task
    await this.storage.failTask(taskId, result, canRetry);

    // Update agent status back to idle
    await this.storage.updateAgent(agent.id, { 
      status: 'idle',
      lastSeen: new Date(),
      currentTaskId: undefined
    });
  }

  /**
   * Extend the lease on a task (for long-running tasks)
   */
  async extendTaskLease(
    agentName: string, 
    projectId: string, 
    taskId: string, 
    extensionMinutes: number = 30
  ): Promise<void> {
    // Validate agent and task assignment
    const agent = await this.validateAgent(agentName, projectId);
    const task = await this.taskService.validateTaskAssignment(taskId, agentName);

    if (!task.leaseExpiresAt) {
      throw new Error(`Task ${taskId} does not have an active lease`);
    }

    // Extend the lease
    const newLeaseExpiry = new Date(Date.now() + extensionMinutes * 60 * 1000);
    await this.storage.updateTask(taskId, { leaseExpiresAt: newLeaseExpiry });

    // Update agent's last seen
    await this.storage.updateAgent(agent.id, { lastSeen: new Date() });
  }

  /**
   * Get agent status and current task
   */
  async getAgentStatus(agentName: string, projectId: string): Promise<Agent> {
    return this.validateAgent(agentName, projectId);
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(
    agentName: string, 
    projectId: string, 
    status: AgentStatus
  ): Promise<Agent> {
    const agent = await this.validateAgent(agentName, projectId);
    
    return this.storage.updateAgent(agent.id, { 
      status,
      lastSeen: new Date()
    });
  }

  /**
   * List all agents for a project
   */
  async listAgents(projectId: string): Promise<Agent[]> {
    // Validate project exists
    await this.projectService.validateProjectAccess(projectId);
    
    return this.storage.listAgents(projectId);
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Agent | null> {
    return this.storage.getAgent(agentId);
  }

  /**
   * Update agent configuration
   */
  async updateAgent(agentId: string, input: AgentUpdateInput): Promise<Agent> {
    const agent = await this.storage.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Validate project is still active
    await this.projectService.validateProjectAccess(agent.projectId);

    // Validate new name if provided
    if (input.name) {
      validate(agentNameSchema, input.name);
      
      // Check for duplicate names within the project
      const existingAgents = await this.storage.listAgents(agent.projectId);
      const duplicate = existingAgents.find(a => a.name === input.name && a.id !== agentId);
      if (duplicate) {
        throw new Error(`Agent with name '${input.name}' already exists in project`);
      }
    }

    return this.storage.updateAgent(agentId, input);
  }

  /**
   * Disable an agent
   */
  async disableAgent(agentId: string): Promise<Agent> {
    const agent = await this.storage.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status === 'working' && agent.currentTaskId) {
      throw new Error(`Cannot disable agent ${agentId}: agent is currently working on task ${agent.currentTaskId}`);
    }

    return this.storage.updateAgent(agentId, { status: 'disabled' });
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    const agent = await this.storage.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status === 'working' && agent.currentTaskId) {
      throw new Error(`Cannot delete agent ${agentId}: agent is currently working on task ${agent.currentTaskId}`);
    }

    return this.storage.deleteAgent(agentId);
  }

  /**
   * Validate that an agent exists and belongs to the specified project
   */
  private async validateAgent(agentName: string, projectId: string): Promise<Agent> {
    const agent = await this.storage.getAgentByName(agentName, projectId);
    if (!agent) {
      throw new Error(`Agent ${agentName} not found in project ${projectId}`);
    }

    if (agent.status === 'disabled') {
      throw new Error(`Agent ${agentName} is disabled`);
    }

    return agent;
  }
}