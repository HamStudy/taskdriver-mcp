# MCP Tools Reference

Complete reference for TaskDriver's Model Context Protocol (MCP) tools.

## Overview

TaskDriver provides 19 MCP tools for complete task management and orchestration. These tools enable LLM agents to create projects, manage tasks, coordinate with other agents, and monitor system health.

## Getting Started

### Starting the MCP Server

```bash
bun run mcp
```

The server runs on stdio transport and provides all tools immediately.

### Important Usage Notes

**Before starting any task**, agents should:
1. Get project details using `get_project` to read project instructions
2. Review project-specific guidance and requirements
3. Understand the context and constraints

## Project Management Tools

### create_project

Create a new project for organizing tasks and agents.

**Parameters:**
- `name` (required) - Project name (alphanumeric, hyphens, underscores only)
- `description` (required) - Project description
- `instructions` (optional) - Project instructions for agents - important guidance that should be read before starting any task
- `config` (optional) - Project configuration
  - `defaultMaxRetries` (0-10) - Default max retries for tasks
  - `defaultLeaseDurationMinutes` (1-1440) - Default lease duration in minutes
  - `reaperIntervalMinutes` (1-60) - Reaper interval for cleaning up expired tasks

**Example:**
```json
{
  "name": "ai-code-analysis",
  "description": "AI-powered code analysis and review project",
  "instructions": "Before starting any task, review the project guidelines and coding standards. Focus on security, performance, and maintainability.",
  "config": {
    "defaultMaxRetries": 3,
    "defaultLeaseDurationMinutes": 15,
    "reaperIntervalMinutes": 5
  }
}
```

### list_projects

List all projects with optional filtering.

**Parameters:**
- `status` (optional) - Filter by status: `active`, `closed`, `all` (default: active)
- `limit` (optional) - Maximum number of projects to return (1-100)
- `offset` (optional) - Number of projects to skip (minimum: 0)

**Example:**
```json
{
  "status": "active",
  "limit": 10
}
```

### get_project

Get detailed information about a specific project. This includes project instructions that agents should read before starting any task.

**Parameters:**
- `projectId` (required) - Project ID (UUID)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### update_project

Update project properties.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `description` (optional) - New project description
- `instructions` (optional) - New project instructions for agents
- `status` (optional) - Project status: `active`, `closed`
- `config` (optional) - Project configuration updates

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Updated project description",
  "instructions": "Updated instructions for agents",
  "status": "active"
}
```

## Task Type Management Tools

### create_task_type

Create a new task type template for a project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `name` (required) - Task type name (alphanumeric, hyphens, underscores only)
- `template` (optional) - Task instruction template with `{{variable}}` placeholders
- `variables` (optional) - Array of variable names used in the template
- `duplicateHandling` (optional) - How to handle duplicate tasks: `ignore`, `fail`, `allow` (default: allow)
- `maxRetries` (optional) - Maximum retry attempts (0-10)
- `leaseDurationMinutes` (optional) - Lease duration in minutes (1-1440)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "code-security-analysis",
  "template": "Analyze the codebase at {{repository_url}} on branch {{branch_name}} for security vulnerabilities. Focus on {{security_aspects}} and provide a detailed report.",
  "variables": ["repository_url", "branch_name", "security_aspects"],
  "duplicateHandling": "ignore",
  "maxRetries": 3,
  "leaseDurationMinutes": 30
}
```

### list_task_types

List all task types for a project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Task Management Tools

### create_task

Create a new task for execution.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `typeId` (required) - Task type ID (UUID)
- `instructions` (required) - Task instructions (can contain template variables)
- `variables` (optional) - Key-value pairs for template variable substitution
- `batchId` (optional) - Batch ID for grouping related tasks

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "typeId": "660e8400-e29b-41d4-a716-446655440001",
  "instructions": "Analyze security vulnerabilities in the authentication system",
  "variables": {
    "repository_url": "https://github.com/company/webapp",
    "branch_name": "main",
    "security_aspects": "authentication,authorization,input-validation"
  },
  "batchId": "batch-security-audit-2024"
}
```

### list_tasks

List tasks with optional filtering.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `status` (optional) - Filter by task status: `queued`, `running`, `completed`, `failed`
- `assignedTo` (optional) - Filter by assigned agent name
- `batchId` (optional) - Filter by batch ID
- `typeId` (optional) - Filter by task type ID
- `limit` (optional) - Maximum number of tasks to return (1-1000, default: 100)
- `offset` (optional) - Number of tasks to skip (minimum: 0)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "limit": 50,
  "offset": 0
}
```

### get_task

Get detailed information about a specific task.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `taskId` (required) - Task ID (UUID)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "taskId": "770e8400-e29b-41d4-a716-446655440002"
}
```

## Agent Management Tools

### register_agent

Register a new agent for task execution.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `name` (optional) - Agent name (will be auto-generated if not provided)
- `capabilities` (optional) - Array of capabilities or task types this agent can handle

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "security-analysis-agent",
  "capabilities": ["security-analysis", "code-review", "vulnerability-scanning"]
}
```

### list_agents

List all agents for a project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Task Execution Tools

### assign_task

Assign a queued task to an agent for execution. Before starting any task, agents should first get project instructions using get_project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `agentName` (required) - Agent name requesting task assignment
- `capabilities` (optional) - Array of agent capabilities for task matching

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "agentName": "security-analysis-agent",
  "capabilities": ["security-analysis", "code-review"]
}
```

### complete_task

Mark a task as completed with results. Before starting any task, agents should first get project instructions using get_project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `taskId` (required) - Task ID (UUID)
- `result` (required) - Task execution result
- `outputs` (optional) - Structured task outputs

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "taskId": "770e8400-e29b-41d4-a716-446655440002",
  "result": "Security analysis completed successfully. Found 3 critical vulnerabilities and 5 medium-risk issues.",
  "outputs": {
    "vulnerabilities_found": 8,
    "critical_count": 3,
    "high_count": 0,
    "medium_count": 5,
    "report_url": "https://reports.example.com/security-123"
  }
}
```

### fail_task

Mark a task as failed with error information. Before starting any task, agents should first get project instructions using get_project.

**Parameters:**
- `projectId` (required) - Project ID (UUID)
- `taskId` (required) - Task ID (UUID)
- `error` (required) - Error message or description
- `canRetry` (optional) - Whether the task can be retried (default: true)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "taskId": "770e8400-e29b-41d4-a716-446655440002",
  "error": "Repository access denied. Authentication failed.",
  "canRetry": true
}
```

## Status and Monitoring Tools

### get_project_stats

Get project statistics and status overview.

**Parameters:**
- `projectId` (required) - Project ID (UUID)

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### health_check

Check the health status of the TaskDriver system.

**Parameters:** None

**Example:**
```json
{}
```

## Lease Management Tools

### extend_task_lease

Extend the lease duration for a running task to give an agent more time.

**Parameters:**
- `taskId` (required) - ID of the task to extend the lease for
- `extensionMinutes` (required) - Number of minutes to extend the lease by (1-1440)

**Example:**
```json
{
  "taskId": "770e8400-e29b-41d4-a716-446655440002",
  "extensionMinutes": 30
}
```

### get_lease_stats

Get lease and task statistics for a project to monitor system health.

**Parameters:**
- `projectId` (required) - ID of the project to get lease statistics for

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### cleanup_expired_leases

Manually trigger cleanup of expired task leases for a project.

**Parameters:**
- `projectId` (required) - ID of the project to cleanup expired leases for

**Example:**
```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Common Workflows

### Agent Task Execution Workflow

1. **Get Project Instructions** (Essential first step):
   ```json
   {
     "tool": "get_project",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000"
     }
   }
   ```

2. **Register Agent** (if not already registered):
   ```json
   {
     "tool": "register_agent",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000",
       "name": "my-agent",
       "capabilities": ["analysis", "review"]
     }
   }
   ```

3. **Get Task Assignment**:
   ```json
   {
     "tool": "assign_task",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000",
       "agentName": "my-agent"
     }
   }
   ```

4. **Complete Task**:
   ```json
   {
     "tool": "complete_task",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000",
       "taskId": "task-id",
       "result": "Task completed successfully"
     }
   }
   ```

### Project Setup Workflow

1. **Create Project**:
   ```json
   {
     "tool": "create_project",
     "parameters": {
       "name": "my-project",
       "description": "Project description",
       "instructions": "Important instructions for agents"
     }
   }
   ```

2. **Create Task Types**:
   ```json
   {
     "tool": "create_task_type",
     "parameters": {
       "projectId": "project-id",
       "name": "analysis-task",
       "template": "Analyze {{target}} for {{focus}}"
     }
   }
   ```

3. **Create Tasks**:
   ```json
   {
     "tool": "create_task",
     "parameters": {
       "projectId": "project-id",
       "typeId": "task-type-id",
       "instructions": "Specific task instructions",
       "variables": {"target": "webapp", "focus": "security"}
     }
   }
   ```

### Monitoring Workflow

1. **Check Project Status**:
   ```json
   {
     "tool": "get_project_stats",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000"
     }
   }
   ```

2. **Monitor System Health**:
   ```json
   {
     "tool": "health_check",
     "parameters": {}
   }
   ```

3. **Clean Up Expired Leases**:
   ```json
   {
     "tool": "cleanup_expired_leases",
     "parameters": {
       "projectId": "550e8400-e29b-41d4-a716-446655440000"
     }
   }
   ```

## Best Practices

### For Agents

1. **Always read project instructions first** using `get_project`
2. **Register with appropriate capabilities** that match available task types
3. **Handle task failures gracefully** with meaningful error messages
4. **Extend leases** for long-running tasks using `extend_task_lease`
5. **Provide structured outputs** in `complete_task` for better tracking

### For Project Managers

1. **Provide clear project instructions** that agents should follow
2. **Create specific task types** with well-defined templates
3. **Monitor project statistics** regularly using `get_project_stats`
4. **Clean up expired leases** periodically
5. **Use batch IDs** to group related tasks for better organization

### Error Handling

- Check tool responses for error conditions
- Retry failed operations with appropriate backoff
- Use `fail_task` with meaningful error messages
- Monitor lease expiration and extend when necessary

## Integration Examples

### With LangChain

```python
from langchain.tools import Tool

def create_taskdriver_tools(mcp_client):
    return [
        Tool(
            name="get_project",
            description="Get project details and instructions",
            func=lambda project_id: mcp_client.call_tool("get_project", {"projectId": project_id})
        ),
        Tool(
            name="assign_task",
            description="Get next task assignment",
            func=lambda project_id, agent_name: mcp_client.call_tool("assign_task", {
                "projectId": project_id,
                "agentName": agent_name
            })
        ),
        # ... more tools
    ]
```

### With AutoGen

```python
from autogen import ConversableAgent

def create_taskdriver_agent(mcp_client):
    return ConversableAgent(
        name="taskdriver_agent",
        system_message="You are a task management agent. Always get project instructions before starting work.",
        tools=[
            {
                "name": "get_project",
                "description": "Get project details and instructions",
                "parameters": {"projectId": {"type": "string"}},
                "function": lambda project_id: mcp_client.call_tool("get_project", {"projectId": project_id})
            }
        ]
    )
```

## Troubleshooting

### Common Issues

1. **"Project not found"** - Verify project ID is correct
2. **"Agent not registered"** - Use `register_agent` first
3. **"No tasks available"** - Check if tasks exist and are queued
4. **"Lease expired"** - Task took too long, extend lease or handle failure
5. **"Validation error"** - Check parameter types and constraints

### Debug Steps

1. Use `health_check` to verify system status
2. Check `get_project_stats` for project health
3. List tasks to verify they exist and are in expected state
4. Monitor lease statistics with `get_lease_stats`
5. Clean up expired leases if needed

For more detailed troubleshooting, see the [Configuration Guide](configuration.md) and [Architecture Overview](architecture.md).