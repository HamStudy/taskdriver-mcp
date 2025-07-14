#!/usr/bin/env bun

/**
 * TaskDriver MCP Server
 * Main entry point - determines whether to run as MCP server or CLI tool
 */

import { parseArgs } from 'node:util';

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      mode: { type: 'string', default: 'mcp' },
    },
  });

  if (values.help) {
    console.log(`
TaskDriver MCP Server - LLM Agent Task Orchestration

Usage:
  taskdriver [options] [command]

Options:
  -h, --help     Show this help message
  -v, --version  Show version
  --mode <mode>  Run mode: 'mcp', 'http', or 'cli' (default: mcp)

MCP Mode:
  Runs as MCP server for LLM agents to connect to

HTTP Mode:
  Runs as HTTP REST API server with session authentication

CLI Mode:
  Run CLI commands for project management
  
Examples:
  taskdriver                           # Run as MCP server
  taskdriver --mode=http              # Run as HTTP server
  taskdriver --mode=cli list-projects  # Run CLI command
`);
    return;
  }

  if (values.version) {
    const pkg = await import('../package.json');
    console.log(`TaskDriver MCP Server v${pkg.version}`);
    return;
  }

  if (values.mode === 'cli' || positionals.length > 0) {
    // Run CLI
    const { runCLI } = await import('./cli.js');
    await runCLI(positionals);
  } else if (values.mode === 'http') {
    // Run HTTP server
    const { runHttpServer } = await import('./http.js');
    await runHttpServer();
  } else {
    // Run MCP server
    const { runMCPServer } = await import('./mcp.js');
    await runMCPServer();
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});