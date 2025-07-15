/**
 * Real-world work scenario prompts for technical professionals
 */

import { PromptDefinition } from '../types.js';

export const logAnalysisPrompt: PromptDefinition = {
  name: "analyze-logs",
  description: "Analyze log files for errors, patterns, and insights",
  arguments: [
    {
      name: "project_name",
      description: "Project name for log analysis",
      required: true,
    },
    {
      name: "log_files",
      description: "Log files to analyze (paths or patterns)",
      required: true,
    },
    {
      name: "analysis_type",
      description: "Type of analysis: errors, performance, security, patterns, or all",
      required: true,
    },
    {
      name: "time_range",
      description: "Time range to analyze (e.g., 'last 24 hours', 'yesterday')",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, log_files, analysis_type, time_range } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up log analysis workflow for project "${project_name}".

**Analysis Configuration:**
- Log files: ${log_files}
- Analysis type: ${analysis_type}
${time_range ? `- Time range: ${time_range}` : ''}

Please help me:
1. Create project "${project_name}" for log analysis
2. Create task types for ${analysis_type} analysis
3. Create tasks to process each log file
4. Set up pattern detection and alerting rules
5. Configure result aggregation and reporting
6. **Create follow-up tasks for identified issues so nothing gets forgotten**

**Analysis Focus:**
- Extract error patterns and frequencies
- Identify performance bottlenecks
- Detect security incidents or anomalies
- Generate actionable insights and recommendations
- **Create investigation tasks for anomalies that need deeper analysis**
- **Create fix tasks for confirmed issues to ensure resolution**

Use get_next_task to distribute log analysis work. Agent names auto-generated.`,
          },
        },
      ],
    };
  },
};

export const dataValidationPrompt: PromptDefinition = {
  name: "validate-data",
  description: "Validate data files, databases, or API responses for quality and consistency",
  arguments: [
    {
      name: "project_name",
      description: "Project name for data validation",
      required: true,
    },
    {
      name: "data_sources",
      description: "Data sources to validate (files, databases, APIs)",
      required: true,
    },
    {
      name: "validation_rules",
      description: "Validation rules (schema, format, business rules)",
      required: true,
    },
    {
      name: "output_format",
      description: "Report format: summary, detailed, or dashboard",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, data_sources, validation_rules, output_format = "detailed" } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up data validation workflow for project "${project_name}".

**Validation Configuration:**
- Data sources: ${data_sources}
- Validation rules: ${validation_rules}
- Output format: ${output_format}

Please help me:
1. Create project "${project_name}" for data validation
2. Create task types for different validation rules
3. Create validation tasks for each data source
4. Set up data quality checks and scoring
5. Configure violation reporting and alerting
6. **Create remediation tasks for data quality issues to ensure they get fixed**

**Validation Categories:**
- Schema validation (structure, types, required fields)
- Data quality checks (completeness, accuracy, consistency)
- Business rule validation (logic, constraints, relationships)
- Format validation (dates, emails, phone numbers, etc.)
- **Issue tracking: Create investigation tasks for suspicious patterns**
- **Remediation: Create fix tasks for confirmed data quality problems**

Agents will use get_next_task to pull validation work. No agent setup required.`,
          },
        },
      ],
    };
  },
};

export const migrationTasksPrompt: PromptDefinition = {
  name: "migration-tasks",
  description: "Break down and track database, code, or infrastructure migrations",
  arguments: [
    {
      name: "project_name",
      description: "Project name for migration",
      required: true,
    },
    {
      name: "migration_type",
      description: "Type of migration (database, code, infrastructure, cloud)",
      required: true,
    },
    {
      name: "source_system",
      description: "What you're migrating from",
      required: true,
    },
    {
      name: "target_system",
      description: "What you're migrating to",
      required: true,
    },
    {
      name: "migration_scope",
      description: "Scope of migration (files, tables, services, etc.)",
      required: true,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, migration_type, source_system, target_system, migration_scope } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up migration workflow for project "${project_name}".

**Migration Configuration:**
- Migration type: ${migration_type}
- From: ${source_system}
- To: ${target_system}
- Scope: ${migration_scope}

Please help me:
1. Create project "${project_name}" for migration tracking
2. Break down migration into manageable tasks
3. Create task types for different migration phases
4. Set up validation and rollback procedures
5. Create progress tracking and reporting

**Migration Phases:**
- Pre-migration analysis and planning
- Data/code transformation tasks
- Validation and testing tasks
- Rollback and contingency planning
- Post-migration cleanup and optimization

Use get_next_task to distribute migration work. Agent names auto-generated.`,
          },
        },
      ],
    };
  },
};

export const securityAuditPrompt: PromptDefinition = {
  name: "security-audit",
  description: "Perform security audit on code, configurations, or systems",
  arguments: [
    {
      name: "project_name",
      description: "Project name for security audit",
      required: true,
    },
    {
      name: "audit_targets",
      description: "What to audit (code, configs, infrastructure, dependencies)",
      required: true,
    },
    {
      name: "security_frameworks",
      description: "Security frameworks to follow (OWASP, NIST, CIS, etc.)",
      required: false,
    },
    {
      name: "severity_threshold",
      description: "Minimum severity to report: low, medium, high, critical",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, audit_targets, security_frameworks, severity_threshold = "medium" } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up security audit workflow for project "${project_name}".

**Audit Configuration:**
- Audit targets: ${audit_targets}
- Severity threshold: ${severity_threshold}
${security_frameworks ? `- Security frameworks: ${security_frameworks}` : ''}

Please help me:
1. Create project "${project_name}" for security audit
2. Create task types for different audit categories
3. Create audit tasks for each target
4. Set up vulnerability scanning and detection
5. Configure risk assessment and reporting
6. **Create remediation tasks for each security finding to track fixes**

**Audit Categories:**
- Code security (injection, XSS, authentication flaws)
- Configuration security (permissions, secrets, hardening)
- Dependency security (vulnerable packages, licensing)
- Infrastructure security (network, access controls)
- **Investigation: Create tasks to analyze potential security risks**
- **Remediation: Create fix tasks for confirmed vulnerabilities by priority**

Agents will use get_next_task to pull audit work. No agent management needed.`,
          },
        },
      ],
    };
  },
};

export const configAuditPrompt: PromptDefinition = {
  name: "audit-configs",
  description: "Audit configuration files for consistency, security, and best practices",
  arguments: [
    {
      name: "project_name",
      description: "Project name for config audit",
      required: true,
    },
    {
      name: "config_paths",
      description: "Configuration files or directories to audit",
      required: true,
    },
    {
      name: "config_types",
      description: "Types of configs (env, yaml, json, properties, etc.)",
      required: true,
    },
    {
      name: "audit_rules",
      description: "What to check for (secrets, duplicates, standards, security)",
      required: true,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, config_paths, config_types, audit_rules } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up configuration audit workflow for project "${project_name}".

**Audit Configuration:**
- Config paths: ${config_paths}
- Config types: ${config_types}
- Audit rules: ${audit_rules}

Please help me:
1. Create project "${project_name}" for config audit
2. Create task types for different config types
3. Create audit tasks for each config file
4. Set up validation rules and security checks
5. Generate recommendations and fixes
6. **Create fix tasks for each config issue to ensure resolution**

**Audit Checks:**
- Security: hardcoded secrets, insecure defaults, permissions
- Consistency: naming conventions, value formats, duplicates
- Best practices: environment-specific configs, documentation
- Compliance: organizational standards, regulatory requirements
- **Investigation: Create tasks to analyze config inconsistencies and patterns**
- **Remediation: Create fix tasks for config violations and standardization**

Use get_next_task to distribute config audit work. Agent names auto-generated.`,
          },
        },
      ],
    };
  },
};

export const dataProcessingPrompt: PromptDefinition = {
  name: "process-data",
  description: "Process, transform, and analyze large datasets",
  arguments: [
    {
      name: "project_name",
      description: "Project name for data processing",
      required: true,
    },
    {
      name: "data_sources",
      description: "Data sources (files, databases, APIs, streams)",
      required: true,
    },
    {
      name: "processing_tasks",
      description: "Processing tasks (clean, transform, aggregate, analyze)",
      required: true,
    },
    {
      name: "output_destination",
      description: "Where to store results (file, database, dashboard)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, data_sources, processing_tasks, output_destination } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up data processing pipeline for project "${project_name}".

**Processing Configuration:**
- Data sources: ${data_sources}
- Processing tasks: ${processing_tasks}
${output_destination ? `- Output destination: ${output_destination}` : ''}

Please help me:
1. Create project "${project_name}" for data processing
2. Create task types for each processing step
3. Create processing tasks for each data source
4. Set up data pipeline and workflow orchestration
5. Configure result storage and reporting

**Processing Pipeline:**
- Data ingestion and validation
- Cleaning and preprocessing
- Transformation and enrichment
- Analysis and aggregation
- Output generation and storage

Agents will use get_next_task to pull processing work. No agent setup required.`,
          },
        },
      ],
    };
  },
};

export const deploymentChecksPrompt: PromptDefinition = {
  name: "deployment-checks",
  description: "Run pre-deployment and post-deployment verification checks",
  arguments: [
    {
      name: "project_name",
      description: "Project name for deployment checks",
      required: true,
    },
    {
      name: "deployment_type",
      description: "Type of deployment (staging, production, hotfix)",
      required: true,
    },
    {
      name: "check_categories",
      description: "Categories to check (tests, security, performance, integration)",
      required: true,
    },
    {
      name: "environment_details",
      description: "Environment details (URLs, databases, services)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, deployment_type, check_categories, environment_details } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up deployment verification workflow for project "${project_name}".

**Deployment Configuration:**
- Deployment type: ${deployment_type}
- Check categories: ${check_categories}
${environment_details ? `- Environment: ${environment_details}` : ''}

Please help me:
1. Create project "${project_name}" for deployment checks
2. Create task types for each check category
3. Create verification tasks for all critical paths
4. Set up automated test execution
5. Configure go/no-go decision reporting
6. **Create investigation tasks for check failures that need root cause analysis**
7. **Create fix tasks for deployment issues to ensure successful rollout**

**Check Categories:**
- Pre-deployment: code quality, security scans, dependency checks
- Deployment: service health, configuration validation, connectivity
- Post-deployment: smoke tests, performance verification, rollback readiness
- **Issue tracking: Create tasks to investigate test failures and performance regressions**

Use get_next_task to distribute deployment verification work. Agent names auto-generated.`,
          },
        },
      ],
    };
  },
};