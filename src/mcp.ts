#!/usr/bin/env node

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
import { FileStorageProvider } from './storage/FileStorageProvider.js';
import { allTools } from './tools/index.js';
import { ToolHandlers } from './tools/handlers.js';

export async function runMCPServer() {
  console.error('🚀 Starting TaskDriver MCP Server...');
  
  // Load configuration
  const config = loadConfig();
  console.error(`📁 Data directory: ${config.storage.fileStorage?.dataDir || './data'}`);
  
  // Initialize storage provider
  const storage = new FileStorageProvider(config.storage.fileStorage?.dataDir || './data');
  await storage.initialize();
  console.error('💾 Storage provider initialized');
  
  // Initialize tool handlers
  const toolHandlers = new ToolHandlers(storage);
  
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
      tools: allTools
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
  console.error(`🔧 ${allTools.length} tools registered`);
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