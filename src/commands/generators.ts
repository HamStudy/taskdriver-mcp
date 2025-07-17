/**
 * Generators for MCP tools and CLI commands from command definitions
 */

import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { formatCommandResult, OutputFormat } from './formatters.js';
import { GenericCommandDefinition } from './index.js';
import { CommandDefinition, ServiceContext } from './types.js';
import { logger } from '../utils/logger.js';

// Type guards for error handling
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

function getErrorMessage(error: unknown): string {
  if (isError(error)) {
    return error.message;
  }
  return String(error);
}

function getErrorStack(error: unknown): string | undefined {
  if (isError(error)) {
    return error.stack;
  }
  return undefined;
}

function logUnexpectedError(error: unknown, context: string): void {
  const stack = getErrorStack(error);
  
  logger.error(`Unexpected error in ${context}`, {
    errorMessage: getErrorMessage(error),
    stack
  });
}

// Type definitions for CLI and MCP args
interface CliArgs {
  [key: string]: unknown;
  format?: OutputFormat;
}

interface McpArgs {
  [key: string]: unknown;
  format?: OutputFormat;
}

interface YargsCommandBuilder {
  option: (name: string, config: YargsOptionConfig) => YargsCommandBuilder;
  positional: (name: string, config: YargsPositionalConfig) => YargsCommandBuilder;
}

interface YargsOptionConfig {
  type: 'string' | 'number' | 'boolean' | 'array';
  describe: string;
  alias?: string | string[] | readonly string[];
  default?: unknown;
  choices?: string[] | readonly string[];
}

interface YargsPositionalConfig {
  describe: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  default?: unknown;
  choices?: string[] | readonly string[];
}

interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[] | readonly string[];
  default?: unknown;
  items?: { type: string };
}

/**
 * Generate MCP tool from command definition
 */
export function generateMcpTool(def: CommandDefinition): Tool {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  // Add format parameter to all MCP tools
  properties.format = {
    type: 'string',
    description: 'Output format (human-readable text or JSON)',
    enum: ['human', 'json'],
    default: 'human'
  };

  for (const param of def.parameters) {
    const schema: JsonSchemaProperty = {
      type: 'string', // default, will be overridden below
      description: param.description
    };

    // Map types
    switch (param.type) {
      case 'string':
        schema.type = 'string';
        break;
      case 'number':
        schema.type = 'number';
        break;
      case 'boolean':
        schema.type = 'boolean';
        break;
      case 'array':
        schema.type = 'array';
        schema.items = { type: 'string' };
        break;
    }

    // Add choices as enum
    if (param.choices) {
      schema.enum = Array.isArray(param.choices) ? [...param.choices] : param.choices;
    }

    // Add default value
    if (param.default !== undefined) {
      schema.default = param.default;
    }

    properties[param.name] = schema;

    // Mark as required if specified
    if (param.required) {
      required.push(param.name);
    }
  }

  // Generate enhanced description with discoverability context
  const enhancedDescription = generateEnhancedDescription(def);

  return {
    name: def.mcpName,
    description: enhancedDescription,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    }
  };
}

/**
 * Generate enhanced description with LLM agent discoverability hints
 */
function generateEnhancedDescription(def: CommandDefinition): string {
  let description = def.description;

  // Add discoverability metadata if available
  if (def.discoverability) {
    const disc = def.discoverability;
    
    // Add trigger keywords
    if (disc.triggerKeywords?.length > 0) {
      description += `\n\n🔍 KEYWORDS: ${disc.triggerKeywords.join(', ')}`;
    }
    
    // Add usage context
    if (disc.useWhen?.length > 0) {
      description += `\n\n📋 USE WHEN: ${disc.useWhen.join(' | ')}`;
    }
    
    // Add workflow context
    if (disc.typicalPredecessors?.length > 0) {
      description += `\n\n⬅️ TYPICALLY AFTER: ${disc.typicalPredecessors.join(', ')}`;
    }
    
    if (disc.typicalSuccessors?.length > 0) {
      description += `\n\n➡️ TYPICALLY BEFORE: ${disc.typicalSuccessors.join(', ')}`;
    }
    
    // Add prerequisites
    if (disc.prerequisites?.length > 0) {
      description += `\n\n✅ PREREQUISITES: ${disc.prerequisites.join(' | ')}`;
    }
    
    // Add expected outcomes
    if (disc.expectedOutcomes?.length > 0) {
      description += `\n\n📤 RETURNS: ${disc.expectedOutcomes.join(' | ')}`;
    }
    
    // Add anti-patterns
    if (disc.antiPatterns?.length > 0) {
      description += `\n\n❌ AVOID WHEN: ${disc.antiPatterns.join(' | ')}`;
    }
  }

  return description;
}

/**
 * Generate CLI command configuration from command definition
 */
export function generateCliCommand(def: CommandDefinition) {
  // Build yargs command string with positional parameters
  const positionalParams = def.parameters.filter(p => p.positional);
  const commandParts = [def.cliName];
  
  for (const param of positionalParams) {
    if (param.required) {
      commandParts.push(`<${param.name}>`);
    } else {
      commandParts.push(`[${param.name}]`);
    }
  }

  const command = commandParts.join(' ');

  // Builder function for yargs
  const builder = (yargs: YargsCommandBuilder) => {
    let result = yargs;

    // Add global format option for all commands
    result = result.option('format', {
      type: 'string',
      describe: 'Output format',
      choices: ['human', 'json'],
      default: 'human',
      alias: 'f'
    });

    for (const param of def.parameters) {
      if (param.positional) {
        // Handle positional parameters
        result = result.positional(param.name, {
          describe: param.description,
          type: param.type === 'number' ? 'number' : 
                param.type === 'boolean' ? 'boolean' :
                param.type === 'array' ? 'array' : 'string',
          ...(param.default !== undefined && { default: param.default }),
          ...(param.choices && { choices: param.choices })
        });
      } else {
        // Handle option parameters
        const optionConfig: YargsOptionConfig = {
          type: param.type === 'number' ? 'number' : 
                param.type === 'boolean' ? 'boolean' :
                param.type === 'array' ? 'array' : 'string',
          describe: param.description,
          ...(param.alias && { alias: param.alias }),
          ...(param.default !== undefined && { default: param.default }),
          ...(param.choices && { choices: param.choices })
        };

        result = result.option(param.name, optionConfig);
      }
    }

    return result;
  };

  return {
    command,
    describe: def.description,
    builder
  };
}

/**
 * Generate CLI handler from command definition
 */
export function generateCliHandler<DEF extends GenericCommandDefinition>(def: DEF, context: ServiceContext) {
  return async (argv: CliArgs) => {
    try {
      // Extract format option
      const format = (argv.format || 'human') as OutputFormat;
      
      // Pre-process arguments for CLI-specific needs
      const processedArgs = { ...argv };
      delete processedArgs.format; // Remove format from args passed to handler
      
      // Handle file reading for parameters that might use @file syntax
      for (const param of def.parameters) {
        if (param.type === 'string' && processedArgs[param.name] && typeof processedArgs[param.name] === 'string') {
          const value = processedArgs[param.name] as string;
          if (value.startsWith('@')) {
            // Handle file reading for CLI
            try {
              const { readContentFromFileOrValue } = await import('./utils.js');
              processedArgs[param.name] = readContentFromFileOrValue(value);
            } catch (error: unknown) {
              logUnexpectedError(error, 'CLI file reading');
              const formatted = formatCommandResult(
                { success: false, error: `Failed to read file for ${param.name}: ${getErrorMessage(error)}` },
                def.cliName,
                format,
                processedArgs
              );
              console.error(formatted.text);
              process.exit(1);
            }
          }
        }
      }
      
      const result = await def.handler(context, processedArgs as any);
      
      // Format and display result
      const formatted = formatCommandResult(result, def.cliName, format, processedArgs);
      
      if (formatted.text) {
        if (formatted.exitCode === 0) {
          console.log(formatted.text);
        } else {
          console.error(formatted.text);
        }
      }
      
      process.exit(formatted.exitCode);
    } catch (error: unknown) {
      logUnexpectedError(error, 'CLI handler execution');
      const formatted = formatCommandResult(
        { success: false, error: getErrorMessage(error) },
        def.cliName,
        argv.format || 'human',
        argv
      );
      console.error(formatted.text);
      process.exit(1);
    }
  };
}

/**
 * Generate MCP handler from command definition
 */
export function generateMcpHandler<DEF extends GenericCommandDefinition>(def: DEF, context: ServiceContext) {
  return async (args: McpArgs): Promise<CallToolResult> => {
    try {
      // Extract format parameter (default to 'json' for MCP tools)
      const format = (args.format || 'json') as OutputFormat;
      
      // Remove format from args passed to handler
      const handlerArgs = { ...args };
      delete handlerArgs.format;
      
      const result = await def.handler(context, handlerArgs as any);
      
      // Format output based on requested format
      if (format === 'json') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }
          ],
          isError: !result.success
        };
      } else {
        // Use human-readable formatter
        const formatted = formatCommandResult(result, def.mcpName, 'human', handlerArgs);
        return {
          content: [
            {
              type: 'text' as const,
              text: formatted.text
            }
          ],
          isError: formatted.exitCode !== 0
        };
      }
    } catch (error: unknown) {
      logUnexpectedError(error, 'MCP handler execution');
      // Extract format for error formatting
      const format = (args.format || 'json') as OutputFormat;
      const errorResult = {
        success: false,
        error: getErrorMessage(error)
      };
      
      if (format === 'json') {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorResult, null, 2)
            }
          ],
          isError: true
        };
      } else {
        // Use human-readable formatter for errors
        const formatted = formatCommandResult(errorResult, def.mcpName, 'human', args);
        return {
          content: [
            {
              type: 'text' as const,
              text: formatted.text
            }
          ],
          isError: true
        };
      }
    }
  };
}