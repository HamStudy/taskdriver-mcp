# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskDriver is an MCP (Model Context Protocol) server for managing and orchestrating LLM agents as task runners. It provides a sophisticated task management system with three deployment modes: MCP server (stdio), HTTP REST API, and CLI interface.

## Development Commands

NEVER USE `npm` or `node` - use `bun` for everything. This is not a node.js project.

### Build and Development
```bash
bun install              # Install dependencies
bun run build           # TypeScript compilation to dist/
bun run dev             # Development mode with hot reload
bun run clean           # Remove dist/ directory
```

### Running Different Modes
```bash
bun run mcp             # Start MCP server (stdio transport)
bun run http            # Start HTTP REST API server
bun run cli             # Interactive CLI mode
```

### Testing
```bash
bun test                # Run all unit tests
bun test --watch        # Watch mode testing
bun test --coverage     # Run with coverage

# Specific test suites
bun test test/services/                    # Service layer tests
bun test test/storage/                     # Storage provider tests
bun test test/http/server.test.ts         # HTTP server integration
bun test test/mcp/server.test.ts          # MCP server tests

# E2E testing (requires no running servers)
./test/e2e/run-all-tests.sh              # Complete E2E test suite
./test/e2e/stress-test.sh                 # Performance/stress testing
./test/http/run-http-tests.sh             # HTTP server test suite
```

### Installation and CLI
```bash
bun install -g .        # Install CLI globally
taskdriver --help       # Use installed CLI
```

## Test Driven Development Rules

### Core Principles
- **Tests are the specification** - they define expected behavior, not implementation details
- **All tests must pass** - A failing test anywhere indicates broken assumptions or real bugs
- **Test failures are ALWAYS relevant** - Code changes can have cascading effects through the system

### Mandatory TDD Workflow
1. **Before ANY work**: `bun test` → must be green
2. **During work**: Write test FIRST, watch it fail, then implement
3. **Before considering done**: `bun test` → must be green
4. **If any test fails**: Stop and fix - the failure reveals a problem you missed
5. **Before ANY commit**: `bun test` → must be green

### Writing Better Tests in TypeScript

#### Use Real Implementations Over Mocks
```typescript
// BAD: Over-mocking that doesn't test real behavior
const mockStorage = jest.fn();
const mockLogger = jest.fn();
const service = new TaskService(mockStorage as any, mockLogger as any);

// GOOD: Real implementations with test doubles only for external dependencies
const storage = new FileStorageProvider(testDataDir);
const logger = createTestLogger(); // Real logger with test output
const service = new TaskService(storage, logger);
```

#### Test User Outcomes, Not Implementation
```typescript
// USELESS: Testing that defaults haven't changed
it('should have default lease timeout of 300', () => {
  const task = new Task();
  expect(task.leaseTimeout).toBe(300);
});

// USEFUL: Testing behavior with defaults
it('should expire task leases after configured timeout', async () => {
  const task = await taskService.createTask({ type: 'process-data' });
  const lease = await leaseService.acquireLease(task.id);
  
  await advanceTime(301); // Past default timeout
  await reaperService.processExpiredLeases();
  
  const updatedTask = await taskService.getTask(task.id);
  expect(updatedTask.status).toBe('pending'); // Available again
});
```

#### Test Configuration Flow, Not Magic Numbers
```typescript
// BAD: Testing hardcoded values
it('should have batchSize of 100', () => {
  expect(config.batchSize).toBe(100);
});

// GOOD: Testing configuration is properly wired
it('should use batch size from environment config', () => {
  process.env.TASKDRIVER_BATCH_SIZE = '50';
  const config = loadConfig();
  const processor = new BatchProcessor(config);
  
  expect(processor.batchSize).toBe(50);
  expect(processor.batchSize).toBe(config.batchSize);
});
```

#### Integration Over Isolation
```typescript
// BETTER: Test real workflows across service boundaries
describe('Task Assignment Flow', () => {
  let storage: StorageProvider;
  let projectService: ProjectService;
  let taskService: TaskService;
  let agentService: AgentService;
  
  beforeEach(async () => {
    storage = new FileStorageProvider(testDataDir);
    projectService = new ProjectService(storage);
    taskService = new TaskService(storage);
    agentService = new AgentService(storage, taskService);
  });
  
  it('should atomically assign tasks to agents', async () => {
    const project = await projectService.create({ name: 'test-project' });
    const agent = await agentService.register(project.id, { name: 'agent-1' });
    const task = await taskService.create(project.id, { 
      type: 'process', 
      data: { file: 'test.csv' } 
    });
    
    // Test atomic assignment
    const assigned = await agentService.requestTask(project.id, agent.id);
    expect(assigned?.id).toBe(task.id);
    
    // Verify no double assignment
    const secondRequest = await agentService.requestTask(project.id, agent.id);
    expect(secondRequest).toBeNull();
  });
});
```

#### Async/Promise Testing Patterns
```typescript
// Always use async/await for clarity
it('should handle storage failures gracefully', async () => {
  const brokenStorage = new BrokenStorageProvider();
  const service = new TaskService(brokenStorage);
  
  await expect(service.create(projectId, taskData))
    .rejects.toThrow(StorageError);
});

// Test specific error types and retry behavior
it('should retry transient failures', async () => {
  let attempts = 0;
  storage.save = jest.fn().mockImplementation(async () => {
    attempts++;
    if (attempts < 3) throw new TransientError('Network timeout');
    return { id: '123' };
  });
  
  const result = await taskService.createWithRetry(projectId, taskData);
  expect(result.id).toBe('123');
  expect(attempts).toBe(3);
});
```

### TaskDriver-Specific Testing Patterns

#### Test Storage Provider Contracts
```typescript
// All storage providers must pass the same behavioral tests
['file', 'mongodb', 'redis'].forEach(providerType => {
  describe(`${providerType} storage provider`, () => {
    let provider: StorageProvider;
    
    beforeEach(() => {
      provider = createStorageProvider(providerType, testConfig);
    });
    
    it('should atomically assign tasks', async () => {
      // Same test for all providers ensures consistent behavior
      const task = await provider.save('tasks', createTestTask());
      const assigned = await provider.findOneAndUpdate(
        'tasks',
        { id: task.id, status: 'pending' },
        { status: 'assigned', agentId: 'agent-1' }
      );
      
      expect(assigned?.agentId).toBe('agent-1');
      
      // Verify atomicity - second assignment should fail
      const secondAssign = await provider.findOneAndUpdate(
        'tasks',
        { id: task.id, status: 'pending' },
        { status: 'assigned', agentId: 'agent-2' }
      );
      
      expect(secondAssign).toBeNull();
    });
  });
});
```

#### Test MCP Tool Behavior
```typescript
// Test tools handle real-world input correctly
describe('MCP Tools', () => {
  it('should accept type parameter for task creation', async () => {
    const result = await handlers.createTask({
      projectId: 'test-project',
      type: 'data-processing', // NOT typeId
      data: { source: 'api' }
    });
    
    expect(result.content[0].text).toContain('created successfully');
  });
  
  it('should handle malformed input gracefully', async () => {
    const result = await handlers.createTask({
      projectId: 'test-project',
      typeId: 'wrong-param' // Common mistake
    });
    
    expect(result.content[0].text).toContain('type parameter is required');
  });
});
```

### Red Flags to Avoid
- ❌ Testing that specific values haven't changed (magic number tests)
- ❌ Using `as any` to bypass TypeScript in tests
- ❌ Mocking internal modules instead of using real implementations
- ❌ Changing tests to match new behavior without understanding why they failed
- ❌ Skipping "unrelated" test failures
- ❌ Writing tests after implementation
- ❌ Testing private methods or internal state
- ❌ Tests that mirror class/file structure instead of user workflows

### Test Organization
```typescript
// Organize by user workflows and features, not by code structure
describe('Task Processing', () => {
  describe('when agent requests work', () => {
    describe('with available tasks', () => {
      it('should assign highest priority task first', async () => {});
      it('should respect task type filtering', async () => {});
    });
    
    describe('with no available tasks', () => {
      it('should return null without blocking', async () => {});
    });
    
    describe('when task processing fails', () => {
      it('should retry according to retry policy', async () => {});
      it('should eventually mark task as failed', async () => {});
    });
  });
});
```

### Debugging Test Failures
When a test fails unexpectedly:
1. **Read the test name** - understand what behavior it's verifying
2. **Check the assertion** - what specific outcome was expected?
3. **Trace the data flow** - how could your changes affect this path?
4. **Run in isolation** - `bun test path/to/specific.test.ts`
5. **Add console.logs** - but remove them before committing
6. **Fix the root cause** - not just the test

Remember: If a test is failing, it's telling you something important about your changes that you missed.

## TypeScript Language Server Tools

Use these MCP tools for safe refactoring and type checking:
- **diagnostics** - Check for TypeScript errors (run BEFORE tests!)
- **references** - Find all usages before changing anything
- **rename_symbol** - Safe renaming (never use find/replace)
- **hover** - Get type info and documentation
- **definition** - Jump to source
- **edit_file** - Apply multiple edits atomically

### Critical Workflow Rules

1. **Always run diagnostics before tests** - Type errors cause confusing test failures
2. **Always check references before modifying** - See impact across codebase
3. **Always use rename_symbol for renames** - Updates imports and types correctly

### Quick Examples
```typescript
// Before changing any function/interface
mcp__language-server__references on the symbol

// When tests fail mysteriously
mcp__language-server__diagnostics src/services/TaskService.ts

// Safe refactoring
mcp__language-server__rename_symbol createTask -> createNewTask
```

## Architecture Overview

### Core Architecture Layers
1. **Transport Layer**: MCP (stdio), HTTP REST API, CLI
2. **Service Layer**: Business logic (Project, Task, Agent, Session, Lease services)
3. **Storage Layer**: Pluggable backends (File, MongoDB, Redis)
4. **Type System**: Comprehensive TypeScript definitions

### Entry Points
- `src/index.ts` - Main entry with mode detection
- `src/mcp.ts` - MCP server implementation
- `src/server.ts` - HTTP/Express server
- `src/cli.ts` - CLI interface using yargs

### Service Layer (`src/services/`)
Core business logic with clean separation:
- **ProjectService**: Project lifecycle and configuration
- **TaskService**: Task creation, assignment, completion with retry logic
- **TaskTypeService**: Template-based task types with variable substitution
- **AgentService**: Agent registration and task assignment coordination
- **LeaseService**: Lease management and timeout handling
- **SessionService**: HTTP session management with storage persistence

### Storage Layer (`src/storage/`)
Pluggable storage with atomic operations:
- **FileStorageProvider**: JSON files with `flock()` for single-instance
- **MongoStorageProvider**: MongoDB with transactions for multi-instance
- **RedisStorageProvider**: Redis with Lua scripts for atomic operations

Factory pattern selection via `TASKDRIVER_STORAGE_PROVIDER` environment variable.

### Critical Design Patterns

#### Atomic Task Assignment
Prevents race conditions when multiple agents request tasks:
- File: Uses `flock()` system calls
- MongoDB: Uses `findOneAndUpdate` atomic operations  
- Redis: Uses Lua scripts for multi-step atomicity

#### Lease Management System
Handles agent failures gracefully:
- Tasks have configurable lease expiration times
- ReaperService cleans up expired leases
- Hybrid retry model: agents handle transient errors, server handles infrastructure failures

#### Project-Scoped Isolation
- All entities (tasks, agents, task types) are scoped to projects
- API keys are project-specific
- No cross-project data contamination possible

#### Template-Based Task Creation
- Task types define templates with `{{variable}}` substitution
- Bulk task creation with duplicate handling strategies
- Variable validation and type checking

## Development Workflow

### TypeScript Configuration
- Strict mode enabled with ESNext features
- Module resolution: Node.js style
- Output: ES modules to `dist/`
- Source maps and declarations generated

### Testing Strategy
- **Unit tests**: Service layer with mocked dependencies
- **Integration tests**: Cross-storage provider compatibility
- **E2E tests**: Complete workflows with shell scripts and metrics
- **HTTP tests**: REST API endpoints and session management

### MCP Tools (`src/tools/`)
19 complete MCP tools covering:
- Project management (create, list, update, delete)
- Task lifecycle (create, assign, complete, fail)
- Agent operations (register, status)
- Monitoring (status, metrics, health)

All tools have JSON schemas and comprehensive validation.

All tools output human-readable text responses with structured data, but also have an option that can be provided to return raw JSON for programmatic use.

### MCP Prompts (`src/prompts/`)
5 workflow prompts that appear as slash commands in Claude Code:
- `{prefix}:create-project` - Create new projects with setup guidance
- `{prefix}:track-progress` - Monitor project and task progress
- `{prefix}:batch-process` - Set up batch processing workflows
- `{prefix}:break-down-work` - Break large tasks into manageable pieces
- `{prefix}:process-list` - Process lists of items systematically

Prompts are organized in clean modules with configurable prefix via `TASKDRIVER_MCP_PROMPT_PREFIX`.

### Configuration (`src/config/`)
Environment-based configuration following 12-factor app principles:
- Storage provider selection and configuration
- Server settings (host, port, CORS)
- Security settings (session timeout, rate limiting)
- Logging configuration

### Key Environment Variables
```bash
TASKDRIVER_STORAGE_PROVIDER=file|mongodb|redis
TASKDRIVER_HTTP_PORT=3000
TASKDRIVER_LOG_LEVEL=info|debug|warn|error
TASKDRIVER_SESSION_TIMEOUT=3600
TASKDRIVER_MCP_PROMPT_PREFIX=taskdriver  # Configure MCP prompt prefix (default: taskdriver)
```

## Production Considerations

### Observability
- Structured JSON logging with correlation IDs
- Prometheus-compatible metrics at `/metrics`
- Health checks at `/health` with storage validation
- Request/response logging for all HTTP endpoints

### Security
- Helmet security headers
- CORS configuration
- Rate limiting on API endpoints
- Input validation with Joi schemas
- Project-scoped API keys

### Scalability
- Multi-instance support with MongoDB/Redis storage
- Atomic operations prevent race conditions
- Configurable retry policies
- Graceful shutdown handling (SIGINT/SIGTERM)

### Storage Provider Selection
- **File**: Development, single-instance deployments
- **MongoDB**: Production, multi-instance with transactions
- **Redis**: High-performance, distributed scenarios

## Common Development Patterns

### API Parameter Standards
- **Task Type References**: Always use `type` parameter (not `typeId`) for task type references in all MCP tools and CLI commands. This parameter accepts either the task type ID or name.
- **Project References**: Always use `projectId` parameter for project references, accepting either project ID or name.
- **Bulk Operations**: Use `type` (not `typeId`) and `vars` (not `variables`) in bulk task creation arrays to match TaskInput interface.

### Adding New MCP Tools
1. Define tool schema in `src/tools/index.ts`
2. Implement handler in `src/tools/handlers.ts`
3. Add service method if needed
4. Write tests in `test/tools/handlers.test.ts`

### Adding Storage Providers
1. Implement `StorageProvider` interface
2. Handle atomic operations for task assignment
3. Add to factory in `src/storage/index.ts`
4. Write provider-specific tests

### Service Layer Development
- Services are stateless and dependency-injected
- Use storage provider for all persistence
- Implement comprehensive error handling
- Follow existing patterns for validation and logging

## Test Data and Cleanup

Tests use temporary directories that are automatically cleaned up:
- `test-http-data/` - HTTP server tests
- `test-session-data/` - Session service tests  
- `test-*-data/` - Various test suites

No manual cleanup required - handled by test teardown.

## TypeScript Development Guidelines

### Type System Principles
- TypeScript should always use the correct types when possible, typecasting to `any` or `unknown` should not be done without explicit instructions from the user
- Prefer type inference where possible, but be explicit with function parameters and return types
- Use strict null checks and handle undefined cases properly
- Leverage TypeScript's type system to catch errors at compile time, not runtime

### Response Format
- All commands (both MCP and CLI) should by default return human-readable text
- An option to return JSON format should be available instead if desired
- When returning a JSON response, the system will directly return the result from the handler() 
- For human-readable responses, the output of the handler should be passed into the formatResult function on the defined command to format it nicely for return
