# TaskDriver MCP

A Model Context Protocol (MCP) server for managing and orchestrating LLM agents as task runners.

## Installation

```bash
# Install globally
npm install -g taskdriver-mcp

# Or use directly with npx/bunx
npx taskdriver-mcp --help
bunx taskdriver-mcp --help
```

## Quick Start

### CLI Usage

```bash
# Create a new project
npx taskdriver-mcp create-project "my-project" "My first project"

# List projects
npx taskdriver-mcp list-projects

# Get project details
npx taskdriver-mcp get-project "my-project"

# Create a task type template
npx taskdriver-mcp create-task-type "my-project" "analysis"

# Create tasks
npx taskdriver-mcp create-task "my-project"

# Get next task for an agent
npx taskdriver-mcp get-next-task "my-project" "my-agent"

# Complete a task
npx taskdriver-mcp complete-task "my-agent" "my-project" "task-id" "Task completed"
```

### MCP Server Mode

Run TaskDriver as an MCP server for stdio transport:

```bash
npx taskdriver-mcp mcp
```

### HTTP Server Mode

Run TaskDriver as an HTTP REST API server:

```bash
npx taskdriver-mcp server
```

## Features

- **Multi-Mode Deployment**: MCP server (stdio), HTTP REST API, and CLI interface
- **Project-Based Organization**: Isolate tasks, agents, and configurations by project
- **Template-Based Task Types**: Create reusable task templates with variable substitution
- **Atomic Task Assignment**: Race-condition-free task distribution to agents
- **Lease Management**: Automatic cleanup of expired tasks and failed agents
- **Multiple Storage Backends**: File, MongoDB, and Redis storage providers
- **Comprehensive Monitoring**: Health checks, metrics, and detailed project statistics
- **Batch Processing**: Group related tasks and track batch completion
- **Retry Logic**: Configurable retry policies for failed tasks

## Deployment Modes

### 1. MCP Server (stdio)

Perfect for integration with LLM frameworks that support the Model Context Protocol:

```bash
bun run mcp
```

The MCP server provides 19 tools for complete task management:
- Project management (create, list, update, delete)
- Task lifecycle (create, assign, complete, fail)
- Agent operations (register, status)
- Monitoring (status, metrics, health)

### 2. HTTP REST API

For web applications and services:

```bash
bun run http
```

Access the API at `http://localhost:3000` with full REST endpoints for all operations.

### 3. CLI Interface

For direct command-line usage and automation:

```bash
taskdriver --help
```

## Core Concepts

### Projects

Projects provide isolated environments for tasks and agents:

```bash
# Create a project
taskdriver create-project "ai-analysis" "AI-powered code analysis project" \\
  --instructions "@project-instructions.md" \\
  --max-retries 3 \\
  --lease-duration 15

# List projects
taskdriver list-projects

# Get project details
taskdriver get-project "ai-analysis"
```

### Task Types

Task types are templates for creating similar tasks:

```bash
# Create a task type with template
taskdriver create-task-type "ai-analysis" "code-review" \\
  --template "@review-template.md" \\
  --variables "repository_url" "branch_name" "focus_area"

# List task types
taskdriver list-task-types "ai-analysis"
```

### Tasks

Tasks are specific work items executed by agents:

```bash
# Create a task
taskdriver create-task "ai-analysis" "task-type-id" "Review security vulnerabilities" \\
  --variables '{"repository_url": "https://github.com/user/repo", "focus_area": "security"}'

# List tasks
taskdriver list-tasks "ai-analysis" --status queued

# Get task details
taskdriver get-task "task-id"
```

### Agents

Agents are workers that execute tasks:

```bash
# Register an agent
taskdriver register-agent "ai-analysis" "security-agent"

# Get next task for agent
taskdriver get-next-task "security-agent" "ai-analysis"

# Complete a task
taskdriver complete-task "security-agent" "ai-analysis" "task-id" \\
  --result '{"status": "completed", "findings": ["vulnerability1", "vulnerability2"]}'
```

## File Reading Support

Both descriptions and templates support reading from files using the `@` prefix:

```bash
# Project description from file
taskdriver create-project "my-project" "@project-description.txt"

# Project instructions from file
taskdriver create-project "my-project" "Short description" --instructions "@instructions.md"

# Task template from file
taskdriver create-task-type "my-project" "analysis" --template "@analysis-template.md"
```

## Configuration

### Environment Variables

#### Core Configuration
```bash
# Server Configuration
TASKDRIVER_HOST=localhost                    # Server host (default: localhost)
TASKDRIVER_PORT=3000                        # Server port (default: 3000)
TASKDRIVER_MODE=auto                        # Server mode: auto, mcp, http, cli

# Storage Provider
TASKDRIVER_STORAGE_PROVIDER=file            # Storage provider: file, mongodb, redis
TASKDRIVER_STORAGE_CONNECTION_STRING=       # Connection string for mongodb/redis
```

#### File Storage Configuration
```bash
TASKDRIVER_FILE_DATA_DIR=./data             # Data directory for file storage
TASKDRIVER_FILE_LOCK_TIMEOUT=30000          # File lock timeout in milliseconds
```

#### MongoDB Configuration
```bash
TASKDRIVER_MONGODB_DATABASE=taskdriver      # MongoDB database name
TASKDRIVER_MONGODB_OPTIONS={}               # MongoDB connection options (JSON)
```

#### Redis Configuration
```bash
TASKDRIVER_REDIS_DATABASE=0                 # Redis database number
TASKDRIVER_REDIS_KEY_PREFIX=taskdriver:     # Redis key prefix
TASKDRIVER_REDIS_OPTIONS={}                 # Redis connection options (JSON)
```

#### Logging Configuration
```bash
TASKDRIVER_LOG_LEVEL=info                   # Log level: debug, info, warn, error
TASKDRIVER_LOG_PRETTY=false                 # Pretty print logs (true/false)
TASKDRIVER_LOG_CORRELATION=true             # Enable correlation IDs (true/false)
```

#### Security Configuration
```bash
TASKDRIVER_ENABLE_AUTH=true                 # Enable authentication (true/false)
TASKDRIVER_API_KEY_LENGTH=32                # API key length in characters
TASKDRIVER_SESSION_TIMEOUT=3600             # Session timeout in seconds
```

#### Default Task Configuration
```bash
TASKDRIVER_DEFAULT_MAX_RETRIES=3            # Default maximum retries for tasks
TASKDRIVER_DEFAULT_LEASE_DURATION=10        # Default lease duration in minutes
TASKDRIVER_REAPER_INTERVAL=1                # Reaper interval in minutes
```

### Storage Providers

#### File Storage (Development)
```bash
TASKDRIVER_STORAGE_PROVIDER=file
TASKDRIVER_FILE_DATA_DIR=./data
```

#### MongoDB (Production)
```bash
TASKDRIVER_STORAGE_PROVIDER=mongodb
TASKDRIVER_MONGODB_URI=mongodb://localhost:27017/taskdriver
```

#### Redis (High Performance)
```bash
TASKDRIVER_STORAGE_PROVIDER=redis
TASKDRIVER_REDIS_URI=redis://localhost:6379
```

## API Reference

### REST API

Full REST API documentation available at `/api/docs` when running the HTTP server.

Key endpoints:
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project details
- `POST /api/projects/:id/tasks` - Create task
- `GET /api/projects/:id/tasks` - List tasks
- `POST /api/agents/:name/tasks/assign` - Assign task to agent

### MCP Tools

When running as an MCP server, 19 tools are available:

**Project Management**:
- `create_project` - Create new project
- `list_projects` - List all projects
- `get_project` - Get project details
- `update_project` - Update project properties

**Task Management**:
- `create_task_type` - Create task template
- `list_task_types` - List task types
- `create_task` - Create new task
- `list_tasks` - List tasks with filtering
- `get_task` - Get task details

**Agent Operations**:
- `register_agent` - Register new agent
- `list_agents` - List agents
- `assign_task` - Assign task to agent
- `complete_task` - Mark task as completed
- `fail_task` - Mark task as failed

**Monitoring**:
- `get_project_stats` - Get project statistics
- `health_check` - System health check
- `get_lease_stats` - Get lease statistics
- `extend_task_lease` - Extend task lease
- `cleanup_expired_leases` - Clean up expired tasks

## Monitoring and Operations

### Health Checks

```bash
# Check system health
taskdriver health-check

# Get project statistics
taskdriver get-project-stats "my-project"

# Clean up expired leases
taskdriver cleanup-leases "my-project"
```

### Metrics

When running the HTTP server, Prometheus metrics are available at `/metrics`.

## Development

### Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test test/services/
bun test test/storage/
bun test test/integration/

# Run with coverage
bun test --coverage

# E2E testing
./test/e2e/run-all-tests.sh
```

### Development Commands

```bash
# Development mode with hot reload
bun run dev

# Build TypeScript
bun run build

# Clean build artifacts
bun run clean
```

## Examples

See the [docs/examples/](docs/examples/) directory for complete usage examples:

- [Basic Task Management](docs/examples/basic-task-management.md)
- [AI Agent Workflows](docs/examples/ai-agent-workflows.md)
- [Batch Processing](docs/examples/batch-processing.md)
- [Production Deployment](docs/examples/production-deployment.md)

## Documentation

- [CLI Reference](docs/cli-reference.md) - Complete CLI command documentation
- [MCP Tools Reference](docs/mcp-tools.md) - MCP server tool documentation
- [HTTP API Reference](docs/api-reference.md) - REST API documentation
- [Configuration Guide](docs/configuration.md) - Detailed configuration options
- [Deployment Guide](docs/deployment.md) - Production deployment instructions
- [Architecture Overview](docs/architecture.md) - Technical architecture details

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.