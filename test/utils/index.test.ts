import { describe, it, expect } from 'bun:test';
import {
  generateApiKey,
  hashApiKey,
  generateCorrelationId,
  replaceTemplateVariables,
  extractTemplateVariables,
  validateTemplateVariables,
  deepClone
} from '../../src/utils/index.js';

describe('Utility Functions', () => {
  describe('generateApiKey', () => {
    it('should generate a key of default length (32)', () => {
      const key = generateApiKey();
      expect(key).toHaveLength(32);
      expect(key).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate a key of specified length', () => {
      const key = generateApiKey(16);
      expect(key).toHaveLength(16);
      expect(key).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate different keys on successive calls', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('hashApiKey', () => {
    it('should hash an API key consistently', () => {
      const key = 'test-api-key';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const key1 = 'test-api-key-1';
      const key2 = 'test-api-key-2';
      const hash1 = hashApiKey(key1);
      const hash2 = hashApiKey(key2);
      expect(hash1).not.toBe(hash2);
    });

    it('should return a non-empty hash', () => {
      const key = 'test-key';
      const hash = hashApiKey(key);
      expect(hash.length).toBeGreaterThan(0);
      expect(typeof hash).toBe('string');
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate a correlation ID', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^[a-z0-9]+$/);
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate different IDs on successive calls', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('replaceTemplateVariables', () => {
    it('should replace simple variables', () => {
      const template = 'Hello {{name}}!';
      const variables = { name: 'World' };
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('Hello World!');
    });

    it('should replace multiple variables', () => {
      const template = 'Hello {{name}}, welcome to {{app}}!';
      const variables = { name: 'Alice', app: 'TaskDriver' };
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('Hello Alice, welcome to TaskDriver!');
    });

    it('should replace the same variable multiple times', () => {
      const template = '{{name}} likes {{name}}';
      const variables = { name: 'Bob' };
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('Bob likes Bob');
    });

    it('should handle templates with no variables', () => {
      const template = 'No variables here';
      const variables = {};
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('No variables here');
    });

    it('should handle empty template', () => {
      const template = '';
      const variables = { name: 'test' };
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('');
    });

    it('should handle special characters in replacement', () => {
      const template = 'Path: {{path}}';
      const variables = { path: '/home/user/$PROJECT' };
      const result = replaceTemplateVariables(template, variables);
      expect(result).toBe('Path: /home/user/$PROJECT');
    });
  });

  describe('extractTemplateVariables', () => {
    it('should extract simple variables', () => {
      const template = 'Hello {{name}}!';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['name']);
    });

    it('should extract multiple variables', () => {
      const template = 'Hello {{name}}, welcome to {{app}}!';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['name', 'app']);
    });

    it('should extract duplicate variables only once', () => {
      const template = '{{name}} likes {{name}}';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['name']);
    });

    it('should handle templates with no variables', () => {
      const template = 'No variables here';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual([]);
    });

    it('should handle empty template', () => {
      const template = '';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual([]);
    });

    it('should handle variables with underscores and numbers', () => {
      const template = 'Config: {{config_path}} and {{setting2}}';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['config_path', 'setting2']);
    });

    it('should ignore malformed variables', () => {
      const template = 'Valid {{name}} and invalid {{123invalid}} and {{}}';
      const variables = extractTemplateVariables(template);
      expect(variables).toEqual(['name']);
    });
  });

  describe('validateTemplateVariables', () => {
    it('should validate when all variables are provided', () => {
      const template = 'Hello {{name}}, welcome to {{app}}!';
      const variables = { name: 'Alice', app: 'TaskDriver' };
      const result = validateTemplateVariables(template, variables);
      expect(result).toEqual({ valid: true, missing: [] });
    });

    it('should identify missing variables', () => {
      const template = 'Hello {{name}}, welcome to {{app}}!';
      const variables = { name: 'Alice' };
      const result = validateTemplateVariables(template, variables);
      expect(result).toEqual({ valid: false, missing: ['app'] });
    });

    it('should identify multiple missing variables', () => {
      const template = 'Hello {{name}}, welcome to {{app}} version {{version}}!';
      const variables = { name: 'Alice' };
      const result = validateTemplateVariables(template, variables);
      expect(result).toEqual({ valid: false, missing: ['app', 'version'] });
    });

    it('should be valid when no variables are needed', () => {
      const template = 'No variables here';
      const variables = {};
      const result = validateTemplateVariables(template, variables);
      expect(result).toEqual({ valid: true, missing: [] });
    });

    it('should be valid when extra variables are provided', () => {
      const template = 'Hello {{name}}!';
      const variables = { name: 'Alice', extra: 'value' };
      const result = validateTemplateVariables(template, variables);
      expect(result).toEqual({ valid: true, missing: [] });
    });
  });

  describe('deepClone', () => {
    it('should clone primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('string')).toBe('string');
      expect(deepClone(true)).toBe(true);
      expect(deepClone(null)).toBe(null);
      expect(deepClone(undefined)).toBe(undefined);
    });

    it('should clone dates', () => {
      const date = new Date('2023-01-01');
      const cloned = deepClone(date);
      expect(cloned).toEqual(date);
      expect(cloned).not.toBe(date);
    });

    it('should clone arrays', () => {
      const arr = [1, 2, { a: 3 }];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
      expect(cloned[2]).not.toBe(arr[2]);
    });

    it('should clone objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('should clone nested structures', () => {
      const complex = {
        num: 42,
        str: 'hello',
        date: new Date('2023-01-01'),
        arr: [1, 2, { nested: true }],
        obj: { deep: { deeper: 'value' } }
      };
      const cloned = deepClone(complex);
      
      expect(cloned).toEqual(complex);
      expect(cloned).not.toBe(complex);
      expect(cloned.date).not.toBe(complex.date);
      expect(cloned.arr).not.toBe(complex.arr);
      expect(cloned.arr[2]).not.toBe(complex.arr[2]);
      expect(cloned.obj).not.toBe(complex.obj);
      expect(cloned.obj.deep).not.toBe(complex.obj.deep);
    });

  });
});