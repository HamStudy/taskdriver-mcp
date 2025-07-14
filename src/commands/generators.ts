/**
 * Generators for MCP tools and CLI commands from command definitions
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CommandDefinition, CommandParameter, ServiceContext } from './types.js';
import { formatCommandResult, OutputFormat } from './formatters.js';

/**
 * Generate MCP tool from command definition
 */
export function generateMcpTool(def: CommandDefinition): Tool {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of def.parameters) {
    const schema: any = {
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
      schema.enum = param.choices;
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

  return {
    name: def.mcpName,
    description: def.description,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    }
  };
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
  const builder = (yargs: any) => {
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
        const optionConfig: any = {
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
export function generateCliHandler(def: CommandDefinition, context: ServiceContext) {
  return async (argv: any) => {
    try {
      // Extract format option
      const format = (argv.format || 'human') as OutputFormat;
      
      // Pre-process arguments for CLI-specific needs
      const processedArgs = { ...argv };
      delete processedArgs.format; // Remove format from args passed to handler
      
      // Handle file reading for parameters that might use @file syntax
      for (const param of def.parameters) {
        if (param.type === 'string' && processedArgs[param.name] && typeof processedArgs[param.name] === 'string') {
          const value = processedArgs[param.name];
          if (value.startsWith('@')) {
            // Handle file reading for CLI
            try {
              const { readContentFromFileOrValue } = await import('./utils.js');
              processedArgs[param.name] = readContentFromFileOrValue(value);
            } catch (error: any) {
              const formatted = formatCommandResult(
                { success: false, error: `Failed to read file for ${param.name}: ${error.message}` },
                def.cliName,
                format
              );
              console.error(formatted.text);
              process.exit(1);
            }
          }
        }
      }
      
      const result = await def.handler(context, processedArgs);
      
      // Format and display result
      const formatted = formatCommandResult(result, def.cliName, format);
      
      if (formatted.text) {
        if (formatted.exitCode === 0) {
          console.log(formatted.text);
        } else {
          console.error(formatted.text);
        }
      }
      
      process.exit(formatted.exitCode);
    } catch (error: any) {
      const formatted = formatCommandResult(
        { success: false, error: error.message || 'Unknown error' },
        def.cliName,
        argv.format || 'human'
      );
      console.error(formatted.text);
      process.exit(1);
    }
  };
}

/**
 * Generate MCP handler from command definition
 */
export function generateMcpHandler(def: CommandDefinition, context: ServiceContext) {
  return async (args: any): Promise<CallToolResult> => {
    try {
      const result = await def.handler(context, args);
      
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: !result.success
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: error.message || 'Unknown error occurred'
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  };
}