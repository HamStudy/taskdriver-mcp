# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TaskDriver is an MCP (Model Context Protocol) server for managing and orchestrating LLM agents as task runners. It provides a sophisticated task management system with three deployment modes: MCP server (stdio), HTTP REST API, and CLI interface.

## Development Commands

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
npm install -g .        # Install CLI globally
taskdriver --help       # Use installed CLI
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

## Typescript Development Guidelines

### Type System Principles
- Typescript should always use the correct types when possible, typecasting to `any` or `unknown` should not be done without explicit instructions from the user
