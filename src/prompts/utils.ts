/**
 * Utilities for MCP prompt management
 */

import { loadConfig } from '../config/index.js';

/**
 * Generate a full prompt name with the configured prefix
 */
export function createPromptName(name: string): string {
  const config = loadConfig();
  return `${config.mcp.promptPrefix}:${name}`;
}