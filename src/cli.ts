#!/usr/bin/env node

/**
 * TaskDriver CLI - Generated from unified command definitions
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from './utils/chalk.js';
import { loadConfig } from './config/index.js';
import { createStorageProvider } from './storage/index.js';
import { createServiceContext } from './commands/context.js';
import { COMMAND_DEFINITIONS } from './commands/definitions.js';
import { generateCliCommand, generateCliHandler } from './commands/generators.js';

// Global service context
let context: ReturnType<typeof createServiceContext> | null = null;

async function initializeContext() {
  if (context) return context;
  
  try {
    const config = loadConfig();
    const storage = createStorageProvider(config);
    await storage.initialize();
    
    context = createServiceContext(storage);
    return context;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red('❌ Failed to initialize services:'), errorMessage);
    process.exit(1);
  }
}

// Build CLI from command definitions
async function buildCli() {
  let cli = yargs(hideBin(process.argv))
    .scriptName('taskdriver')
    .usage('$0 <command> [options]')
    .demandCommand(1, 'You need at least one command before moving on')
    .strict() // Reject unrecognized commands and options
    .fail((msg, err) => {
      if (err) {
        console.error(chalk.red('❌ Error:'), err.message, err.stack);
      } else {
        console.error(chalk.red('❌ Error:'), msg);
        console.error('\nRun --help to see available commands and options');
      }
      process.exit(1);
    })
    .help()
    .version()
    .alias('h', 'help');

  // Add special MCP command
  cli = cli.command('mcp', 'Run as MCP server for stdio transport', {}, async () => {
    const { runMCPServer } = await import('./mcp.js');
    await runMCPServer();
  });

  // Add special server command
  cli = cli.command('server', 'Run as HTTP REST API server', {}, async () => {
    const { runHttpServer } = await import('./http.js');
    await runHttpServer();
  });

  // Add each command from definitions
  for (const def of COMMAND_DEFINITIONS) {
    const commandConfig = generateCliCommand(def);
    
    cli = cli.command(
      commandConfig.command,
      commandConfig.describe,
      commandConfig.builder,
      async (argv) => {
        const ctx = await initializeContext();
        const handler = generateCliHandler(def, ctx);
        await handler(argv);
      }
    );
  }

  return cli;
}

// Run the CLI
async function main() {
  const cli = await buildCli();
  cli.parse();
}

// Export for programmatic use
export async function runCLI(args?: string[]) {
  const cli = await buildCli();
  cli.parse(args || process.argv.slice(2));
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(chalk.red('❌ CLI error:'), error.message);
    process.exit(1);
  });
}