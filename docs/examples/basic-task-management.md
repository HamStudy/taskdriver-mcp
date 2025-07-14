# Basic Task Management Example

This example demonstrates the fundamental workflow of creating a project, defining task types, creating tasks, and having agents execute them.

## Scenario

You want to set up a basic code analysis project where agents can analyze different repositories for various aspects like security, performance, and code quality.

## Step 1: Set Up the Project

First, create a project to organize your tasks:

```bash
taskdriver create-project "code-analysis" "Automated code analysis project" \
  --instructions "Always provide detailed analysis reports with specific recommendations" \
  --max-retries 3 \
  --lease-duration 20
```

This creates a project with:
- Clear instructions for agents
- Up to 3 retry attempts for failed tasks
- 20-minute lease duration for each task

## Step 2: Create Task Types

Define reusable task templates:

### Security Analysis Task Type

```bash
taskdriver create-task-type "code-analysis" "security-scan" \
  --template "Perform security analysis on {{repository_url}} focusing on {{security_aspects}}. Generate a detailed report with findings and recommendations." \
  --variables "repository_url" "security_aspects" \
  --max-retries 2 \
  --lease-duration 30
```

### Performance Analysis Task Type

```bash
taskdriver create-task-type "code-analysis" "performance-analysis" \
  --template "Analyze performance bottlenecks in {{repository_url}} for {{component}}. Focus on {{performance_metrics}} and provide optimization recommendations." \
  --variables "repository_url" "component" "performance_metrics" \
  --max-retries 3 \
  --lease-duration 25
```

### Code Quality Review Task Type

```bash
taskdriver create-task-type "code-analysis" "quality-review" \
  --template "Review code quality for {{repository_url}} in {{language}}. Check for {{quality_aspects}} and provide improvement suggestions." \
  --variables "repository_url" "language" "quality_aspects" \
  --duplicate-handling "ignore"
```

## Step 3: Register Agents

Register agents with appropriate capabilities:

```bash
# Security specialist agent
taskdriver register-agent "code-analysis" "security-agent" \
  --capabilities "security-analysis" "vulnerability-scanning" "penetration-testing"

# Performance specialist agent
taskdriver register-agent "code-analysis" "performance-agent" \
  --capabilities "performance-analysis" "load-testing" "optimization"

# General code quality agent
taskdriver register-agent "code-analysis" "quality-agent" \
  --capabilities "code-review" "static-analysis" "best-practices"
```

## Step 4: Create Tasks

Now create specific tasks using the templates:

### Security Analysis Tasks

```bash
# Security scan for authentication module
taskdriver create-task "code-analysis" "security-scan-task-type-id" \
  "Security analysis for authentication system" \
  --variables '{"repository_url": "https://github.com/company/webapp", "security_aspects": "authentication,authorization,input-validation,session-management"}' \
  --batch-id "security-audit-2024-q1"

# Security scan for API endpoints
taskdriver create-task "code-analysis" "security-scan-task-type-id" \
  "Security analysis for API endpoints" \
  --variables '{"repository_url": "https://github.com/company/api", "security_aspects": "api-security,rate-limiting,data-validation,cors"}' \
  --batch-id "security-audit-2024-q1"
```

### Performance Analysis Tasks

```bash
# Database performance analysis
taskdriver create-task "code-analysis" "performance-analysis-task-type-id" \
  "Performance analysis for database layer" \
  --variables '{"repository_url": "https://github.com/company/webapp", "component": "database", "performance_metrics": "query-performance,connection-pooling,indexing"}' \
  --batch-id "performance-review-2024-q1"

# Frontend performance analysis
taskdriver create-task "code-analysis" "performance-analysis-task-type-id" \
  "Performance analysis for frontend" \
  --variables '{"repository_url": "https://github.com/company/frontend", "component": "frontend", "performance_metrics": "load-time,bundle-size,rendering-performance"}' \
  --batch-id "performance-review-2024-q1"
```

### Code Quality Review Tasks

```bash
# Python code quality review
taskdriver create-task "code-analysis" "quality-review-task-type-id" \
  "Code quality review for Python backend" \
  --variables '{"repository_url": "https://github.com/company/backend", "language": "python", "quality_aspects": "code-style,documentation,testing,maintainability"}' \
  --batch-id "quality-review-2024-q1"

# JavaScript code quality review
taskdriver create-task "code-analysis" "quality-review-task-type-id" \
  "Code quality review for JavaScript frontend" \
  --variables '{"repository_url": "https://github.com/company/frontend", "language": "javascript", "quality_aspects": "es6-standards,error-handling,performance,accessibility"}' \
  --batch-id "quality-review-2024-q1"
```

## Step 5: Agent Task Execution

Agents can now pick up and execute tasks:

### Security Agent Workflow

```bash
# Get next task
taskdriver get-next-task "security-agent" "code-analysis"

# Complete the task (example)
taskdriver complete-task "security-agent" "code-analysis" "task-id-here" \
  --result '{
    "status": "completed",
    "summary": "Security analysis completed for authentication system",
    "vulnerabilities_found": 3,
    "critical_issues": 1,
    "recommendations": [
      "Implement proper password hashing with bcrypt",
      "Add rate limiting to login endpoints",
      "Implement proper session management"
    ],
    "report_url": "https://reports.company.com/security-123"
  }'
```

### Performance Agent Workflow

```bash
# Get next task
taskdriver get-next-task "performance-agent" "code-analysis"

# Complete the task (example)
taskdriver complete-task "performance-agent" "code-analysis" "task-id-here" \
  --result '{
    "status": "completed",
    "summary": "Performance analysis completed for database layer",
    "performance_score": 7.5,
    "bottlenecks_found": 2,
    "recommendations": [
      "Add database indexes for frequently queried columns",
      "Implement connection pooling",
      "Optimize N+1 query patterns"
    ],
    "metrics": {
      "query_time_avg": 250,
      "slowest_queries": ["SELECT * FROM users WHERE email = ?"],
      "connection_pool_efficiency": 0.65
    }
  }'
```

### Quality Agent Workflow

```bash
# Get next task
taskdriver get-next-task "quality-agent" "code-analysis"

# Complete the task (example)
taskdriver complete-task "quality-agent" "code-analysis" "task-id-here" \
  --result '{
    "status": "completed",
    "summary": "Code quality review completed for Python backend",
    "quality_score": 8.2,
    "issues_found": 15,
    "recommendations": [
      "Add type hints to function signatures",
      "Increase test coverage from 65% to 85%",
      "Improve documentation for public APIs"
    ],
    "metrics": {
      "test_coverage": 0.65,
      "code_complexity": 6.8,
      "documentation_coverage": 0.45
    }
  }'
```

## Step 6: Monitor Progress

Track the progress of your analysis project:

```bash
# Check overall project status
taskdriver get-project-stats "code-analysis"

# List tasks by status
taskdriver list-tasks "code-analysis" --status completed
taskdriver list-tasks "code-analysis" --status running
taskdriver list-tasks "code-analysis" --status failed

# List tasks by batch
taskdriver list-tasks "code-analysis" --batch-id "security-audit-2024-q1"
taskdriver list-tasks "code-analysis" --batch-id "performance-review-2024-q1"
taskdriver list-tasks "code-analysis" --batch-id "quality-review-2024-q1"

# Check for any expired leases
taskdriver cleanup-leases "code-analysis"
```

## Step 7: Handle Failed Tasks

If tasks fail, they can be retried:

```bash
# If a task fails, the agent should report it
taskdriver fail-task "security-agent" "code-analysis" "failed-task-id" \
  --result '{
    "status": "failed",
    "error": "Repository access denied - authentication failed",
    "retryable": true,
    "troubleshooting": "Check repository permissions and access tokens"
  }'

# Failed tasks with remaining retries will be automatically queued again
# You can monitor failed tasks
taskdriver list-tasks "code-analysis" --status failed
```

## Expected Results

After running this workflow, you should have:

1. **Project Structure**: A well-organized project with clear instructions
2. **Task Types**: Reusable templates for different analysis types
3. **Specialized Agents**: Agents with specific capabilities for different analysis areas
4. **Batch Organization**: Tasks grouped by analysis type and time period
5. **Comprehensive Results**: Detailed analysis reports with actionable recommendations

## Key Benefits

- **Scalability**: Easy to add new repositories and analysis types
- **Specialization**: Different agents can focus on their areas of expertise
- **Batch Processing**: Group related tasks for better organization
- **Retry Logic**: Automatic handling of temporary failures
- **Monitoring**: Clear visibility into progress and results

## Next Steps

- Set up automated task creation based on code repository changes
- Create dashboards to visualize analysis results
- Implement integration with CI/CD pipelines
- Add notification systems for critical security findings
- Scale to multiple projects for different teams or applications