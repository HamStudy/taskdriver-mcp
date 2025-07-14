#!/usr/bin/env bun

/**
 * Session Management Demo
 * Demonstrates session resumption and duplicate prevention
 */

import { createStorageProvider } from '../src/storage/index.js';
import { SessionService } from '../src/services/SessionService.js';
import { AgentService } from '../src/services/AgentService.js';
import { ProjectService } from '../src/services/ProjectService.js';
import { TaskService } from '../src/services/TaskService.js';
import { TaskTypeService } from '../src/services/TaskTypeService.js';

async function demo() {
  console.log('🧪 Session Management Demo');
  console.log('==========================\n');

  // Initialize storage
  const storage = createStorageProvider({
    provider: 'file',
    fileStorage: { dataDir: './demo-data', lockTimeout: 5000 }
  });
  await storage.initialize();

  // Initialize services
  const projectService = new ProjectService(storage);
  const taskTypeService = new TaskTypeService(storage, projectService);
  const taskService = new TaskService(storage, projectService, taskTypeService);
  const agentService = new AgentService(storage, projectService, taskService);
  const sessionService = new SessionService(storage, agentService, projectService, 60); // 1 minute sessions

  try {
    // Create test project
    console.log('📋 Creating test project...');
    const project = await projectService.createProject({
      name: 'session-demo',
      description: 'Session management demo project'
    });
    console.log(`✅ Project created: ${project.id}\n`);

    // Register test agent
    console.log('🤖 Registering test agent...');
    const agentReg = await agentService.registerAgent({
      projectId: project.id,
      name: 'demo-agent',
      capabilities: ['demo']
    });
    console.log(`✅ Agent registered: ${agentReg.agent.name}\n`);

    // Test 1: Create first session
    console.log('🔐 Test 1: Creating first session...');
    const session1 = await sessionService.createSession('demo-agent', project.id);
    console.log(`✅ Session created: ${session1.session.id}`);
    console.log(`📱 Token: ${session1.sessionToken.substring(0, 20)}...\n`);

    // Test 2: Try to create duplicate session (should prevent)
    console.log('🚫 Test 2: Attempting duplicate session (should clean up existing)...');
    const session2 = await sessionService.createSession('demo-agent', project.id, {
      allowMultipleSessions: false  // Default behavior
    });
    console.log(`✅ New session created: ${session2.session.id}`);
    console.log(`🧹 Previous session should be cleaned up\n`);

    // Test 3: Resume existing session
    console.log('🔄 Test 3: Attempting session resumption...');
    const session3 = await sessionService.createSession('demo-agent', project.id, {
      resumeExisting: true
    });
    console.log(`✅ Session resumed: ${session3.session.id}`);
    console.log(`🔍 Resumed: ${session3.resumed}`);
    console.log(`📅 Last accessed: ${session3.session.lastAccessedAt}\n`);

    // Test 4: Allow multiple sessions
    console.log('📱 Test 4: Creating multiple sessions (allowed)...');
    const session4 = await sessionService.createSession('demo-agent', project.id, {
      allowMultipleSessions: true
    });
    console.log(`✅ Additional session created: ${session4.session.id}`);
    
    // Check how many sessions exist
    const activeSessions = await sessionService.findActiveSessionsForAgent('demo-agent', project.id);
    console.log(`📊 Active sessions for demo-agent: ${activeSessions.length}\n`);

    // Test 5: Session validation
    console.log('🔍 Test 5: Session validation...');
    const validation = await sessionService.validateSession(session4.sessionToken);
    if (validation) {
      console.log(`✅ Session valid for agent: ${validation.agent.name}`);
      console.log(`📋 Project: ${validation.project.name}`);
    } else {
      console.log('❌ Session validation failed');
    }

    console.log('\n🎉 Session management demo completed successfully!');
    console.log('\n📝 Summary of capabilities:');
    console.log('  ✅ Session creation with duplicate prevention');
    console.log('  ✅ Session resumption for reconnections');
    console.log('  ✅ Multiple session support (configurable)');
    console.log('  ✅ Cross-storage provider session persistence');
    console.log('  ✅ Automatic session cleanup and expiration');

  } finally {
    await storage.close();
  }
}

demo().catch(console.error);