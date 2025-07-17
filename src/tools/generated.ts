/**
 * Generated MCP Tools from Command Definitions
 */

import { Tool, CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StorageProvider } from '../storage/StorageProvider.js';
import { COMMAND_DEFINITIONS } from '../commands/definitions.js';
import { generateMcpTool, generateMcpHandler } from '../commands/generators.js';
import { createServiceContext } from '../commands/context.js';

export class GeneratedToolHandlers {
  private context;
  private handlers: Map<string, (args: any) => Promise<CallToolResult>>;
  private lastAgentName: string | undefined; // Track last agent name used in this session

  constructor(private storage: StorageProvider) {
    this.context = createServiceContext(storage);
    this.handlers = new Map();
    
    // Generate handlers for all command definitions
    for (const def of COMMAND_DEFINITIONS) {
      const handler = generateMcpHandler(def, this.context);
      this.handlers.set(def.mcpName, handler);
    }
  }

  /**
   * Handle tool calls
   */
  async handleToolCall(request: CallToolRequest): Promise<CallToolResult> {
    const { name, arguments: args } = request.params;
    
    const handler = this.handlers.get(name);
    if (!handler) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Unknown tool: ${name}`
            }, null, 2)
          }
        ],
        isError: true
      };
    }

    // Handle agent name persistence for get_next_task
    let modifiedArgs = args;
    if (name === 'get_next_task') {
      modifiedArgs = { ...args };
      
      // If no agentName provided but we have a stored one, use it
      if (!modifiedArgs.agentName && this.lastAgentName) {
        modifiedArgs.agentName = this.lastAgentName;
      }
    }

    const result = await handler(modifiedArgs);
    
    // Capture agent name from successful get_next_task responses
    if (name === 'get_next_task' && result.content && result.content[0]) {
      try {
        const responseText = result.content[0].text;
        if (typeof responseText === 'string') {
          const responseData = JSON.parse(responseText);
          
          // Store agent name if the call was successful
          if (responseData.success && responseData.agentName && typeof responseData.agentName === 'string') {
            this.lastAgentName = responseData.agentName;
          }
        }
      } catch (error) {
        // Ignore parsing errors, continue without capturing agent name
      }
    }

    return result;
  }
}

// Export generated tools
export const tools: Tool[] = COMMAND_DEFINITIONS.map(def => generateMcpTool(def));

// Export tools by name for reference
export const toolsByName: Record<string, Tool> = {};
for (const tool of tools) {
  toolsByName[tool.name] = tool;
}