/**
 * TaskDriver MCP Prompts
 * 
 * Prompts that show up as slash commands in Claude Code and other MCP clients.
 * These provide structured templates for common TaskDriver workflows.
 */

import { PromptDefinition } from './types.js';
import { createProjectPrompt, trackProgressPrompt } from './definitions/project.js';
import { batchProcessPrompt, breakDownWorkPrompt, processListPrompt } from './definitions/workflow.js';
import { codeReviewWorkflowPrompt, fileProcessingPipelinePrompt, testGenerationWorkflowPrompt, documentationWorkflowPrompt } from './definitions/coding-workflows.js';
import { logAnalysisPrompt, dataValidationPrompt, migrationTasksPrompt, securityAuditPrompt, configAuditPrompt, dataProcessingPrompt, deploymentChecksPrompt } from './definitions/work-scenarios.js';
import { createPromptName } from './utils.js';

// All prompt definitions
const promptDefinitions: PromptDefinition[] = [
  // Project & Task Management
  createProjectPrompt,
  trackProgressPrompt,
  batchProcessPrompt,
  breakDownWorkPrompt,
  processListPrompt,
  
  // Development Workflows
  codeReviewWorkflowPrompt,
  fileProcessingPipelinePrompt,
  testGenerationWorkflowPrompt,
  documentationWorkflowPrompt,
  
  // Operations & Maintenance
  logAnalysisPrompt,
  dataValidationPrompt,
  migrationTasksPrompt,
  securityAuditPrompt,
  configAuditPrompt,
  dataProcessingPrompt,
  deploymentChecksPrompt,
];

/**
 * Get prompts with runtime prefix configuration
 */
export function getPrompts() {
  return Object.fromEntries(
    promptDefinitions.map(def => {
      const fullName = createPromptName(def.name);
      return [
        fullName,
        {
          name: fullName,
          description: def.description,
          arguments: def.arguments,
        }
      ];
    })
  );
}

/**
 * Get prompt handlers with runtime prefix configuration
 */
export function getPromptHandlers() {
  return Object.fromEntries(
    promptDefinitions.map(def => {
      const fullName = createPromptName(def.name);
      return [
        fullName,
        def.handler
      ];
    })
  );
}

// Export functions instead of static values to enable runtime configuration
export const prompts = getPrompts;
export const promptHandlers = getPromptHandlers;