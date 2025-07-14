#!/usr/bin/env bun

/**
 * TaskDriver HTTP Server
 * Runs TaskDriver as an HTTP REST API server with session authentication
 */

import { loadConfig } from './config/index.js';
import { TaskDriverHttpServer } from './server.js';

export async function runHttpServer(): Promise<void> {
  console.log('🌐 Starting TaskDriver HTTP Server...');
  
  try {
    // Load configuration
    const config = await loadConfig();
    
    // Override server mode to http
    config.server.mode = 'http';
    
    console.log(`📡 Server configuration:`);
    console.log(`   Host: ${config.server.host}`);
    console.log(`   Port: ${config.server.port}`);
    console.log(`   Storage: ${config.storage.provider}`);
    console.log(`   Auth: ${config.security.enableAuth ? 'enabled' : 'disabled'}`);
    console.log(`   Session timeout: ${config.security.sessionTimeout / 1000}s`);
    
    // Create and start HTTP server
    const server = new TaskDriverHttpServer(config);
    
    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down HTTP server...');
      try {
        await server.stop();
        console.log('✅ HTTP server stopped gracefully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start server
    await server.start();
    
    console.log('✅ TaskDriver HTTP Server is running!');
    console.log(`🔗 API available at: http://${config.server.host}:${config.server.port}/api`);
    console.log(`🔍 Health check: http://${config.server.host}:${config.server.port}/health`);
    console.log('');
    console.log('📋 API Endpoints:');
    console.log('   POST /api/auth/login              - Create session');
    console.log('   POST /api/auth/logout             - Destroy session');
    console.log('   GET  /api/auth/session            - Get session info');
    console.log('   GET  /api/projects                - List projects');
    console.log('   POST /api/projects                - Create project');
    console.log('   GET  /api/projects/:id            - Get project');
    console.log('   GET  /api/projects/:id/tasks      - List tasks');
    console.log('   POST /api/projects/:id/tasks      - Create task');
    console.log('   POST /api/agents/:name/next-task  - Get next task');
    console.log('   POST /api/tasks/:id/complete      - Complete task');
    console.log('   POST /api/tasks/:id/fail          - Fail task');
    console.log('');
    console.log('🔐 Authentication:');
    console.log('   1. POST /api/auth/login with {"agentName": "agent", "projectId": "uuid"}');
    console.log('   2. Use returned sessionToken as Bearer token in Authorization header');
    console.log('   3. Example: Authorization: Bearer <sessionToken>');
    console.log('');
    console.log('💡 Press Ctrl+C to stop the server');
    
  } catch (error) {
    console.error('❌ Failed to start HTTP server:', error);
    process.exit(1);
  }
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runHttpServer().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}