import { describe, it, expect } from 'bun:test';
import type { 
  CommandParameter, 
  InferArgs, 
  CommandDefinition 
} from '../../src/commands/types.js';

describe('Command Types', () => {
  describe('Parameter Type Inference', () => {
    it('should infer string type', () => {
      type TestParam = {
        readonly name: 'test';
        readonly type: 'string';
        readonly description: 'Test parameter';
      };
      
      type Args = InferArgs<[TestParam]>;
      
      // TypeScript compile-time type check
      const args: Args = { test: 'hello' };
      expect(args.test).toBe('hello');
    });

    it('should infer number type', () => {
      type TestParam = {
        readonly name: 'count';
        readonly type: 'number';
        readonly description: 'Count parameter';
      };
      
      type Args = InferArgs<[TestParam]>;
      
      const args: Args = { count: 42 };
      expect(args.count).toBe(42);
    });

    it('should infer boolean type', () => {
      type TestParam = {
        readonly name: 'enabled';
        readonly type: 'boolean';
        readonly description: 'Enable flag';
      };
      
      type Args = InferArgs<[TestParam]>;
      
      const args: Args = { enabled: true };
      expect(args.enabled).toBe(true);
    });

    it('should infer array type', () => {
      type TestParam = {
        readonly name: 'items';
        readonly type: 'array';
        readonly description: 'List of items';
      };
      
      type Args = InferArgs<[TestParam]>;
      
      const args: Args = { items: ['a', 'b', 'c'] };
      expect(args.items).toEqual(['a', 'b', 'c']);
    });

    it('should infer choice type from string choices', () => {
      type TestParam = {
        readonly name: 'status';
        readonly type: 'string';
        readonly choices: readonly ['active', 'inactive'];
        readonly description: 'Status choice';
      };
      
      type Args = InferArgs<[TestParam]>;
      
      const args: Args = { status: 'active' };
      expect(args.status).toBe('active');
    });

    it('should handle optional parameters', () => {
      type TestParams = readonly [
        {
          readonly name: 'required';
          readonly type: 'string';
          readonly description: 'Required param';
        },
        {
          readonly name: 'optional';
          readonly type: 'number';
          readonly required: false;
          readonly description: 'Optional param';
        }
      ];
      
      type Args = InferArgs<TestParams>;
      
      const args1: Args = { required: 'test' };
      expect(args1.required).toBe('test');
      
      const args2: Args = { required: 'test', optional: 42 };
      expect(args2.optional).toBe(42);
    });

    it('should handle multiple parameters', () => {
      type TestParams = readonly [
        {
          readonly name: 'name';
          readonly type: 'string';
          readonly description: 'Name';
        },
        {
          readonly name: 'count';
          readonly type: 'number';
          readonly description: 'Count';
        },
        {
          readonly name: 'active';
          readonly type: 'boolean';
          readonly description: 'Active flag';
        }
      ];
      
      type Args = InferArgs<TestParams>;
      
      const args: Args = {
        name: 'test',
        count: 5,
        active: true
      };
      
      expect(args.name).toBe('test');
      expect(args.count).toBe(5);
      expect(args.active).toBe(true);
    });
  });

  describe('Command Definition Structure', () => {
    it('should properly structure a command definition', () => {
      const testCommand: CommandDefinition = {
        name: 'test-command',
        description: 'Test command',
        parameters: [
          {
            name: 'input',
            type: 'string',
            description: 'Input parameter',
            required: true
          }
        ] as const,
        handler: async (args, context) => {
          // Handler implementation
          return { success: true, message: `Processed: ${args.input}` };
        }
      };

      expect(testCommand.name).toBe('test-command');
      expect(testCommand.description).toBe('Test command');
      expect(testCommand.parameters).toHaveLength(1);
      expect(testCommand.parameters[0].name).toBe('input');
      expect(testCommand.handler).toBeDefined();
    });
  });
});