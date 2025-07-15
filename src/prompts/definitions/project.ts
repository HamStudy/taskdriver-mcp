/**
 * Project-related MCP prompts
 */

import { PromptDefinition } from '../types.js';

export const createProjectPrompt: PromptDefinition = {
  name: "create-project", // Will be prefixed later
  description: "Create a new TaskDriver project for organizing work and tasks",
  arguments: [
    {
      name: "project_name",
      description: "Name for the project",
      required: true,
    },
    {
      name: "description",
      description: "Description of what this project is for",
      required: true,
    },
    {
      name: "instructions",
      description: "Instructions for agents working on this project (optional)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, description, instructions } = args as { 
      project_name: string; 
      description: string; 
      instructions?: string; 
    };
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to create a new TaskDriver project called "${project_name}" for ${description}.${instructions ? ` Instructions for agents: ${instructions}` : ''}

Please help me:
1. Create the project using create_project
2. Set up any initial task types if needed
3. Explain what I can do next with this project`,
          },
        },
      ],
    };
  },
};

export const trackProgressPrompt: PromptDefinition = {
  name: "track-progress", // Will be prefixed later
  description: "Check progress on tasks and projects",
  arguments: [
    {
      name: "project_name",
      description: "Project to check progress for",
      required: true,
    },
    {
      name: "details_level",
      description: "Level of detail: summary, detailed, or full",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, details_level = "summary" } = args as {
      project_name: string;
      details_level?: string;
    };
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text", 
            text: `Please check the progress of TaskDriver project "${project_name}" with ${details_level} level of detail.

Show me:
1. Overall project statistics (total tasks, completed, failed, queued)
2. Current task status breakdown
3. Any issues or blocked tasks
${details_level === 'detailed' || details_level === 'full' ? '4. Individual task details and assignments' : ''}
${details_level === 'full' ? '5. Performance metrics and timing data' : ''}`,
          },
        },
      ],
    };
  },
};