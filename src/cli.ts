#!/usr/bin/env bun

/**
 * TaskDriver CLI - Generated from unified command definitions
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { loadConfig } from './config/index.js';
import { createStorageProvider } from './storage/index.js';
import { createServiceContext } from './commands/context.js';
import { COMMAND_DEFINITIONS } from './commands/definitions.js';
import { generateCliCommand, generateCliHandler } from './commands/generators.js';

// Global service context
let context: any = null;

async function initializeContext() {
  if (context) return context;
  
  try {
    const config = loadConfig();
    const storage = createStorageProvider(config);
    await storage.initialize();
    
    context = createServiceContext(storage);
    return context;
  } catch (error: any) {
    console.error(chalk.red('❌ Failed to initialize services:'), error.message);
    process.exit(1);
  }
}

// Build CLI from command definitions
async function buildCli() {
  let cli = yargs(hideBin(process.argv))
    .scriptName('taskdriver')
    .usage('$0 <command> [options]')
    .demandCommand(1, 'You need at least one command before moving on')
    .help()
    .version()
    .alias('h', 'help');

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