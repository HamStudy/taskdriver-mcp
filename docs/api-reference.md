# HTTP API Reference

Complete reference for TaskDriver's HTTP REST API.

## Overview

TaskDriver provides a comprehensive REST API for managing projects, tasks, agents, and monitoring system health. The API follows REST conventions and returns JSON responses.

## Base URL

When running the HTTP server:
```
http://localhost:3000/api
```

## Authentication

The API uses session-based authentication with Bearer tokens.

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "agentName": "my-agent",
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "token": "bearer-token-here",
    "expiresAt": "2024-01-01T12:00:00Z"
  }
}
```

### Using Authentication

Include the token in the `Authorization` header:
```http
Authorization: Bearer your-token-here
```

### Logout

```http
POST /api/auth/logout
Authorization: Bearer your-token-here
```

## Project Management

### List Projects

```http
GET /api/projects
Authorization: Bearer your-token-here
```

**Query Parameters:**
- `status` (optional) - Filter by status: `active`, `closed`, `all`
- `limit` (optional) - Maximum number to return (1-100)
- `offset` (optional) - Number to skip

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "ai-analysis",
      "description": "AI-powered code analysis",
      "instructions": "Follow security best practices...",
      "status": "active",
      "createdAt": "2024-01-01T10:00:00Z",
      "updatedAt": "2024-01-01T10:00:00Z",
      "config": {
        "defaultMaxRetries": 3,
        "defaultLeaseDurationMinutes": 10,
        "reaperIntervalMinutes": 1
      },
      "stats": {
        "totalTasks": 100,
        "completedTasks": 80,
        "failedTasks": 5,
        "queuedTasks": 10,
        "runningTasks": 5
      }
    }
  ]
}
```

### Create Project

```http
POST /api/projects
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "name": "ai-analysis",
  "description": "AI-powered code analysis project",
  "instructions": "Follow security best practices when analyzing code...",
  "config": {
    "defaultMaxRetries": 3,
    "defaultLeaseDurationMinutes": 15,
    "reaperIntervalMinutes": 2
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "ai-analysis",
    "description": "AI-powered code analysis project",
    "instructions": "Follow security best practices when analyzing code...",
    "status": "active",
    "createdAt": "2024-01-01T10:00:00Z",
    "updatedAt": "2024-01-01T10:00:00Z",
    "config": {
      "defaultMaxRetries": 3,
      "defaultLeaseDurationMinutes": 15,
      "reaperIntervalMinutes": 2
    },
    "stats": {
      "totalTasks": 0,
      "completedTasks": 0,
      "failedTasks": 0,
      "queuedTasks": 0,
      "runningTasks": 0
    }
  }
}
```

### Get Project

```http
GET /api/projects/{projectId}
Authorization: Bearer your-token-here
```

### Update Project

```http
PUT /api/projects/{projectId}
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "description": "Updated description",
  "instructions": "Updated instructions...",
  "status": "active",
  "config": {
    "defaultMaxRetries": 5
  }
}
```

### Delete Project

```http
DELETE /api/projects/{projectId}
Authorization: Bearer your-token-here
```

### Get Project Statistics

```http
GET /api/projects/{projectId}/stats
Authorization: Bearer your-token-here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "ai-analysis",
      "stats": {
        "totalTasks": 100,
        "completedTasks": 80,
        "failedTasks": 5,
        "queuedTasks": 10,
        "runningTasks": 5
      }
    },
    "queueDepth": 10,
    "activeAgents": 3,
    "recentActivity": {
      "tasksCompletedLastHour": 15,
      "tasksFailedLastHour": 2,
      "averageTaskDuration": 45.5
    }
  }
}
```

## Task Type Management

### List Task Types

```http
GET /api/projects/{projectId}/task-types
Authorization: Bearer your-token-here
```

### Create Task Type

```http
POST /api/projects/{projectId}/task-types
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "name": "code-security-analysis",
  "template": "Analyze {{repository_url}} for security vulnerabilities focusing on {{security_aspects}}",
  "variables": ["repository_url", "security_aspects"],
  "duplicateHandling": "ignore",
  "maxRetries": 3,
  "leaseDurationMinutes": 30
}
```

### Get Task Type

```http
GET /api/task-types/{typeId}
Authorization: Bearer your-token-here
```

### Update Task Type

```http
PUT /api/task-types/{typeId}
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "template": "Updated template...",
  "maxRetries": 5
}
```

### Delete Task Type

```http
DELETE /api/task-types/{typeId}
Authorization: Bearer your-token-here
```

## Task Management

### List Tasks

```http
GET /api/projects/{projectId}/tasks
Authorization: Bearer your-token-here
```

**Query Parameters:**
- `status` (optional) - Filter by status: `queued`, `running`, `completed`, `failed`
- `assignedTo` (optional) - Filter by assigned agent name
- `batchId` (optional) - Filter by batch ID
- `typeId` (optional) - Filter by task type ID
- `limit` (optional) - Maximum number to return (1-1000)
- `offset` (optional) - Number to skip

### Create Task

```http
POST /api/projects/{projectId}/tasks
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "typeId": "660e8400-e29b-41d4-a716-446655440001",
  "instructions": "Analyze security vulnerabilities in authentication system",
  "variables": {
    "repository_url": "https://github.com/company/webapp",
    "security_aspects": "authentication,authorization,input-validation"
  },
  "batchId": "batch-security-audit-2024"
}
```

### Create Tasks in Bulk

```http
POST /api/projects/{projectId}/tasks/bulk
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "tasks": [
    {
      "typeId": "660e8400-e29b-41d4-a716-446655440001",
      "instructions": "Analyze module A",
      "variables": {
        "module": "authentication"
      }
    },
    {
      "typeId": "660e8400-e29b-41d4-a716-446655440001",
      "instructions": "Analyze module B",
      "variables": {
        "module": "authorization"
      }
    }
  ],
  "batchId": "batch-security-audit-2024"
}
```

### Get Task

```http
GET /api/tasks/{taskId}
Authorization: Bearer your-token-here
```

### Update Task

```http
PUT /api/tasks/{taskId}
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "instructions": "Updated instructions...",
  "variables": {
    "updated_variable": "new_value"
  }
}
```

### Delete Task

```http
DELETE /api/tasks/{taskId}
Authorization: Bearer your-token-here
```

## Agent Management

### List Agents

```http
GET /api/projects/{projectId}/agents
Authorization: Bearer your-token-here
```

### Create Agent

```http
POST /api/projects/{projectId}/agents
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "name": "security-analysis-agent",
  "capabilities": ["security-analysis", "code-review", "vulnerability-scanning"]
}
```

### Get Agent

```http
GET /api/agents/{agentId}
Authorization: Bearer your-token-here
```

### Update Agent

```http
PUT /api/agents/{agentId}
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "capabilities": ["security-analysis", "code-review", "penetration-testing"]
}
```

### Delete Agent

```http
DELETE /api/agents/{agentId}
Authorization: Bearer your-token-here
```

## Task Operations

### Get Next Task

```http
POST /api/agents/{agentName}/next-task
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "capabilities": ["security-analysis", "code-review"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "typeId": "660e8400-e29b-41d4-a716-446655440001",
    "instructions": "Analyze security vulnerabilities...",
    "variables": {
      "repository_url": "https://github.com/company/webapp"
    },
    "status": "running",
    "assignedTo": "security-analysis-agent",
    "assignedAt": "2024-01-01T11:00:00Z",
    "leaseExpiresAt": "2024-01-01T11:30:00Z",
    "createdAt": "2024-01-01T10:30:00Z"
  }
}
```

### Complete Task

```http
POST /api/tasks/{taskId}/complete
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "result": "Security analysis completed successfully. Found 3 critical vulnerabilities.",
  "outputs": {
    "vulnerabilities_found": 8,
    "critical_count": 3,
    "high_count": 0,
    "medium_count": 5,
    "report_url": "https://reports.example.com/security-123"
  }
}
```

### Fail Task

```http
POST /api/tasks/{taskId}/fail
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "error": "Repository access denied. Authentication failed.",
  "canRetry": true
}
```

## Lease Management

### Clean Up Expired Leases

```http
POST /api/projects/{projectId}/cleanup-leases
Authorization: Bearer your-token-here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reclaimedTasks": 5,
    "cleanedAgents": 2
  }
}
```

### Extend Task Lease

```http
POST /api/tasks/{taskId}/extend-lease
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "extensionMinutes": 30
}
```

## Session Management

### Get Session Info

```http
GET /api/auth/session
Authorization: Bearer your-token-here
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "agentName": "security-analysis-agent",
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2024-01-01T10:00:00Z",
    "expiresAt": "2024-01-01T13:00:00Z",
    "lastActivity": "2024-01-01T11:30:00Z"
  }
}
```

### Update Session

```http
PUT /api/auth/session
Authorization: Bearer your-token-here
Content-Type: application/json

{
  "extendBy": 3600
}
```

## Monitoring Endpoints

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T12:00:00Z",
    "uptime": 3600,
    "storage": {
      "healthy": true,
      "provider": "file"
    }
  }
}
```

### Prometheus Metrics

```http
GET /metrics
```

Returns metrics in Prometheus format.

### JSON Metrics

```http
GET /metrics/json
```

**Response:**
```json
{
  "success": true,
  "data": {
    "requests_total": 1500,
    "requests_success": 1450,
    "requests_error": 50,
    "response_time_avg": 125.5,
    "active_sessions": 25,
    "system": {
      "memory_usage": 45.2,
      "cpu_usage": 12.8,
      "uptime": 3600
    }
  }
}
```

## Error Handling

All API endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-01-01T12:00:00Z",
  "correlationId": "req-123-456"
}
```

### Common HTTP Status Codes

- `200 OK` - Success
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Access denied
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (duplicate, etc.)
- `422 Unprocessable Entity` - Validation errors
- `500 Internal Server Error` - Server error

### Validation Errors

Validation errors return detailed information:

```json
{
  "success": false,
  "error": "Validation failed: name: Project name can only contain letters, numbers, hyphens, and underscores",
  "timestamp": "2024-01-01T12:00:00Z",
  "correlationId": "req-123-456",
  "validationDetails": [
    {
      "field": "name",
      "message": "Project name can only contain letters, numbers, hyphens, and underscores",
      "value": "invalid name!"
    }
  ]
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- Default: 100 requests per 15 minutes per IP
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Reset time

## CORS

Cross-Origin Resource Sharing (CORS) is enabled with configurable origins.

## Security Headers

Security headers are automatically applied using Helmet:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security` (HTTPS only)

## Request/Response Logging

All requests and responses are logged with correlation IDs for tracing.

## Client Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

class TaskDriverClient {
  constructor(baseURL = 'http://localhost:3000/api') {
    this.baseURL = baseURL;
    this.token = null;
  }

  async login(agentName, projectId) {
    const response = await axios.post(`${this.baseURL}/auth/login`, {
      agentName,
      projectId
    });
    this.token = response.data.data.token;
    return response.data.data;
  }

  async getNextTask(agentName, projectId, capabilities = []) {
    const response = await axios.post(
      `${this.baseURL}/agents/${agentName}/next-task`,
      { projectId, capabilities },
      { headers: { Authorization: `Bearer ${this.token}` } }
    );
    return response.data.data;
  }

  async completeTask(taskId, result, outputs = {}) {
    const response = await axios.post(
      `${this.baseURL}/tasks/${taskId}/complete`,
      { result, outputs },
      { headers: { Authorization: `Bearer ${this.token}` } }
    );
    return response.data.data;
  }
}

// Usage
const client = new TaskDriverClient();
await client.login('my-agent', 'project-id');
const task = await client.getNextTask('my-agent', 'project-id', ['analysis']);
await client.completeTask(task.id, 'Task completed successfully');
```

### Python

```python
import requests

class TaskDriverClient:
    def __init__(self, base_url='http://localhost:3000/api'):
        self.base_url = base_url
        self.token = None
    
    def login(self, agent_name, project_id):
        response = requests.post(f'{self.base_url}/auth/login', json={
            'agentName': agent_name,
            'projectId': project_id
        })
        data = response.json()
        if data['success']:
            self.token = data['data']['token']
            return data['data']
        raise Exception(data['error'])
    
    def get_next_task(self, agent_name, project_id, capabilities=None):
        response = requests.post(
            f'{self.base_url}/agents/{agent_name}/next-task',
            json={'projectId': project_id, 'capabilities': capabilities or []},
            headers={'Authorization': f'Bearer {self.token}'}
        )
        data = response.json()
        if data['success']:
            return data['data']
        raise Exception(data['error'])
    
    def complete_task(self, task_id, result, outputs=None):
        response = requests.post(
            f'{self.base_url}/tasks/{task_id}/complete',
            json={'result': result, 'outputs': outputs or {}},
            headers={'Authorization': f'Bearer {self.token}'}
        )
        data = response.json()
        if data['success']:
            return data['data']
        raise Exception(data['error'])

# Usage
client = TaskDriverClient()
client.login('my-agent', 'project-id')
task = client.get_next_task('my-agent', 'project-id', ['analysis'])
client.complete_task(task['id'], 'Task completed successfully')
```

## OpenAPI/Swagger Documentation

When running the HTTP server, interactive API documentation is available at:
```
http://localhost:3000/api/docs
```

This provides a complete interactive interface for testing all endpoints.