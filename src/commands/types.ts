/**
 * Types for unified command definition system
 */

import { StorageProvider } from '../storage/StorageProvider.js';
import { ProjectService } from '../services/ProjectService.js';
import { TaskService } from '../services/TaskService.js';
import { TaskTypeService } from '../services/TaskTypeService.js';
import { AgentService } from '../services/AgentService.js';
import { LeaseService } from '../services/LeaseService.js';

type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}` ?
  `${T extends Capitalize<T> ? "_" : ""}${Lowercase<T>}${CamelToSnakeCase<U>}` :
  S;
type CamelToKebabCase<S extends string> = S extends `${infer T}${infer U}` ?
  `${T extends Capitalize<T> ? "-" : ""}${Lowercase<T>}${CamelToKebabCase<U>}` :
  S;

export type PromisedReturnType<T extends (...args: any[]) => any> =
  T extends (...args: any[]) => Promise<infer R> ? R :
  T extends (...args: any[]) => infer R ? R :
  never;

// Service context for command handlers
export interface ServiceContext {
  storage: StorageProvider;
  project: ProjectService;
  task: TaskService;
  taskType: TaskTypeService;
  agent: AgentService;
  lease: LeaseService;
}

type CommandParameterTypes = 'string' | 'number' | 'boolean' | 'array';
// Parameter definition for commands with type inference support
export interface CommandParameter<T extends CommandParameterTypes = CommandParameterTypes> {
  readonly name: string;
  readonly type: T;
  readonly description: string;
  readonly required?: boolean;
  readonly default?: ParameterFromName<T>;
  readonly choices?: readonly string[];
  readonly alias?: string | readonly string[];
  readonly positional?: boolean;
  readonly validation?: any; // Joi schema
}

type ParameterFromName<T extends CommandParameterTypes> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  T extends 'array' ? string[] :
  never;

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
} & { verbose?: boolean }; // Optional verbose flag for all commands

// Command definition interface with type inference
export interface CommandDefinition<T extends readonly CommandParameter[] = readonly CommandParameter[], R extends CommandResult<Record<string, unknown> | Record<string, unknown>[]> = CommandResult<any>, NAME extends string = string> {
  // Identity
  name: NAME;
  mcpName: CamelToSnakeCase<NAME>;      // MCP tool name (with underscores)
  cliName: CamelToKebabCase<NAME>;      // CLI command name (with dashes)
  description: string;
  
  // Parameters
  parameters: T;
  
  // Return data type for formatters
  returnDataType: 'single' | 'list' | 'stats' | 'health' | 'generic';
  
  // Handler function with inferred argument types
  handler(context: ServiceContext, args: InferArgs<T>): Promise<R>;
  
  // Formatting functions for CLI output
  formatResult(result: R, args: InferArgs<T>): string;

  // Optional metadata
  examples?: string[];
  notes?: string;
  
  // Enhanced discoverability metadata for LLM agents
  discoverability?: ToolDiscoverability;
}

// Generic function to define commands with full type inference
export function defineCommand<T extends readonly CommandParameter[], R extends CommandResult<any>, NAME extends string>(
  definition: CommandDefinition<T, R, NAME>
): CommandDefinition<T, R, NAME> {
  return definition;
}

// Type utilities to extract command info from defined commands
export type ExtractCommandName<T> = T extends CommandDefinition<infer P> ? T['name'] : never;
export type ExtractMcpName<T> = T extends CommandDefinition<infer P> ? T['mcpName'] : never;
export type ExtractCliName<T> = T extends CommandDefinition<infer P> ? T['cliName'] : never;
export type ExtractReturnDataType<T> = T extends CommandDefinition<infer P> ? T['returnDataType'] : never;
export type ExtractParameters<T> = T extends CommandDefinition<infer P> ? P : never;

// Result format for consistent output
export interface CommandResult<T = any> {
  success: boolean;
  agentName?: string; // Name of agent that handled the command
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    total: number;
    offset: number;
    limit: number;
    rangeStart: number;
    rangeEnd: number;
    hasMore: boolean;
  };
}

export type TaskTypes<T extends CommandDefinition> = {
  name: T['name'];
  mcpName: T['mcpName'];
  cliName: T['cliName'];
  args: InferArgs<T['parameters']>;
  returnType: PromisedReturnType<T['handler']>;
  def: T;
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