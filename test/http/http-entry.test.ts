import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * HTTP Entry Point Tests
 * Tests the HTTP server startup and configuration
 */

const TEST_DATA_DIR = path.join(process.cwd(), 'test-http-entry-data');

// Mock environment variables for testing
const originalEnv = process.env;

describe('HTTP Entry Point', () => {
  beforeEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }

    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    // Restore environment
    process.env = originalEnv;
    
    // Clean up test data
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch (error) {
      // Ignore if directory doesn't exist
    }
  });

  test('should export TaskDriverHttpServer class', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    expect(TaskDriverHttpServer).toBeDefined();
    expect(typeof TaskDriverHttpServer).toBe('function');
  });

  test('should be able to create server instance with config', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    
    const config = {
      server: {
        host: 'localhost',
        port: 0,
        cors: { origin: '*', credentials: true }
      },
      storage: {
        provider: 'file' as const,
        fileStorage: {
          dataDir: TEST_DATA_DIR,
          lockTimeout: 5000
        }
      },
      logging: {
        level: 'error',
        format: 'json'
      },
      security: {
        sessionTimeout: 60000,
        rateLimit: { windowMs: 60000, max: 1000 }
      },
      defaults: {
        taskTimeout: 300000,
        maxRetries: 3,
        retryDelay: 1000
      }
    };

    const server = new TaskDriverHttpServer(config);
    expect(server).toBeInstanceOf(TaskDriverHttpServer);
    
    // Test initialization
    await server.initialize();
    await server.stop();
  });

  test('should handle server lifecycle correctly', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    
    const config = {
      server: {
        host: 'localhost',
        port: 0, // Use random port
        cors: { origin: '*', credentials: true }
      },
      storage: {
        provider: 'file' as const,
        fileStorage: {
          dataDir: TEST_DATA_DIR,
          lockTimeout: 5000
        }
      },
      logging: {
        level: 'error',
        format: 'json'
      },
      security: {
        sessionTimeout: 60000,
        rateLimit: { windowMs: 60000, max: 1000 }
      },
      defaults: {
        taskTimeout: 300000,
        maxRetries: 3,
        retryDelay: 1000
      }
    };

    const server = new TaskDriverHttpServer(config);
    
    // Should initialize without errors
    await expect(server.initialize()).resolves.toBeUndefined();
    
    // Should start without errors
    await expect(server.start()).resolves.toBeUndefined();
    
    // Should stop without errors
    await expect(server.stop()).resolves.toBeUndefined();
  });

  test('should handle initialization errors gracefully', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    
    const invalidConfig = {
      server: {
        host: 'localhost',
        port: 0,
        cors: { origin: '*', credentials: true }
      },
      storage: {
        provider: 'file' as const,
        fileStorage: {
          dataDir: '/invalid/path/that/cannot/be/created',
          lockTimeout: 5000
        }
      },
      logging: {
        level: 'error',
        format: 'json'
      },
      security: {
        sessionTimeout: 60000,
        rateLimit: { windowMs: 60000, max: 1000 }
      },
      defaults: {
        taskTimeout: 300000,
        maxRetries: 3,
        retryDelay: 1000
      }
    };

    const server = new TaskDriverHttpServer(invalidConfig);
    
    // Should handle invalid storage configuration
    await expect(server.initialize()).rejects.toThrow();
  });

  test('should validate configuration requirements', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    
    // Missing required configuration sections should throw during initialization
    const incompleteConfig = {
      server: {
        host: 'localhost',
        port: 0
      }
      // Missing storage, logging, security, defaults
    } as any;

    const server = new TaskDriverHttpServer(incompleteConfig);
    await expect(server.initialize()).rejects.toThrow();
  });

  test('should handle multiple start/stop cycles', async () => {
    const { TaskDriverHttpServer } = await import('../../src/server.js');
    
    const config = {
      server: {
        host: 'localhost',
        port: 0,
        cors: { origin: '*', credentials: true }
      },
      storage: {
        provider: 'file' as const,
        fileStorage: {
          dataDir: TEST_DATA_DIR,
          lockTimeout: 5000
        }
      },
      logging: {
        level: 'error',
        format: 'json'
      },
      security: {
        sessionTimeout: 60000,
        rateLimit: { windowMs: 60000, max: 1000 }
      },
      defaults: {
        taskTimeout: 300000,
        maxRetries: 3,
        retryDelay: 1000
      }
    };

    const server = new TaskDriverHttpServer(config);
    
    // Initialize once
    await server.initialize();
    
    // Multiple start/stop cycles
    await server.start();
    await server.stop();
    
    await server.start();
    await server.stop();
    
    // Final cleanup
    await server.stop(); // Should handle multiple stops gracefully
  });
});