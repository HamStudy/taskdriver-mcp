#!/usr/bin/env bun

/**
 * TaskDriver MCP Server
 * MCP server implementation for LLM agent task orchestration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema 
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config/index.js';
import { createStorageProvider } from './storage/index.js';
import { tools } from './tools/generated.js';
import { GeneratedToolHandlers } from './tools/generated.js';

export async function runMCPServer() {
  console.error('🚀 Starting TaskDriver MCP Server...');
  
  // Load configuration
  const config = loadConfig();
  console.error(`📁 Storage type: ${config.storage.provider}`);
  
  // Initialize storage provider
  const storage = createStorageProvider(config);
  await storage.initialize();
  console.error('💾 Storage provider initialized');
  
  // Initialize tool handlers
  const toolHandlers = new GeneratedToolHandlers(storage);
  
  // Create MCP server
  const server = new Server(
    {
      name: 'taskdriver-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register all tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await toolHandlers.handleToolCall(request);
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('✅ TaskDriver MCP Server is running');
  console.error(`🔧 ${tools.length} tools registered`);
  console.error('📡 Waiting for LLM agent connections...');
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.error('🔄 Shutting down TaskDriver MCP Server...');
    await storage.close();
    process.exit(0);
  });
}

// Run directly if called as main module
if (import.meta.url === `file://${process.argv[1]}`) {
  runMCPServer().catch((error) => {
    console.error('❌ MCP Server Error:', error);
    process.exit(1);
  });
}