import { describe, it, expect } from 'bun:test';
import {
  validate,
  isValidationError,
  projectNameSchema,
  agentNameSchema,
  taskTypeNameSchema,
  uuidSchema,
  variablesSchema,
  instructionsSchema,
  explanationSchema,
  createProjectSchema,
  createTaskTypeSchema,
  createTaskSchema,
  createAgentSchema,
  taskFiltersSchema
} from '../../src/utils/validation.js';

describe('Validation', () => {
  describe('validate function', () => {
    it('should validate valid data', () => {
      const schema = projectNameSchema;
      const data = 'valid-project-name';
      const result = validate(schema, data);
      expect(result).toBe('valid-project-name');
    });

    it('should throw validation error for invalid data', () => {
      const schema = projectNameSchema;
      const data = '';
      expect(() => validate(schema, data)).toThrow();
    });

    it('should provide detailed error information', () => {
      const schema = projectNameSchema;
      const data = 'invalid name with spaces';
      try {
        validate(schema, data);
      } catch (error: any) {
        expect(error.isValidationError).toBe(true);
        expect(error.validationDetails).toBeDefined();
        expect(Array.isArray(error.validationDetails)).toBe(true);
      }
    });
  });

  describe('isValidationError', () => {
    it('should identify validation errors', () => {
      try {
        validate(projectNameSchema, '');
      } catch (error) {
        expect(isValidationError(error)).toBe(true);
      }
    });

    it('should return false for non-validation errors', () => {
      const regularError = new Error('Regular error');
      expect(isValidationError(regularError)).toBe(false);
    });
  });

  describe('projectNameSchema', () => {
    it('should accept valid project names', () => {
      const validNames = ['project1', 'my-project', 'test_project', 'ABC123'];
      validNames.forEach(name => {
        expect(() => validate(projectNameSchema, name)).not.toThrow();
      });
    });

    it('should reject invalid project names', () => {
      const invalidNames = ['', 'project with spaces', 'project@domain', 'project.name'];
      invalidNames.forEach(name => {
        expect(() => validate(projectNameSchema, name)).toThrow();
      });
    });
  });

  describe('agentNameSchema', () => {
    it('should accept valid agent names', () => {
      const validNames = ['agent1', 'my-agent', 'test_agent', 'ABC123'];
      validNames.forEach(name => {
        expect(() => validate(agentNameSchema, name)).not.toThrow();
      });
    });

    it('should reject invalid agent names', () => {
      const invalidNames = ['', 'agent with spaces', 'agent@domain', 'agent.name'];
      invalidNames.forEach(name => {
        expect(() => validate(agentNameSchema, name)).toThrow();
      });
    });
  });

  describe('taskTypeNameSchema', () => {
    it('should accept valid task type names', () => {
      const validNames = ['task1', 'my-task', 'test_task', 'ABC123'];
      validNames.forEach(name => {
        expect(() => validate(taskTypeNameSchema, name)).not.toThrow();
      });
    });

    it('should reject invalid task type names', () => {
      const invalidNames = ['', 'task with spaces', 'task@domain', 'task.name'];
      invalidNames.forEach(name => {
        expect(() => validate(taskTypeNameSchema, name)).toThrow();
      });
    });
  });

  describe('uuidSchema', () => {
    it('should accept valid UUIDs', () => {
      const validUUIDs = [
        '83fae412-4a26-4660-bf80-41a8b8353b42',
        '550e8400-e29b-41d4-a716-446655440000',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      ];
      validUUIDs.forEach(uuid => {
        expect(() => validate(uuidSchema, uuid)).not.toThrow();
      });
    });

    it('should reject invalid UUIDs', () => {
      const invalidUUIDs = ['', 'not-a-uuid', '123', 'abc-def-ghi'];
      invalidUUIDs.forEach(uuid => {
        expect(() => validate(uuidSchema, uuid)).toThrow();
      });
    });
  });

  describe('variablesSchema', () => {
    it('should accept valid variables', () => {
      const validVariables = [
        { name: 'value' },
        { var1: 'value1', var2: 'value2' },
        { userName: 'john', userAge: '25' }
      ];
      validVariables.forEach(vars => {
        expect(() => validate(variablesSchema, vars)).not.toThrow();
      });
    });

    it('should reject invalid variable names', () => {
      // Test each invalid case individually to see which ones fail
      expect(() => validate(variablesSchema, { '123invalid': 'value' })).toThrow();
      expect(() => validate(variablesSchema, { 'var-with-dash': 'value' })).toThrow();
      expect(() => validate(variablesSchema, { 'var.with.dot': 'value' })).toThrow();
    });

    it('should reject too many variables', () => {
      const tooManyVars: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        tooManyVars[`var${i}`] = 'value';
      }
      expect(() => validate(variablesSchema, tooManyVars)).toThrow();
    });
  });

  describe('instructionsSchema', () => {
    it('should accept valid instructions', () => {
      const validInstructions = [
        'Do this task',
        'A longer instruction with multiple sentences.',
        'Instructions with {{variables}} and special characters!'
      ];
      validInstructions.forEach(instruction => {
        expect(() => validate(instructionsSchema, instruction)).not.toThrow();
      });
    });

    it('should reject invalid instructions', () => {
      const invalidInstructions = ['', 'a'.repeat(10001)];
      invalidInstructions.forEach(instruction => {
        expect(() => validate(instructionsSchema, instruction)).toThrow();
      });
    });
  });

  describe('createProjectSchema', () => {
    it('should accept valid project creation data', () => {
      const validData = {
        name: 'test-project',
        description: 'A test project',
        config: {
          defaultMaxRetries: 3,
          defaultLeaseDurationMinutes: 10,
          reaperIntervalMinutes: 5
        }
      };
      expect(() => validate(createProjectSchema, validData)).not.toThrow();
    });

    it('should accept project without config', () => {
      const validData = {
        name: 'test-project',
        description: 'A test project'
      };
      expect(() => validate(createProjectSchema, validData)).not.toThrow();
    });

    it('should reject invalid project data', () => {
      const invalidData = {
        name: 'invalid name',
        description: ''
      };
      expect(() => validate(createProjectSchema, invalidData)).toThrow();
    });
  });

  describe('createTaskTypeSchema', () => {
    it('should accept valid task type creation data', () => {
      const validData = {
        name: 'test-task-type',
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        template: 'Do {{action}} on {{target}}',
        variables: ['action', 'target'],
        duplicateHandling: 'ignore',
        maxRetries: 3,
        leaseDurationMinutes: 10
      };
      expect(() => validate(createTaskTypeSchema, validData)).not.toThrow();
    });

    it('should accept minimal task type data', () => {
      const validData = {
        name: 'test-task-type',
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42'
      };
      expect(() => validate(createTaskTypeSchema, validData)).not.toThrow();
    });

    it('should reject invalid task type data', () => {
      const invalidData = {
        name: 'invalid name',
        projectId: 'not-a-uuid'
      };
      expect(() => validate(createTaskTypeSchema, invalidData)).toThrow();
    });
  });

  describe('createTaskSchema', () => {
    it('should accept valid task creation data', () => {
      const validData = {
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        typeId: '550e8400-e29b-41d4-a716-446655440000',
        instructions: 'Complete this task',
        variables: { action: 'test', target: 'system' },
        batchId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      };
      expect(() => validate(createTaskSchema, validData)).not.toThrow();
    });

    it('should accept minimal task data', () => {
      const validData = {
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        typeId: '550e8400-e29b-41d4-a716-446655440000',
        instructions: 'Complete this task'
      };
      expect(() => validate(createTaskSchema, validData)).not.toThrow();
    });

    it('should reject invalid task data', () => {
      const invalidData = {
        projectId: 'not-a-uuid',
        typeId: '123e4567-e89b-12d3-a456-426614174001',
        instructions: ''
      };
      expect(() => validate(createTaskSchema, invalidData)).toThrow();
    });
  });

  describe('createAgentSchema', () => {
    it('should accept valid agent creation data', () => {
      const validData = {
        name: 'test-agent',
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        capabilities: ['task1', 'task2']
      };
      expect(() => validate(createAgentSchema, validData)).not.toThrow();
    });

    it('should accept minimal agent data', () => {
      const validData = {
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42'
      };
      expect(() => validate(createAgentSchema, validData)).not.toThrow();
    });

    it('should reject invalid agent data', () => {
      const invalidData = {
        name: 'invalid name',
        projectId: 'not-a-uuid'
      };
      expect(() => validate(createAgentSchema, invalidData)).toThrow();
    });
  });

  describe('taskFiltersSchema', () => {
    it('should accept valid task filters', () => {
      const validFilters = {
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        status: 'running',
        assignedTo: 'test-agent',
        batchId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        typeId: '550e8400-e29b-41d4-a716-446655440000',
        limit: 50,
        offset: 0
      };
      expect(() => validate(taskFiltersSchema, validFilters)).not.toThrow();
    });

    it('should require projectId', () => {
      const invalidFilters = {
        status: 'running'
      };
      expect(() => validate(taskFiltersSchema, invalidFilters)).toThrow();
    });

    it('should reject invalid filter values', () => {
      const invalidFilters = {
        projectId: '83fae412-4a26-4660-bf80-41a8b8353b42',
        status: 'invalid-status',
        limit: 1001 // Too high
      };
      expect(() => validate(taskFiltersSchema, invalidFilters)).toThrow();
    });
  });
});