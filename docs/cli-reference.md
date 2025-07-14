# CLI Reference

Complete reference for the TaskDriver CLI commands.

## Installation

```bash
# Install CLI globally
npm install -g .

# Or run directly with bun
bun run cli <command>
```

## Global Options

All commands support these global options:

- `--help, -h` - Show help information
- `--version` - Show version information

## Project Management

### create-project

Create a new project for organizing tasks and agents.

```bash
bun run cli create-project <name> <description> [options]
```

**Arguments:**
- `name` - Project name (alphanumeric, hyphens, underscores only, must be unique)
- `description` - Project description (or `@path/to/file.txt` to read from file)

**Options:**
- `--instructions, -i <text>` - Project instructions for agents (or `@path/to/file.txt` to read from file)
- `--max-retries, -r <number>` - Default maximum retries for tasks (default: 3)
- `--lease-duration, -l <number>` - Default lease duration in minutes (default: 10)

**Examples:**
```bash
# Create basic project
bun run cli create-project "ai-analysis" "AI-powered code analysis"

# Create project with file-based description and instructions
bun run cli create-project "ai-analysis" "@description.txt" --instructions "@instructions.md"

# Create project with custom settings
bun run cli create-project "ai-analysis" "Analysis project" --max-retries 5 --lease-duration 30
```

### list-projects

List all projects with optional filtering.

```bash
bun run cli list-projects [options]
```

**Options:**
- `--include-closed, -c` - Include closed projects (default: false)
- `--format, -f <format>` - Output format: `table` or `detailed` (default: table)

**Examples:**
```bash
# List active projects
bun run cli list-projects

# List all projects including closed ones
bun run cli list-projects --include-closed

# Show detailed project information
bun run cli list-projects --format detailed
```

### get-project

Get detailed information about a specific project.

```bash
bun run cli get-project <name>
```

**Arguments:**
- `name` - Project name or ID

**Examples:**
```bash
# Get project by name
bun run cli get-project "ai-analysis"

# Get project by ID
bun run cli get-project "550e8400-e29b-41d4-a716-446655440000"
```

### update-project

Update an existing project's configuration and details.

```bash
bun run cli update-project <project> [options]
```

**Arguments:**
- `project` - Project name or ID to update

**Options:**
- `--name, -n <name>` - New project name
- `--description, -d <description>` - New description (or @path/to/file.txt)
- `--instructions, -i <instructions>` - New instructions (or @path/to/file.txt)
- `--status, -s <status>` - Project status: `active` or `closed`
- `--max-retries, -r <number>` - Default maximum retry attempts
- `--lease-duration, -l <minutes>` - Default lease duration in minutes
- `--reaper-interval <minutes>` - Reaper interval in minutes

**Examples:**
```bash
# Update project description
bun run cli update-project "ai-analysis" --description "Updated project description"

# Update project instructions from file
bun run cli update-project "ai-analysis" --instructions @instructions.md

# Update project configuration
bun run cli update-project "ai-analysis" --max-retries 5 --lease-duration 30

# Close a project
bun run cli update-project "ai-analysis" --status closed

# Update multiple fields
bun run cli update-project "ai-analysis" --name "new-name" --description "New desc" --max-retries 3
```

## Task Type Management

### create-task-type

Create a new task type template for a project.

```bash
bun run cli create-task-type <project> <name> [options]
```

**Arguments:**
- `project` - Project name or ID
- `name` - Task type name (alphanumeric, hyphens, underscores only)

**Options:**
- `--template, -t <text>` - Task template with variables like `{{variable}}` (or `@path/to/file.txt` to read from file)
- `--variables, --vars, -v <vars...>` - Template variables (space-separated)
- `--duplicate-handling, -d <handling>` - How to handle duplicate tasks: `allow`, `ignore`, `fail` (default: allow)
- `--max-retries, -r <number>` - Maximum retry attempts
- `--lease-duration, -l <number>` - Lease duration in minutes

**Examples:**
```bash
# Create basic task type
bun run cli create-task-type "ai-analysis" "code-review" --template "Review {{repository}} for {{focus}}"

# Create task type with template from file
bun run cli create-task-type "ai-analysis" "security-scan" --template "@security-template.md" -v "repository_url" "branch_name"

# Create task type with custom settings
bun run cli create-task-type "ai-analysis" "deep-analysis" --template "@template.md" --duplicate-handling "ignore" --max-retries 5
```

### list-task-types

List all task types for a project.

```bash
bun run cli list-task-types <project> [options]
```

**Arguments:**
- `project` - Project name or ID

**Options:**
- `--format, -f <format>` - Output format: `table` or `detailed` (default: table)

**Examples:**
```bash
# List task types
bun run cli list-task-types "ai-analysis"

# Show detailed task type information
bun run cli list-task-types "ai-analysis" --format detailed
```

### get-task-type

Get detailed information about a specific task type.

```bash
bun run cli get-task-type <type-id>
```

**Arguments:**
- `type-id` - Task type ID

**Examples:**
```bash
bun run cli get-task-type "550e8400-e29b-41d4-a716-446655440000"
```

### update-task-type

Update an existing task type's configuration and template.

```bash
bun run cli update-task-type <type-id> [options]
```

**Arguments:**
- `type-id` - Task type ID to update

**Options:**
- `--name, -n <name>` - New task type name
- `--template, -t <template>` - New task template (or @path/to/file.txt)
- `--variables, --vars, -v <variables...>` - Template variables (space-separated)
- `--duplicate-handling, -d <handling>` - Duplicate handling: `allow`, `ignore`, `fail`
- `--max-retries, -r <number>` - Maximum retry attempts
- `--lease-duration, -l <minutes>` - Lease duration in minutes

**Examples:**
```bash
# Update task type template
bun run cli update-task-type "550e8400-e29b-41d4-a716-446655440000" --template "New template with {{variable}}"

# Update template from file
bun run cli update-task-type "550e8400-e29b-41d4-a716-446655440000" --template @template.txt

# Update template and variables
bun run cli update-task-type "550e8400-e29b-41d4-a716-446655440000" \
  --template "Process {{item}} using {{method}}" \
  -v "item" "method"

# Update configuration
bun run cli update-task-type "550e8400-e29b-41d4-a716-446655440000" \
  --max-retries 3 \
  --lease-duration 45

# Update multiple fields
bun run cli update-task-type "550e8400-e29b-41d4-a716-446655440000" \
  --name "new-task-type" \
  --duplicate-handling "fail" \
  --max-retries 5
```

## Task Management

### create-task

Create a new task for execution.

```bash
bun run cli create-task <project> [instructions] [options]
```

**Arguments:**
- `project` - Project name or ID
- `instructions` - Task instructions (required when using default task type)

**Options:**
- `--type, -t <type>` - Task type ID or name (uses first available if not specified)
- `--id, -i <id>` - Custom task ID (generates sequential ID like "task-1" if not specified)
- `--description, -d <description>` - Human-readable task description
- `--variables, --vars <json>` - Variables as JSON string (e.g., `'{"key": "value"}'`)
- `--batch-id, -b <id>` - Batch ID for grouping tasks

**Examples:**
```bash
# Create task with default task type (instructions required)
bun run cli create-task "ai-analysis" "Analyze security vulnerabilities"

# Create task with specific task type and custom ID
bun run cli create-task "ai-analysis" -t "code-review" --id "security-scan-1" --description "Security scan for main repository"

# Create task with variables
bun run cli create-task "ai-analysis" -t "code-review" --variables '{"repository": "https://github.com/user/repo", "focus": "security"}'

# Create task with batch ID
bun run cli create-task "ai-analysis" "Analyze module A" --batch-id "batch-123"
```

### list-tasks

List tasks for a project with optional filtering.

```bash
bun run cli list-tasks <project> [options]
```

**Arguments:**
- `project` - Project name or ID

**Options:**
- `--status, -s <status>` - Filter by task status: `queued`, `running`, `completed`, `failed`
- `--type-id, -t <id>` - Filter by task type ID
- `--batch-id, -b <id>` - Filter by batch ID
- `--assigned-to, -a <agent>` - Filter by assigned agent
- `--limit, -l <number>` - Maximum number of tasks to return (default: 50)
- `--offset, -o <number>` - Number of tasks to skip (default: 0)
- `--format, -f <format>` - Output format: `table` or `detailed` (default: table)

**Examples:**
```bash
# List all tasks
bun run cli list-tasks "ai-analysis"

# List only queued tasks
bun run cli list-tasks "ai-analysis" --status queued

# List tasks assigned to specific agent
bun run cli list-tasks "ai-analysis" --assigned-to "agent-1"

# List tasks with pagination
bun run cli list-tasks "ai-analysis" --limit 10 --offset 20
```

### get-task

Get detailed information about a specific task.

```bash
bun run cli get-task <task-id>
```

**Arguments:**
- `task-id` - Task ID

**Examples:**
```bash
bun run cli get-task "550e8400-e29b-41d4-a716-446655440000"
```

## Agent Management

### register-agent

Register a new agent for task execution.

```bash
bun run cli register-agent <project> <name> [options]
```

**Arguments:**
- `project` - Project name or ID
- `name` - Agent name

**Options:**
- `--capabilities, --caps <caps...>` - Agent capabilities (space-separated)

**Examples:**
```bash
# Register basic agent
bun run cli register-agent "ai-analysis" "security-agent"

# Register agent with capabilities
bun run cli register-agent "ai-analysis" "analysis-agent" --capabilities "security-analysis" "code-review" "performance-testing"
```

### get-next-task

Get the next available task for an agent.

```bash
bun run cli get-next-task <agent-name> <project>
```

**Arguments:**
- `agent-name` - Agent name
- `project` - Project name or ID

**Examples:**
```bash
bun run cli get-next-task "security-agent" "ai-analysis"
```

### complete-task

Mark a task as completed with results.

```bash
bun run cli complete-task <agent-name> <project> <task-id> [options]
```

**Arguments:**
- `agent-name` - Agent name
- `project` - Project name or ID
- `task-id` - Task ID

**Options:**
- `--result, -r <json>` - Task result as JSON string (default: `'{"success": true}'`)

**Examples:**
```bash
# Complete task with default result
bun run cli complete-task "security-agent" "ai-analysis" "task-id"

# Complete task with custom result
bun run cli complete-task "security-agent" "ai-analysis" "task-id" --result '{"status": "completed", "findings": ["vulnerability1", "vulnerability2"]}'
```

### fail-task

Mark a task as failed with error information.

```bash
bun run cli fail-task <agent-name> <project> <task-id> [options]
```

**Arguments:**
- `agent-name` - Agent name
- `project` - Project name or ID
- `task-id` - Task ID

**Options:**
- `--result, -r <json>` - Failure result as JSON string (default: `'{"success": false, "error": "Task failed"}'`)

**Examples:**
```bash
# Fail task with default result
bun run cli fail-task "security-agent" "ai-analysis" "task-id"

# Fail task with custom error
bun run cli fail-task "security-agent" "ai-analysis" "task-id" --result '{"success": false, "error": "Network timeout", "retryable": true}'
```

## Monitoring and Operations

### health-check

Check the health status of the TaskDriver system.

```bash
bun run cli health-check
```

**Examples:**
```bash
bun run cli health-check
```

### get-project-stats

Get project statistics and status overview.

```bash
bun run cli get-project-stats <project>
```

**Arguments:**
- `project` - Project name or ID

**Examples:**
```bash
bun run cli get-project-stats "ai-analysis"
```

### cleanup-leases

Clean up expired leases for a project.

```bash
bun run cli cleanup-leases <project>
```

**Arguments:**
- `project` - Project name or ID

**Examples:**
```bash
bun run cli cleanup-leases "ai-analysis"
```

## File Reading Support

TaskDriver CLI supports reading content from files using the `@` prefix for:

- Project descriptions
- Project instructions
- Task type templates

**Syntax:**
```bash
# Read from file
--option "@path/to/file.txt"

# Inline content
--option "Inline content here"
```

**Examples:**
```bash
# Project with description from file
bun run cli create-project "my-project" "@project-description.txt"

# Project with instructions from file
bun run cli create-project "my-project" "Short description" --instructions "@instructions.md"

# Task type with template from file
bun run cli create-task-type "my-project" "analysis" --template "@analysis-template.md"
```

## Common Workflows

### Setting Up a New Project

1. Create the project:
   ```bash
   bun run cli create-project "my-project" "Project description" --instructions "@project-instructions.md"
   ```

2. Create task types:
   ```bash
   bun run cli create-task-type "my-project" "analysis" --template "@analysis-template.md" -v "target" "focus"
   ```

3. Register agents:
   ```bash
   bun run cli register-agent "my-project" "analysis-agent" --capabilities "code-analysis" "security-scan"
   ```

### Running Tasks

1. Create tasks:
   ```bash
   bun run cli create-task "my-project" -t "analysis" --variables '{"target": "webapp", "focus": "security"}'
   ```

2. Agents get tasks:
   ```bash
   bun run cli get-next-task "analysis-agent" "my-project"
   ```

3. Complete tasks:
   ```bash
   bun run cli complete-task "analysis-agent" "my-project" "task-id" --result '{"status": "completed", "findings": []}'
   ```

### Monitoring

1. Check project status:
   ```bash
   bun run cli get-project-stats "my-project"
   ```

2. List active tasks:
   ```bash
   bun run cli list-tasks "my-project" --status running
   ```

3. Clean up expired leases:
   ```bash
   bun run cli cleanup-leases "my-project"
   ```

## Error Handling

The CLI provides detailed error messages for common issues:

- **Project not found**: Check project name spelling or use project ID
- **Invalid JSON**: Ensure proper JSON formatting for variables and results
- **File not found**: Verify file paths when using `@` prefix
- **Validation errors**: Check input format and constraints

## Exit Codes

- `0` - Success
- `1` - General error (invalid arguments, operation failed, etc.)

## Environment Variables

The CLI respects these environment variables:

- `TASKDRIVER_STORAGE_PROVIDER` - Storage provider (file, mongodb, redis)
- `TASKDRIVER_LOG_LEVEL` - Log level (debug, info, warn, error)
- `TASKDRIVER_FILE_DATA_DIR` - Data directory for file storage

See [Configuration Guide](configuration.md) for complete environment variable reference.