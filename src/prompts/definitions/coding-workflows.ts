/**
 * Coding-focused workflow prompts for developers
 */

import { PromptDefinition } from '../types.js';

export const codeReviewWorkflowPrompt: PromptDefinition = {
  name: "code-review-workflow",
  description: "Set up a code review pipeline with different types of analysis",
  arguments: [
    {
      name: "project_name",
      description: "Project to set up code review for",
      required: true,
    },
    {
      name: "files_to_review",
      description: "Files or directories to review (e.g., 'src/*.ts,*.js')",
      required: true,
    },
    {
      name: "review_types",
      description: "Types of review: security, performance, style, logic, or all",
      required: true,
    },
    {
      name: "output_format",
      description: "How to format results: markdown, json, or summary",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, files_to_review, review_types, output_format = "markdown" } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up a code review workflow for project "${project_name}".

**Review Configuration:**
- Files: ${files_to_review}
- Review types: ${review_types}
- Output format: ${output_format}

Please help me:
1. Create or use project "${project_name}"
2. Create task types for each review type: ${review_types}
3. Create individual review tasks for each file
4. Explain how to launch review agents (use get_next_task)
5. Set up result aggregation and reporting
6. **Create investigation tasks for potential issues that need deeper analysis**
7. **Create fix tasks for confirmed problems to ensure resolution**

**Important**: Agents will auto-generate names when calling get_next_task. No pre-registration needed.`,
          },
        },
      ],
    };
  },
};

export const fileProcessingPipelinePrompt: PromptDefinition = {
  name: "file-processing-pipeline",
  description: "Process files through multiple stages (validate, transform, analyze, etc.)",
  arguments: [
    {
      name: "project_name",
      description: "Project for the pipeline",
      required: true,
    },
    {
      name: "input_files",
      description: "Files to process",
      required: true,
    },
    {
      name: "processing_stages",
      description: "Comma-separated stages (e.g., 'validate,transform,analyze')",
      required: true,
    },
    {
      name: "stage_dependencies",
      description: "Dependencies between stages (optional)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, input_files, processing_stages, stage_dependencies } = args;
    const stages = processing_stages.split(',').map((s: string) => s.trim());
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up a file processing pipeline for project "${project_name}".

**Pipeline Configuration:**
- Input files: ${input_files}
- Processing stages: ${stages.join(' → ')}
${stage_dependencies ? `- Stage dependencies: ${stage_dependencies}` : ''}

Please help me:
1. Create or use project "${project_name}"
2. Create task types for each stage: ${stages.join(', ')}
3. Create tasks for each file at each stage
4. Set up stage ordering and dependencies
5. Explain how to run the pipeline with ephemeral agents

**Pipeline Stages:**
${stages.map((stage: string, i: number) => `${i + 1}. **${stage}**: [Please suggest specific processing for this stage]`).join('\n')}

Note: Use get_next_task to pull work from the queue. Agent names are auto-generated.`,
          },
        },
      ],
    };
  },
};

export const testGenerationWorkflowPrompt: PromptDefinition = {
  name: "test-generation-workflow",
  description: "Generate tests for code files using different testing strategies",
  arguments: [
    {
      name: "project_name",
      description: "Project for test generation",
      required: true,
    },
    {
      name: "code_files",
      description: "Code files to generate tests for",
      required: true,
    },
    {
      name: "test_types",
      description: "Types of tests: unit, integration, e2e, or all",
      required: true,
    },
    {
      name: "testing_framework",
      description: "Testing framework (jest, mocha, pytest, etc.)",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, code_files, test_types, testing_framework } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up test generation workflow for project "${project_name}".

**Test Configuration:**
- Code files: ${code_files}
- Test types: ${test_types}
${testing_framework ? `- Framework: ${testing_framework}` : ''}

Please help me:
1. Create or use project "${project_name}"
2. Create task types for each test type: ${test_types}
3. Create test generation tasks for each code file
4. Set up test file naming and organization
5. Explain how to run test generation with agents

**Test Generation Strategy:**
- Analyze code structure and dependencies
- Generate comprehensive test cases
- Follow best practices for ${testing_framework || 'the testing framework'}
- Include edge cases and error conditions

Use get_next_task to assign test generation work. Agent names auto-generated.`,
          },
        },
      ],
    };
  },
};

export const documentationWorkflowPrompt: PromptDefinition = {
  name: "documentation-workflow",
  description: "Generate documentation from code files",
  arguments: [
    {
      name: "project_name",
      description: "Project for documentation",
      required: true,
    },
    {
      name: "source_files",
      description: "Source files to document",
      required: true,
    },
    {
      name: "doc_types",
      description: "Types of docs: api, readme, comments, or all",
      required: true,
    },
    {
      name: "output_format",
      description: "Output format: markdown, html, or both",
      required: false,
    }
  ],
  handler: (args: Record<string, any>) => {
    const { project_name, source_files, doc_types, output_format = "markdown" } = args;
    
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Set up documentation generation workflow for project "${project_name}".

**Documentation Configuration:**
- Source files: ${source_files}
- Documentation types: ${doc_types}
- Output format: ${output_format}

Please help me:
1. Create or use project "${project_name}"
2. Create task types for each doc type: ${doc_types}
3. Create documentation tasks for each source file
4. Set up documentation templates and standards
5. Explain how to run documentation generation

**Documentation Types:**
${doc_types.split(',').map((type: string, i: number) => `${i + 1}. **${type.trim()}**: [Please suggest specific documentation approach]`).join('\n')}

Agents will use get_next_task to pull documentation work. No agent management needed.`,
          },
        },
      ],
    };
  },
};