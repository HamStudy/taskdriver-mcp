# TaskDriver MCP Tools Documentation

Generated: 2025-07-15T20:58:15.528Z

This document contains all 21 MCP tools available in the TaskDriver system, including their enhanced descriptions for LLM agent discoverability.

## Summary

Total tools: 21
Tools with enhanced discoverability: 2

## Tool Categories

### Project Management
- create_project
- list_projects
- get_project
- update_project
- get_project_stats

### Task Management  
- create_task_type
- list_task_types
- get_task_type
- create_task
- create_tasks_bulk
- list_tasks
- get_task
- get_next_task
- peek_next_task
- complete_task
- fail_task
- extend_task_lease

### Agent/Queue Operations
- get_next_task
- peek_next_task
- list_active_agents
- complete_task
- fail_task
- extend_task_lease

### System Operations
- health_check
- get_lease_stats
- cleanup_expired_leases

---

## Detailed Tool Descriptions


### create_project

**Original Command:** createProject  
**CLI Name:** create-project  
**Enhanced Discoverability:** ✅ Yes

**Description:**
```
Create a new project workspace for organizing tasks and agents. Use this when starting a new workflow, breaking down complex work into manageable pieces, or organizing tasks by domain/topic. Projects contain task types (templates), tasks (work items), and agents (workers).

🔍 KEYWORDS: create, new, project, workspace, organize, start, begin, initialize

📋 USE WHEN: Starting a new workflow or initiative | Need to organize tasks by domain or topic | Setting up a structured work environment

⬅️ TYPICALLY AFTER: system initialization, planning phase

➡️ TYPICALLY BEFORE: create_task_type, create_task, get_next_task

✅ PREREQUISITES: Clear project requirements | Defined project scope

📤 RETURNS: Project ID for subsequent operations | Workspace ready for task types and tasks

❌ AVOID WHEN: Creating projects for single tasks | Using when project already exists
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "description": "Project name",
      "type": "string"
    },
    "description": {
      "description": "Project description (or @path/to/file.txt to read from file)",
      "type": "string"
    },
    "instructions": {
      "description": "Project instructions for agents (or @path/to/file.txt)",
      "type": "string"
    },
    "maxRetries": {
      "description": "Default maximum retries for tasks",
      "type": "number",
      "default": 3
    },
    "leaseDuration": {
      "description": "Default lease duration in minutes",
      "type": "number",
      "default": 10
    }
  },
  "required": [
    "name",
    "description"
  ],
  "additionalProperties": false
}
```

---


### list_projects

**Original Command:** listProjects  
**CLI Name:** list-projects  
**Enhanced Discoverability:** ❌ No

**Description:**
```
List all projects with filtering options. Use this to find existing projects, check project status, or get an overview of all workspaces. Helpful for discovering what projects already exist before creating new ones.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "status": {
      "description": "Filter by project status",
      "type": "string",
      "enum": [
        "active",
        "closed",
        "all"
      ],
      "default": "active"
    },
    "includeClosed": {
      "description": "Include closed projects",
      "type": "boolean",
      "default": false
    },
    "limit": {
      "description": "Maximum number of projects to return",
      "type": "number",
      "default": 100
    },
    "offset": {
      "description": "Number of projects to skip",
      "type": "number",
      "default": 0
    }
  },
  "additionalProperties": false
}
```

---


### get_project

**Original Command:** getProject  
**CLI Name:** get-project  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Get detailed information about a specific project including configuration, statistics, and metadata. Use this to understand project settings, check task counts, or verify project configuration before creating tasks.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### update_project

**Original Command:** updateProject  
**CLI Name:** update-project  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Update project properties such as description, instructions, status, or configuration. Use this to modify project settings, close completed projects, or update instructions for agents working on the project.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "description": {
      "description": "New project description (or @path/to/file.txt)",
      "type": "string"
    },
    "instructions": {
      "description": "New project instructions (or @path/to/file.txt)",
      "type": "string"
    },
    "status": {
      "description": "Project status",
      "type": "string",
      "enum": [
        "active",
        "closed"
      ]
    },
    "maxRetries": {
      "description": "Default maximum retries for tasks",
      "type": "number"
    },
    "leaseDuration": {
      "description": "Default lease duration in minutes",
      "type": "number"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### get_project_stats

**Original Command:** getProjectStats  
**CLI Name:** get-project-stats  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Get comprehensive project statistics including task counts, completion rates, agent activity, and performance metrics. Use this to monitor progress, track completion status, or generate reports on project health and activity.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### create_task_type

**Original Command:** createTaskType  
**CLI Name:** create-task-type  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Create a reusable task template/type with variables for generating multiple similar tasks. Use this when you need to repeat the same type of work with different inputs (e.g., "Analyze {{document}} for {{purpose}}"). Essential for batch processing and workflow automation.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "name": {
      "description": "Task type name",
      "type": "string"
    },
    "template": {
      "description": "Task template with variables like {{variable}} (or @path/to/file.txt)",
      "type": "string",
      "default": ""
    },
    "variables": {
      "description": "Template variables (space-separated)",
      "type": "array",
      "items": {
        "type": "string"
      },
      "default": []
    },
    "duplicateHandling": {
      "description": "How to handle duplicate tasks",
      "type": "string",
      "enum": [
        "allow",
        "ignore",
        "fail"
      ],
      "default": "allow"
    },
    "maxRetries": {
      "description": "Maximum retry attempts",
      "type": "number"
    },
    "leaseDurationMinutes": {
      "description": "Lease duration in minutes",
      "type": "number"
    }
  },
  "required": [
    "projectId",
    "name"
  ],
  "additionalProperties": false
}
```

---


### list_task_types

**Original Command:** listTaskTypes  
**CLI Name:** list-task-types  
**Enhanced Discoverability:** ❌ No

**Description:**
```
List all task templates/types in a project. Use this to see what task templates are available, find existing templates before creating new ones, or understand the types of work that can be automated in this project.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### get_task_type

**Original Command:** getTaskType  
**CLI Name:** get-task-type  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Get detailed information about a specific task template/type including its template structure, variables, and configuration. Use this to understand how to create tasks from this template or verify template settings.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "taskTypeId": {
      "description": "Task type ID",
      "type": "string"
    }
  },
  "required": [
    "taskTypeId"
  ],
  "additionalProperties": false
}
```

---


### create_task

**Original Command:** createTask  
**CLI Name:** create-task  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Create a single work item/task for agents to execute. Use this for individual tasks, one-off work items, or when you need precise control over each task. For creating many similar tasks, consider using create_tasks_bulk with a task template instead.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "type": {
      "description": "Task type ID or name",
      "type": "string"
    },
    "instructions": {
      "description": "Task instructions (required for non-template tasks)",
      "type": "string"
    },
    "id": {
      "description": "Custom task ID",
      "type": "string"
    },
    "description": {
      "description": "Human-readable task description",
      "type": "string"
    },
    "variables": {
      "description": "Variables as JSON string for template tasks",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### create_tasks_bulk

**Original Command:** createTasksBulk  
**CLI Name:** create-tasks-bulk  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Create many tasks at once from a JSON array - ideal for batch processing, breaking down large work into many similar tasks, or processing lists of items. Use this when you have many similar tasks to create (e.g., processing multiple files, analyzing multiple documents, or repeating work across datasets).
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "tasks": {
      "description": "JSON string or file path with array of task objects (use @file.json to read from file)",
      "type": "string"
    }
  },
  "required": [
    "projectId",
    "tasks"
  ],
  "additionalProperties": false
}
```

---


### list_tasks

**Original Command:** listTasks  
**CLI Name:** list-tasks  
**Enhanced Discoverability:** ❌ No

**Description:**
```
List and filter tasks in a project by status, type, or assigned agent. Use this to monitor task progress, find specific tasks, check what work is queued/completed, or track task assignment status. Essential for workflow monitoring and progress tracking.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "status": {
      "description": "Filter by task status",
      "type": "string",
      "enum": [
        "queued",
        "running",
        "completed",
        "failed"
      ]
    },
    "type": {
      "description": "Filter by task type ID or name",
      "type": "string"
    },
    "assignedTo": {
      "description": "Filter by assigned agent",
      "type": "string"
    },
    "limit": {
      "description": "Maximum number of tasks to return",
      "type": "number",
      "default": 50
    },
    "offset": {
      "description": "Number of tasks to skip",
      "type": "number",
      "default": 0
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### get_task

**Original Command:** getTask  
**CLI Name:** get-task  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Get detailed information about a specific task including its status, instructions, variables, assignment info, and execution history. Use this to check task details, verify task configuration, or troubleshoot task issues.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "description": "Task ID",
      "type": "string"
    }
  },
  "required": [
    "taskId"
  ],
  "additionalProperties": false
}
```

---


### get_next_task

**Original Command:** getNextTask  
**CLI Name:** get-next-task  
**Enhanced Discoverability:** ✅ Yes

**Description:**
```
Get the next available task from the project queue. If agentName is provided and has an existing task lease, that task is resumed. Otherwise assigns a new task. Agent names are only used for reconnection after disconnects.

🔍 KEYWORDS: get, next, task, assign, work, queue, pull, fetch, receive

📋 USE WHEN: Agent is ready to work on tasks | Need to resume interrupted work | Starting work session

⬅️ TYPICALLY AFTER: create_task, create_tasks_bulk, complete_task, fail_task

➡️ TYPICALLY BEFORE: complete_task, fail_task, extend_task_lease

✅ PREREQUISITES: Project exists with queued tasks | Agent ready to work

📤 RETURNS: Task with full instructions | Task lease for exclusive access | Agent name for reconnection

❌ AVOID WHEN: Getting tasks without ability to work on them | Multiple agents using same name simultaneously
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "agentName": {
      "description": "Agent name (optional - will be auto-generated if not provided)",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### peek_next_task

**Original Command:** peekNextTask  
**CLI Name:** peek-next-task  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Check if tasks are available in the project queue without assigning them. Returns success if tasks are available, error if queue is empty. Perfect for bash scripts: "while peek-next-task project; do launch_agent; done"
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### list_active_agents

**Original Command:** listActiveAgents  
**CLI Name:** list-active-agents  
**Enhanced Discoverability:** ❌ No

**Description:**
```
List agents currently working on tasks (agents with active task leases). This is for monitoring purposes - agents are ephemeral and only appear here when actively working.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### complete_task

**Original Command:** completeTask  
**CLI Name:** complete-task  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Mark a task as completed with results and optional structured outputs. This releases the task lease and makes the agent available for new work.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "agentName": {
      "description": "Agent name",
      "type": "string"
    },
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "taskId": {
      "description": "Task ID",
      "type": "string"
    },
    "result": {
      "description": "Task result (or @path/to/file.txt)",
      "type": "string"
    },
    "outputs": {
      "description": "Structured outputs as JSON string",
      "type": "string"
    }
  },
  "required": [
    "agentName",
    "projectId",
    "taskId",
    "result"
  ],
  "additionalProperties": false
}
```

---


### fail_task

**Original Command:** failTask  
**CLI Name:** fail-task  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Mark a task as failed with error details and retry options. This releases the task lease and either requeues the task for retry or marks it permanently failed.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "agentName": {
      "description": "Agent name",
      "type": "string"
    },
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    },
    "taskId": {
      "description": "Task ID",
      "type": "string"
    },
    "error": {
      "description": "Error message",
      "type": "string"
    },
    "canRetry": {
      "description": "Whether the task can be retried",
      "type": "boolean",
      "default": true
    }
  },
  "required": [
    "agentName",
    "projectId",
    "taskId",
    "error"
  ],
  "additionalProperties": false
}
```

---


### health_check

**Original Command:** healthCheck  
**CLI Name:** health-check  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Check TaskDriver system health including storage connectivity, resource availability, and system status. Use this to verify the system is operational before starting work or to troubleshoot issues.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

---


### extend_task_lease

**Original Command:** extendTaskLease  
**CLI Name:** extend-task-lease  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Extend the lease duration for a long-running task to prevent it from being reassigned to another agent. Use this when tasks take longer than expected to prevent timeout-based reassignment.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "description": "Task ID",
      "type": "string"
    },
    "extensionMinutes": {
      "description": "Minutes to extend lease by",
      "type": "number"
    }
  },
  "required": [
    "taskId",
    "extensionMinutes"
  ],
  "additionalProperties": false
}
```

---


### get_lease_stats

**Original Command:** getLeaseStats  
**CLI Name:** get-lease-stats  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Get statistics about task leases including active leases, expired leases, and lease duration metrics. Use this to monitor system performance, identify stuck tasks, or analyze task execution patterns.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


### cleanup_expired_leases

**Original Command:** cleanupExpiredLeases  
**CLI Name:** cleanup-leases  
**Enhanced Discoverability:** ❌ No

**Description:**
```
Clean up expired task leases and make abandoned tasks available for reassignment. Use this to recover from agent failures, clean up stuck tasks, or perform maintenance on the task queue.
```

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "projectId": {
      "description": "Project ID or name",
      "type": "string"
    }
  },
  "required": [
    "projectId"
  ],
  "additionalProperties": false
}
```

---


## Analysis

### Enhanced vs Basic Descriptions

**Tools with Enhanced Discoverability (2):**
- create_project
- get_next_task

**Tools with Basic Descriptions (19):**
- list_projects
- get_project
- update_project
- get_project_stats
- create_task_type
- list_task_types
- get_task_type
- create_task
- create_tasks_bulk
- list_tasks
- get_task
- peek_next_task
- list_active_agents
- complete_task
- fail_task
- health_check
- extend_task_lease
- get_lease_stats
- cleanup_expired_leases

### Discoverability Features

The enhanced descriptions include:
- 🔍 **KEYWORDS**: Trigger words that should make LLM agents consider this tool
- 📋 **USE WHEN**: Specific contexts where this tool is appropriate
- ⬅️ **TYPICALLY AFTER**: Tools that commonly precede this one in workflows
- ➡️ **TYPICALLY BEFORE**: Tools that commonly follow this one in workflows
- ✅ **PREREQUISITES**: Required conditions before using this tool
- 📤 **RETURNS**: Expected outcomes and return values
- ❌ **AVOID WHEN**: Anti-patterns and situations to avoid

### Example Enhanced Description

Here's how the enhanced description appears to LLM agents:

```
Create a new project workspace for organizing tasks and agents. Use this when starting a new workflow, breaking down complex work into manageable pieces, or organizing tasks by domain/topic. Projects contain task types (templates), tasks (work items), and agents (workers).

🔍 KEYWORDS: create, new, project, workspace, organize, start, begin, initialize

📋 USE WHEN: Starting a new workflow or initiative | Need to organize tasks by domain or topic | Setting up a structured work environment

⬅️ TYPICALLY AFTER: system initialization, planning phase

➡️ TYPICALLY BEFORE: create_task_type, create_task, get_next_task

✅ PREREQUISITES: Clear project requirements | Defined project scope

📤 RETURNS: Project ID for subsequent operations | Workspace ready for task types and tasks

❌ AVOID WHEN: Creating projects for single tasks | Using when project already exists
```

Compare this to a basic description:

```
List all projects with filtering options. Use this to find existing projects, check project status, or get an overview of all workspaces. Helpful for discovering what projects already exist before creating new ones.
```

The enhanced version provides much richer context for LLM agents to understand when and how to use each tool effectively.
