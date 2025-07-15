import { describe, it, expect } from 'bun:test';
import { formatCommandResult } from '../../src/commands/formatters.js';

describe('Command Formatters', () => {
  describe('JSON Format', () => {
    it('should format successful result as JSON', () => {
      const result = {
        success: true,
        project: {
          id: 'test-id',
          name: 'test-project',
          status: 'active'
        }
      };

      const formatted = formatCommandResult(result, 'create-project', 'json');
      
      expect(formatted.text).toBe(JSON.stringify(result, null, 2));
      expect(formatted.exitCode).toBe(0);
    });

    it('should format error result as JSON with exit code 1', () => {
      const result = {
        success: false,
        error: 'Test error'
      };

      const formatted = formatCommandResult(result, 'create-project', 'json');
      
      expect(formatted.text).toBe(JSON.stringify(result, null, 2));
      expect(formatted.exitCode).toBe(1);
    });
  });

  describe('Human Format', () => {
    it('should format project creation result', () => {
      const result = {
        success: true,
        project: {
          id: 'test-id',
          name: 'test-project',
          description: 'Test description',
          status: 'active',
          createdAt: '2025-01-01T00:00:00.000Z',
          config: {
            defaultMaxRetries: 3,
            defaultLeaseDurationMinutes: 10,
            reaperIntervalMinutes: 1
          },
          stats: {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            queuedTasks: 0,
            runningTasks: 0
          }
        }
      };

      const formatted = formatCommandResult(result, 'create-project', 'human');
      
      expect(formatted.text).toContain('✅ Project created successfully');
      expect(formatted.text).toContain('test-project');
      expect(formatted.text).toContain('Test description');
      expect(formatted.text).toContain('Status:');
      expect(formatted.text).toContain('ACTIVE');
      expect(formatted.exitCode).toBe(0);
    });

    it('should format project list result', () => {
      const result = {
        success: true,
        projects: [
          {
            id: 'project-1',
            name: 'project-one',
            status: 'active',
            createdAt: '2025-01-01T00:00:00.000Z',
            stats: { totalTasks: 5, completedTasks: 3 }
          },
          {
            id: 'project-2', 
            name: 'project-two',
            status: 'closed',
            createdAt: '2025-01-02T00:00:00.000Z',
            stats: { totalTasks: 2, completedTasks: 2 }
          }
        ]
      };

      const formatted = formatCommandResult(result, 'list-projects', 'human');
      
      expect(formatted.text).toContain('Found 2 projects');
      expect(formatted.text).toContain('project-one');
      expect(formatted.text).toContain('project-two');
      expect(formatted.text).toContain('ACTIVE');
      expect(formatted.text).toContain('CLOSED');
      expect(formatted.exitCode).toBe(0);
    });

    it('should format task list result', () => {
      const result = {
        success: true,
        tasks: [
          {
            id: 'task-1',
            description: 'Test task',
            status: 'completed',
            assignedTo: 'agent-1',
            createdAt: '2025-01-01T00:00:00.000Z',
            completedAt: '2025-01-01T00:05:00.000Z'
          },
          {
            id: 'task-2',
            description: 'Another task',
            status: 'running',
            assignedTo: 'agent-2', 
            createdAt: '2025-01-01T00:01:00.000Z'
          }
        ]
      };

      const formatted = formatCommandResult(result, 'list-tasks', 'human');
      
      expect(formatted.text).toContain('Found 2 tasks');
      expect(formatted.text).toContain('task-1');
      expect(formatted.text).toContain('COMPLETED');
      expect(formatted.text).toContain('RUNNING');
      expect(formatted.text).toContain('agent-1');
      expect(formatted.exitCode).toBe(0);
    });

    it('should format health check result', () => {
      const result = {
        success: true,
        status: 'healthy',
        timestamp: '2025-01-01T00:00:00.000Z',
        storage: {
          status: 'healthy',
          message: 'Storage is operational'
        }
      };

      const formatted = formatCommandResult(result, 'health-check', 'human');
      
      expect(formatted.text).toContain('System Status:');
      expect(formatted.text).toContain('HEALTHY');
      expect(formatted.text).toContain('✓ Healthy');
      expect(formatted.text).toContain('Storage is operational');
      expect(formatted.exitCode).toBe(0);
    });

    it('should format error results', () => {
      const result = {
        success: false,
        error: 'Something went wrong'
      };

      const formatted = formatCommandResult(result, 'create-project', 'human');
      
      expect(formatted.text).toContain('❌ Error:');
      expect(formatted.text).toContain('Something went wrong');
      expect(formatted.exitCode).toBe(1);
    });

    it('should handle empty results', () => {
      const result = {
        success: true,
        projects: []
      };

      const formatted = formatCommandResult(result, 'list-projects', 'human');
      
      expect(formatted.text).toContain('No projects found');
      expect(formatted.exitCode).toBe(0);
    });
  });

  describe('Default Format', () => {
    it('should default to human format when format is not specified', () => {
      const result = {
        success: true,
        status: 'healthy'
      };

      const formatted = formatCommandResult(result, 'health-check');
      
      expect(formatted.text).toContain('System Status:');
      expect(formatted.text).toContain('HEALTHY');
      expect(formatted.exitCode).toBe(0);
    });
  });
});