#!/usr/bin/env node

/**
 * TaskDriver CLI
 * Command-line interface for TaskDriver MCP Server
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { loadConfig } from './config/index.js';
import { createStorageProvider } from './storage/index.js';
import { ProjectService } from './services/ProjectService.js';
import { TaskTypeService } from './services/TaskTypeService.js';
import { TaskService } from './services/TaskService.js';
import { AgentService } from './services/AgentService.js';
import { LeaseService } from './services/LeaseService.js';
import { TaskFilters } from './types/index.js';

// Global services
let services: {
  project: ProjectService;
  taskType: TaskTypeService;
  task: TaskService;
  agent: AgentService;
  lease: LeaseService;
} | null = null;

async function initializeServices() {
  if (services) return services;
  
  try {
    const config = loadConfig();
    const storage = createStorageProvider(config);
    await storage.initialize();
    
    services = {
      project: new ProjectService(storage),
      taskType: new TaskTypeService(storage, new ProjectService(storage)),
      task: new TaskService(storage, new ProjectService(storage), new TaskTypeService(storage, new ProjectService(storage))),
      agent: new AgentService(storage, new ProjectService(storage), new TaskService(storage, new ProjectService(storage), new TaskTypeService(storage, new ProjectService(storage)))),
      lease: new LeaseService(storage)
    };
    
    return services;
  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize services:'), error);
    process.exit(1);
  }
}

function formatTable(data: any[], fields: string[]) {
  if (data.length === 0) return chalk.gray('No data found');
  
  const maxWidths = fields.map(field => 
    Math.max(field.length, ...data.map(item => String(item[field] || '').length))
  );
  
  let output = '';
  
  // Header
  output += chalk.bold(fields.map((field, i) => field.padEnd(maxWidths[i] || 0)).join(' | ')) + '\n';
  output += chalk.gray(fields.map((_, i) => '-'.repeat(maxWidths[i] || 0)).join('-+-')) + '\n';
  
  // Rows
  data.forEach(item => {
    output += fields.map((field, i) => String(item[field] || '').padEnd(maxWidths[i] || 0)).join(' | ') + '\n';
  });
  
  return output;
}

function formatProject(project: any) {
  return `
${chalk.bold.blue(project.name)} (${project.id})
${chalk.gray('Description:')} ${project.description || 'No description'}
${chalk.gray('Status:')} ${project.status === 'active' ? chalk.green(project.status) : chalk.yellow(project.status)}
${chalk.gray('Created:')} ${new Date(project.createdAt).toLocaleString()}

${chalk.bold('Configuration:')}
  Max Retries: ${project.config.defaultMaxRetries}
  Lease Duration: ${project.config.defaultLeaseDurationMinutes} minutes
  Reaper Interval: ${project.config.reaperIntervalMinutes} minutes

${chalk.bold('Statistics:')}
  Total Tasks: ${project.stats.totalTasks}
  Completed: ${chalk.green(project.stats.completedTasks)}
  Failed: ${chalk.red(project.stats.failedTasks)}
  Queued: ${chalk.yellow(project.stats.queuedTasks)}
  Running: ${chalk.blue(project.stats.runningTasks)}
`;
}

function formatTask(task: any) {
  const statusColors: Record<string, any> = {
    queued: chalk.yellow,
    running: chalk.blue,
    completed: chalk.green,
    failed: chalk.red
  };
  const statusColor = statusColors[task.status] || chalk.gray;
  
  return `
${chalk.bold('Task:')} ${task.id}
${chalk.gray('Type:')} ${task.typeId}
${chalk.gray('Status:')} ${statusColor(task.status)}
${chalk.gray('Instructions:')} ${task.instructions}
${chalk.gray('Created:')} ${new Date(task.createdAt).toLocaleString()}
${task.assignedTo ? chalk.gray('Assigned to:') + ' ' + task.assignedTo : ''}
${task.completedAt ? chalk.gray('Completed:') + ' ' + new Date(task.completedAt).toLocaleString() : ''}
${task.retryCount > 0 ? chalk.gray('Retry count:') + ' ' + task.retryCount : ''}
${task.variables ? chalk.gray('Variables:') + ' ' + JSON.stringify(task.variables) : ''}
${task.result ? chalk.gray('Result:') + ' ' + JSON.stringify(task.result, null, 2) : ''}
`;
}

const cli = yargs(hideBin(process.argv))
  .scriptName('taskdriver')
  .usage('$0 <command> [options]')
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .version()
  .alias('h', 'help')
  .alias('v', 'version')
  
  // Project Management Commands
  .command('create-project <name> <description>', 'Create a new project', (yargs) => {
    return yargs
      .positional('name', {
        describe: 'Project name',
        type: 'string'
      })
      .positional('description', {
        describe: 'Project description',
        type: 'string'
      })
      .option('max-retries', {
        alias: 'r',
        type: 'number',
        describe: 'Default maximum retries for tasks',
        default: 3
      })
      .option('lease-duration', {
        alias: 'l',
        type: 'number',
        describe: 'Default lease duration in minutes',
        default: 10
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      const project = await services.project.createProject({
        name: argv.name!,
        description: argv.description!,
        config: {
          defaultMaxRetries: argv['max-retries'],
          defaultLeaseDurationMinutes: argv['lease-duration'],
          reaperIntervalMinutes: 1
        }
      });
      
      console.log(chalk.green('✅ Project created successfully:'));
      console.log(formatProject(project));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to create project:'), error.message);
      process.exit(1);
    }
  })
  
  .command('list-projects', 'List all projects', (yargs) => {
    return yargs
      .option('include-closed', {
        alias: 'c',
        type: 'boolean',
        describe: 'Include closed projects',
        default: false
      })
      .option('format', {
        alias: 'f',
        type: 'string',
        choices: ['table', 'detailed'],
        describe: 'Output format',
        default: 'table'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      const projects = await services.project.listProjects(argv['include-closed']);
      
      if (projects.length === 0) {
        console.log(chalk.gray('No projects found'));
        return;
      }
      
      if (argv.format === 'table') {
        console.log(formatTable(projects, ['name', 'status', 'totalTasks', 'completedTasks', 'createdAt']));
      } else {
        projects.forEach(project => console.log(formatProject(project)));
      }
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to list projects:'), error.message);
      process.exit(1);
    }
  })
  
  .command('get-project <name>', 'Get project details', (yargs) => {
    return yargs
      .positional('name', {
        describe: 'Project name or ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Try to find project by name first, then by ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.name! || p.id === argv.name!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.name}' not found`));
        process.exit(1);
      }
      
      console.log(formatProject(project));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get project:'), error.message);
      process.exit(1);
    }
  })

  // Task Type Management Commands
  .command('create-task-type <project> <name>', 'Create a new task type', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .positional('name', {
        describe: 'Task type name',
        type: 'string'
      })
      .option('template', {
        alias: 't',
        type: 'string',
        describe: 'Task template with variables like {{variable}}',
        default: ''
      })
      .option('variables', {
        alias: 'vars',
        type: 'array',
        describe: 'Template variables (space-separated)',
        default: []
      })
      .option('duplicate-handling', {
        alias: 'd',
        type: 'string',
        choices: ['allow', 'ignore', 'fail'],
        describe: 'How to handle duplicate tasks',
        default: 'allow'
      })
      .option('max-retries', {
        alias: 'r',
        type: 'number',
        describe: 'Maximum retry attempts'
      })
      .option('lease-duration', {
        alias: 'l',
        type: 'number',
        describe: 'Lease duration in minutes'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const taskType = await services.taskType.createTaskType({
        projectId: project.id,
        name: argv.name!,
        template: argv.template,
        variables: argv.variables as string[],
        duplicateHandling: argv['duplicate-handling'] as any,
        maxRetries: argv['max-retries'],
        leaseDurationMinutes: argv['lease-duration']
      });
      
      console.log(chalk.green('✅ Task type created successfully:'));
      console.log(`
${chalk.bold.blue(taskType.name)} (${taskType.id})
${chalk.gray('Project:')} ${project.name}
${chalk.gray('Template:')} ${taskType.template || 'No template'}
${chalk.gray('Variables:')} ${taskType.variables && taskType.variables.length ? taskType.variables.join(', ') : 'None'}
${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}
${chalk.gray('Max Retries:')} ${taskType.maxRetries}
${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes
${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}
      `);
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to create task type:'), error.message);
      process.exit(1);
    }
  })
  
  .command('list-task-types <project>', 'List task types for a project', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .option('format', {
        alias: 'f',
        type: 'string',
        choices: ['table', 'detailed'],
        describe: 'Output format',
        default: 'table'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const taskTypes = await services.taskType.listTaskTypes(project.id);
      
      if (taskTypes.length === 0) {
        console.log(chalk.gray('No task types found'));
        return;
      }
      
      if (argv.format === 'table') {
        console.log(formatTable(taskTypes, ['name', 'duplicateHandling', 'maxRetries', 'leaseDurationMinutes', 'createdAt']));
      } else {
        taskTypes.forEach(taskType => {
          console.log(`
${chalk.bold.blue(taskType.name)} (${taskType.id})
${chalk.gray('Template:')} ${taskType.template || 'No template'}
${chalk.gray('Variables:')} ${taskType.variables && taskType.variables.length ? taskType.variables.join(', ') : 'None'}
${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}
${chalk.gray('Max Retries:')} ${taskType.maxRetries}
${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes
${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}
          `);
        });
      }
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to list task types:'), error.message);
      process.exit(1);
    }
  })
  
  .command('get-task-type <type-id>', 'Get task type details', (yargs) => {
    return yargs
      .positional('type-id', {
        describe: 'Task type ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      const taskType = await services.taskType.getTaskType(argv['type-id']!);
      
      if (!taskType) {
        console.error(chalk.red(`❌ Task type '${argv['type-id']}' not found`));
        process.exit(1);
      }
      
      console.log(`
${chalk.bold.blue(taskType.name)} (${taskType.id})
${chalk.gray('Project ID:')} ${taskType.projectId}
${chalk.gray('Template:')} ${taskType.template || 'No template'}
${chalk.gray('Variables:')} ${taskType.variables && taskType.variables.length ? taskType.variables.join(', ') : 'None'}
${chalk.gray('Duplicate Handling:')} ${taskType.duplicateHandling}
${chalk.gray('Max Retries:')} ${taskType.maxRetries}
${chalk.gray('Lease Duration:')} ${taskType.leaseDurationMinutes} minutes
${chalk.gray('Created:')} ${new Date(taskType.createdAt).toLocaleString()}
${chalk.gray('Updated:')} ${new Date(taskType.updatedAt).toLocaleString()}
      `);
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get task type:'), error.message);
      process.exit(1);
    }
  })

  // Task Management Commands
  .command('create-task <project> <type-id> <instructions>', 'Create a new task', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .positional('type-id', {
        describe: 'Task type ID',
        type: 'string'
      })
      .positional('instructions', {
        describe: 'Task instructions',
        type: 'string'
      })
      .option('variables', {
        alias: 'vars',
        type: 'string',
        describe: 'Variables as JSON string (e.g., \'{"key": "value"}\')'
      })
      .option('batch-id', {
        alias: 'b',
        type: 'string',
        describe: 'Batch ID for grouping tasks'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      // Parse variables if provided
      let variables: Record<string, string> | undefined;
      if (argv.variables) {
        try {
          variables = JSON.parse(argv.variables);
        } catch (error) {
          console.error(chalk.red('❌ Invalid variables JSON:'), error);
          process.exit(1);
        }
      }
      
      const task = await services.task.createTask({
        projectId: project.id,
        typeId: argv['type-id']!,
        instructions: argv.instructions!,
        variables,
        batchId: argv['batch-id']
      });
      
      console.log(chalk.green('✅ Task created successfully:'));
      console.log(formatTask(task));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to create task:'), error.message);
      process.exit(1);
    }
  })
  
  .command('list-tasks <project>', 'List tasks for a project', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .option('status', {
        alias: 's',
        type: 'string',
        choices: ['queued', 'running', 'completed', 'failed'],
        describe: 'Filter by task status'
      })
      .option('type-id', {
        alias: 't',
        type: 'string',
        describe: 'Filter by task type ID'
      })
      .option('batch-id', {
        alias: 'b',
        type: 'string',
        describe: 'Filter by batch ID'
      })
      .option('assigned-to', {
        alias: 'a',
        type: 'string',
        describe: 'Filter by assigned agent'
      })
      .option('limit', {
        alias: 'l',
        type: 'number',
        describe: 'Maximum number of tasks to return',
        default: 50
      })
      .option('offset', {
        alias: 'o',
        type: 'number',
        describe: 'Number of tasks to skip',
        default: 0
      })
      .option('format', {
        alias: 'f',
        type: 'string',
        choices: ['table', 'detailed'],
        describe: 'Output format',
        default: 'table'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const filters: TaskFilters = {
        status: argv.status as TaskFilters['status'],
        typeId: argv['type-id'],
        batchId: argv['batch-id'],
        assignedTo: argv['assigned-to'],
        limit: argv.limit,
        offset: argv.offset
      };
      
      const tasks = await services.task.listTasks(project.id, filters);
      
      if (tasks.length === 0) {
        console.log(chalk.gray('No tasks found'));
        return;
      }
      
      if (argv.format === 'table') {
        console.log(formatTable(tasks, ['id', 'typeId', 'status', 'assignedTo', 'retryCount', 'createdAt']));
      } else {
        tasks.forEach(task => console.log(formatTask(task)));
      }
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to list tasks:'), error.message);
      process.exit(1);
    }
  })
  
  .command('get-task <task-id>', 'Get task details', (yargs) => {
    return yargs
      .positional('task-id', {
        describe: 'Task ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      const task = await services.task.getTask(argv['task-id']!);
      
      if (!task) {
        console.error(chalk.red(`❌ Task '${argv['task-id']}' not found`));
        process.exit(1);
      }
      
      console.log(formatTask(task));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get task:'), error.message);
      process.exit(1);
    }
  })

  // Agent Operation Commands
  .command('register-agent <project> <name>', 'Register a new agent', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .positional('name', {
        describe: 'Agent name',
        type: 'string'
      })
      .option('capabilities', {
        alias: 'caps',
        type: 'array',
        describe: 'Agent capabilities (space-separated)',
        default: []
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const registration = await services.agent.registerAgent({
        projectId: project.id,
        name: argv.name!,
        capabilities: argv.capabilities as string[]
      });
      
      console.log(chalk.green('✅ Agent registered successfully:'));
      console.log(`
${chalk.bold.blue(registration.agent.name)} (${registration.agent.id})
${chalk.gray('Project:')} ${project.name}
${chalk.gray('Status:')} ${registration.agent.status}
${chalk.gray('Capabilities:')} ${registration.agent.capabilities && registration.agent.capabilities.length ? registration.agent.capabilities.join(', ') : 'None'}
${chalk.gray('API Key:')} ${registration.apiKey}
${chalk.gray('Created:')} ${new Date(registration.agent.createdAt).toLocaleString()}

${chalk.yellow('⚠️  Save the API key - it will not be shown again!')}
      `);
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to register agent:'), error.message);
      process.exit(1);
    }
  })
  
  .command('get-next-task <agent-name> <project>', 'Get next task for agent', (yargs) => {
    return yargs
      .positional('agent-name', {
        describe: 'Agent name',
        type: 'string'
      })
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const task = await services.agent.getNextTask(argv['agent-name']!, project.id);
      
      if (!task) {
        console.log(chalk.gray('No tasks available'));
        return;
      }
      
      console.log(chalk.green('✅ Task assigned:'));
      console.log(formatTask(task));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get next task:'), error.message);
      process.exit(1);
    }
  })
  
  .command('complete-task <agent-name> <project> <task-id>', 'Complete a task', (yargs) => {
    return yargs
      .positional('agent-name', {
        describe: 'Agent name',
        type: 'string'
      })
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .positional('task-id', {
        describe: 'Task ID',
        type: 'string'
      })
      .option('result', {
        alias: 'r',
        type: 'string',
        describe: 'Task result as JSON string',
        default: '{"success": true}'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      // Parse result
      let result;
      try {
        result = JSON.parse(argv.result!);
      } catch (error) {
        console.error(chalk.red('❌ Invalid result JSON:'), error);
        process.exit(1);
      }
      
      await services.agent.completeTask(
        argv['agent-name']!,
        project.id,
        argv['task-id']!,
        result
      );
      
      console.log(chalk.green(`✅ Task ${argv['task-id']} completed successfully`));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to complete task:'), error.message);
      process.exit(1);
    }
  })
  
  .command('fail-task <agent-name> <project> <task-id>', 'Fail a task', (yargs) => {
    return yargs
      .positional('agent-name', {
        describe: 'Agent name',
        type: 'string'
      })
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      })
      .positional('task-id', {
        describe: 'Task ID',
        type: 'string'
      })
      .option('result', {
        alias: 'r',
        type: 'string',
        describe: 'Failure result as JSON string',
        default: '{"success": false, "error": "Task failed"}'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      // Parse result
      let result;
      try {
        result = JSON.parse(argv.result!);
      } catch (error) {
        console.error(chalk.red('❌ Invalid result JSON:'), error);
        process.exit(1);
      }
      
      await services.agent.failTask(
        argv['agent-name']!,
        project.id,
        argv['task-id']!,
        result
      );
      
      console.log(chalk.green(`✅ Task ${argv['task-id']} failed and will be retried if possible`));
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to fail task:'), error.message);
      process.exit(1);
    }
  })

  // Monitoring and Status Commands
  .command('health-check', 'Check system health', (yargs) => {
    return yargs;
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Check storage health by trying a simple operation
      const storageModule = await import('./storage/index.js');
      const configModule = await import('./config/index.js');
      const config = configModule.loadConfig();
      const storage = storageModule.createStorageProvider(config);
      await storage.initialize();
      const storageHealth = await storage.healthCheck();
      
      console.log(chalk.green('✅ Health Check Results:'));
      console.log(`
${chalk.bold('Storage:')} ${storageHealth.healthy ? chalk.green('Healthy') : chalk.red('Unhealthy')}
${storageHealth.message ? chalk.gray('Message:') + ' ' + storageHealth.message : ''}
${chalk.gray('Timestamp:')} ${new Date().toLocaleString()}
      `);
      
      if (!storageHealth.healthy) {
        process.exit(1);
      }
    } catch (error: any) {
      console.error(chalk.red('❌ Health check failed:'), error.message);
      process.exit(1);
    }
  })
  
  .command('get-project-stats <project>', 'Get project statistics', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      // Get lease stats
      const leaseStats = await services.lease.getLeaseStats(project.id);
      
      console.log(`
${chalk.bold.blue('Project Statistics')} - ${project.name}

${chalk.bold('Task Summary:')}
  Total Tasks: ${project.stats.totalTasks}
  Completed: ${chalk.green(project.stats.completedTasks)}
  Failed: ${chalk.red(project.stats.failedTasks)}
  Queued: ${chalk.yellow(project.stats.queuedTasks)}
  Running: ${chalk.blue(project.stats.runningTasks)}

${chalk.bold('Lease Information:')}
  Running Tasks: ${leaseStats.totalRunningTasks}
  Expired Tasks: ${leaseStats.expiredTasks > 0 ? chalk.red(leaseStats.expiredTasks) : chalk.green(leaseStats.expiredTasks)}

${chalk.bold('Task Breakdown by Status:')}
${Object.entries(leaseStats.tasksByStatus).map(([status, count]) => `  ${status}: ${count}`).join('\n')}
      `);
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to get project stats:'), error.message);
      process.exit(1);
    }
  })
  
  .command('cleanup-leases <project>', 'Clean up expired leases for a project', (yargs) => {
    return yargs
      .positional('project', {
        describe: 'Project name or ID',
        type: 'string'
      });
  }, async (argv) => {
    const services = await initializeServices();
    
    try {
      // Find project by name or ID
      const projects = await services.project.listProjects(true);
      const project = projects.find(p => p.name === argv.project! || p.id === argv.project!);
      
      if (!project) {
        console.error(chalk.red(`❌ Project '${argv.project}' not found`));
        process.exit(1);
      }
      
      const result = await services.lease.cleanupExpiredLeases(project.id);
      
      console.log(chalk.green('✅ Lease cleanup completed:'));
      console.log(`
${chalk.gray('Reclaimed Tasks:')} ${result.reclaimedTasks}
${chalk.gray('Cleaned Agents:')} ${result.cleanedAgents}
${chalk.gray('Timestamp:')} ${new Date().toLocaleString()}
      `);
    } catch (error: any) {
      console.error(chalk.red('❌ Failed to cleanup leases:'), error.message);
      process.exit(1);
    }
  });

// Export function for programmatic use
export async function runCLI(args?: string[]) {
  cli.parse(args || process.argv.slice(2));
}

// Run the CLI when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cli.parse();
}