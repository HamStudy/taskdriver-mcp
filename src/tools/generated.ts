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

    return await handler(args);
  }
}

// Export generated tools
export const tools: Tool[] = COMMAND_DEFINITIONS.map(def => generateMcpTool(def));

// Export tools by name for reference
export const toolsByName: Record<string, Tool> = {};
for (const tool of tools) {
  toolsByName[tool.name] = tool;
}