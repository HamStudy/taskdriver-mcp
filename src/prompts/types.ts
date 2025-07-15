/**
 * Types for TaskDriver MCP Prompts
 */

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: PromptArgument[];
  handler: (args: Record<string, any>) => {
    messages: Array<{
      role: string;
      content: {
        type: string;
        text: string;
      };
    }>;
  };
}