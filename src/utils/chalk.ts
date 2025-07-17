/**
 * Chalk configuration with auto-detection for MCP mode and non-TTY environments
 */

import chalk from 'chalk';

// Detect if we're in MCP mode or other scenarios where colors should be disabled
function shouldDisableColors(): boolean {
  // Check if we're in MCP mode (when stdin/stdout are not TTY)
  if (!process.stdout.isTTY) {
    return true;
  }
  
  // Check if NO_COLOR environment variable is set
  if (process.env.NO_COLOR) {
    return true;
  }
  
  // Check if FORCE_COLOR is explicitly set to disable
  if (process.env.FORCE_COLOR === '0' || process.env.FORCE_COLOR === 'false') {
    return true;
  }
  
  // Check if we're in a CI environment (common CI environments set this)
  if (process.env.CI && !process.env.FORCE_COLOR) {
    return true;
  }
  
  return false;
}

// Configure chalk instance based on environment
const configuredChalk = chalk.constructor({
  level: shouldDisableColors() ? 0 : undefined
});

export default configuredChalk;