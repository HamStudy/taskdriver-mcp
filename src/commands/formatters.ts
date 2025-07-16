/**
 * Output formatters for CLI commands
 * Supports both human-readable and JSON formats
 */

import chalk from 'chalk';
import { COMMAND_DEFINITIONS, CommandNames, InferCommandFromName, InferReturnTypeFromCommandName, InferArgsFromCommandName } from './index.js';


export type OutputFormat = 'human' | 'json';

export interface FormattedOutput {
  text: string;
  exitCode: number;
}


export function formatCommandResult<T extends CommandNames>(
  result: InferReturnTypeFromCommandName<T>, 
  commandName: T, 
  format: OutputFormat = 'human',
  args?: InferArgsFromCommandName<T>
): FormattedOutput {
  if (format === 'json') {
    return {
      text: JSON.stringify(result, null, 2),
      exitCode: result.success ? 0 : 1
    };
  }

  // Human-readable format
  if (!result.success) {
    return {
      text: chalk.red(`❌ Error: ${result.error || 'Command failed'}`),
      exitCode: 1
    };
  }

  // Success case - format based on command type
  let output = '';
  
  if (result.message) {
    output += chalk.green(`✅ ${result.message}`) + '\n';
  }

  // For successful results, pass the command result to formatData
  if (result && typeof result === 'object') {
    output += formatData(commandName as CommandNames, result, args);
  }

  return {
    text: output.trim(),
    exitCode: 0
  };
}

function commandFromType<T extends CommandNames>(commandName: T) {
  const command = COMMAND_DEFINITIONS.find(cmd => cmd.cliName === commandName || cmd.mcpName === commandName || cmd.name === commandName) as InferCommandFromName<T>;
  if (!command) throw new Error(`Unknown command: ${commandName}`);
  return command;
}

/**
 * Format data based on command type using command-specific formatters
 */
function formatData<T extends CommandNames>(commandName: T, result: InferReturnTypeFromCommandName<T>, args: InferArgsFromCommandName<T> = {} as InferArgsFromCommandName<T>): string {
  // Find the command definition
  const command = commandFromType(commandName);
    
  // If command has formatResult function, use it
  if (typeof command?.formatResult === 'function') {
    return command.formatResult(result, args as any); // Cast args to any explicitly allowed in this one case
  }
  
  // Fallback to simple JSON formatting
  return formatDataFallback<T>(result);
}

function formatDataFallback<T extends CommandNames>(data: InferReturnTypeFromCommandName<T>): string {
  // Simple fallback - just return JSON representation
  // Commands should define their own formatData functions for custom formatting
  return JSON.stringify(data, null, 2);
}

// All formatting functions have been moved to individual command definitions
// This file now only provides the basic formatCommandResult function

// Legacy formatting functions removed - now handled by individual command definitions

// Removed formatTaskList - now handled by individual command definitions

// All legacy formatting functions removed - formatting is now handled by individual command definitions
// This keeps the file clean and focused on the core formatCommandResult function