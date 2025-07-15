/**
 * Types for unified command definition system
 */

import { StorageProvider } from '../storage/StorageProvider.js';
import { ProjectService } from '../services/ProjectService.js';
import { TaskService } from '../services/TaskService.js';
import { TaskTypeService } from '../services/TaskTypeService.js';
import { AgentService } from '../services/AgentService.js';
import { LeaseService } from '../services/LeaseService.js';

// Service context for command handlers
export interface ServiceContext {
  storage: StorageProvider;
  project: ProjectService;
  task: TaskService;
  taskType: TaskTypeService;
  agent: AgentService;
  lease: LeaseService;
}

// Parameter definition for commands with type inference support
export interface CommandParameter {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'array';
  readonly description: string;
  readonly required?: boolean;
  readonly default?: any;
  readonly choices?: readonly string[];
  readonly alias?: string | readonly string[];
  readonly positional?: boolean;
  readonly validation?: any; // Joi schema
}

// Type inference magic - extract argument types from parameter definitions
type ParameterType<T extends CommandParameter> = 
  T['type'] extends 'string' ? 
    T['choices'] extends readonly string[] ? T['choices'][number] : string :
  T['type'] extends 'number' ? number :
  T['type'] extends 'boolean' ? boolean :
  T['type'] extends 'array' ? string[] :
  never;

type ParameterValue<T extends CommandParameter> = 
  T['required'] extends true ? ParameterType<T> :
  T['default'] extends undefined ? ParameterType<T> | undefined :
  ParameterType<T>;

// Convert parameter array to argument object type
export type InferArgs<T extends readonly CommandParameter[]> = {
  [K in T[number] as K['name']]: ParameterValue<K>
};

// Command definition interface with type inference
export interface CommandDefinition<T extends readonly CommandParameter[] = readonly CommandParameter[]> {
  // Identity
  name: string;
  mcpName: string;      // MCP tool name (with underscores)
  cliName: string;      // CLI command name (with dashes)
  description: string;
  
  // Parameters
  parameters: T;
  
  // Handler function with inferred argument types
  handler: (context: ServiceContext, args: InferArgs<T>) => Promise<CommandResult>;
  
  // Optional metadata
  examples?: string[];
  notes?: string;
  
  // Enhanced discoverability metadata for LLM agents
  discoverability?: ToolDiscoverability;
}

// Result format for consistent output
export interface CommandResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

// Enhanced discoverability metadata for LLM agents
export interface ToolDiscoverability {
  /** Keywords that should trigger consideration of this tool */
  triggerKeywords: string[];
  /** Common user intent patterns that map to this tool */
  userIntentPatterns: string[];
  /** When to use this tool (context and conditions) */
  useWhen: string[];
  /** What typically comes before this tool in workflows */
  typicalPredecessors: string[];
  /** What typically comes after this tool in workflows */
  typicalSuccessors: string[];
  /** Common workflow patterns this tool participates in */
  workflowPatterns: string[];
  /** Prerequisites that must be met before using this tool */
  prerequisites: string[];
  /** What the tool returns and how to interpret results */
  expectedOutcomes: string[];
  /** Common error conditions and how to handle them */
  errorGuidance: string[];
  /** Anti-patterns - when NOT to use this tool */
  antiPatterns: string[];
}