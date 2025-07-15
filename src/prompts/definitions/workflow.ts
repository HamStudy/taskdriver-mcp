/**
 * Workflow-related MCP prompts
 */

import { PromptDefinition } from '../types.js';

export const batchProcessPrompt: PromptDefinition = {
  name: "batch-process", // Will be prefixed later
  description: "Create many similar tasks for batch processing (files, data, etc.)",
  arguments: [
    {
      name: "project_name",
      description: "Project to create tasks in",
      required: true,
    },
    {
      name: "task_template",
      description: 'Template for tasks, e.g. "Process {{file}} for {{purpose}}"',
      required: true,
    },
    {
      name: "items_to_process",
      description: "List or description of items to process",
      required: true,
    },
    {
      name: "processing_purpose",
      description: "What kind of processing should be done",
      required: true,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, task_template, items_to_process, processing_purpose } = args as {
      project_name: string;
      task_template: string; 
      items_to_process: string;
      processing_purpose: string;
    };
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I need to set up batch processing in TaskDriver project "${project_name}".

Template: ${task_template}
Items to process: ${items_to_process}
Purpose: ${processing_purpose}

Please help me:
1. Create a task type with the template "${task_template}"
2. Generate tasks for each item I need to process
3. Set up the batch processing workflow`,
          },
        },
      ],
    };
  },
};

export const breakDownWorkPrompt: PromptDefinition = {
  name: "break-down-work", // Will be prefixed later
  description: "Break down a large task or project into smaller manageable tasks",
  arguments: [
    {
      name: "project_name", 
      description: "Project to organize the work in",
      required: true,
    },
    {
      name: "large_task_description",
      description: "Description of the large task or project to break down",
      required: true,
    },
    {
      name: "complexity_level",
      description: "How detailed should the breakdown be: simple, moderate, detailed",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, large_task_description, complexity_level = "moderate" } = args as {
      project_name: string;
      large_task_description: string;
      complexity_level?: string;
    };
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I have a large task that needs to be broken down into smaller, manageable pieces in TaskDriver project "${project_name}".

Large task: ${large_task_description}
Breakdown complexity: ${complexity_level}

Please help me:
1. Analyze the large task and identify logical sub-components
2. Create a structured breakdown with ${complexity_level} level of detail
3. Create individual TaskDriver tasks for each component
4. Set up any dependencies or ordering constraints
5. Suggest how to track progress on the overall work`,
          },
        },
      ],
    };
  },
};

export const processListPrompt: PromptDefinition = {
  name: "process-list", // Will be prefixed later
  description: "Process a list of items (files, URLs, data points, etc.) with TaskDriver",
  arguments: [
    {
      name: "project_name",
      description: "Project to use (will create if needed)", 
      required: true,
    },
    {
      name: "items_list",
      description: "The list of items to process (one per line or comma-separated)",
      required: true,
    },
    {
      name: "processing_action",
      description: "What to do with each item (analyze, transform, validate, etc.)",
      required: true,
    },
    {
      name: "output_format",
      description: "Desired output format or structure (optional)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, items_list, processing_action, output_format } = args as {
      project_name: string;
      items_list: string;
      processing_action: string;
      output_format?: string;
    };
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I need to process a list of items using TaskDriver in project "${project_name}".

Items to process:
${items_list}

Action: ${processing_action}
${output_format ? `Output format: ${output_format}` : ''}

Please help me:
1. Create or use the project "${project_name}"
2. Set up a task type for "${processing_action}" operations
3. Create individual tasks for each item in the list
4. Explain how to assign agents and track progress${output_format ? `\n5. Set up the output format: ${output_format}` : ''}`,
          },
        },
      ],
    };
  },
};