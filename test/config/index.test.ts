import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadConfig, configSchema } from '../../src/config/index.js';

describe('Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load configuration with sensible defaults', () => {
      // Clear relevant env vars
      delete process.env.TASKDRIVER_STORAGE_PROVIDER;
      delete process.env.TASKDRIVER_STORAGE_CONNECTION_STRING;
      delete process.env.TASKDRIVER_LOG_LEVEL;
      delete process.env.TASKDRIVER_PORT;
      delete process.env.TASKDRIVER_HOST;

      const config = loadConfig();
      
      // Test sensible default choices
      expect(config.storage.provider).toBe('file');
      expect(config.logging.level).toBe('info');
      expect(config.logging.pretty).toBe(false);
      expect(config.security.enableAuth).toBe(true);
      expect(config.server.host).toBe('localhost');
      
      // Test that numeric values are reasonable (not testing specific magic numbers)
      expect(config.security.apiKeyLength).toBeGreaterThan(16);
      expect(config.server.port).toBeGreaterThan(1000);
      expect(config.server.port).toBeLessThan(65536);
    });

    it('should load configuration from environment variables', () => {
      process.env.TASKDRIVER_STORAGE_PROVIDER = 'mongodb';
      process.env.TASKDRIVER_STORAGE_CONNECTION_STRING = 'mongodb://localhost:27017/taskdriver';
      process.env.TASKDRIVER_MONGODB_DATABASE = 'taskdriver';
      process.env.TASKDRIVER_LOG_LEVEL = 'debug';
      process.env.TASKDRIVER_LOG_PRETTY = 'false';
      process.env.TASKDRIVER_PORT = '8080';
      process.env.TASKDRIVER_HOST = '0.0.0.0';
      process.env.TASKDRIVER_ENABLE_AUTH = 'false';
      process.env.TASKDRIVER_API_KEY_LENGTH = '64';

      const config = loadConfig();
      expect(config.storage.provider).toBe('mongodb');
      expect(config.storage.connectionString).toBe('mongodb://localhost:27017/taskdriver');
      expect(config.storage.mongodb?.database).toBe('taskdriver');
      expect(config.logging.level).toBe('debug');
      expect(config.logging.pretty).toBe(false);
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.security.enableAuth).toBe(false);
      expect(config.security.apiKeyLength).toBe(64);
    });

    it('should handle Redis configuration', () => {
      process.env.TASKDRIVER_STORAGE_PROVIDER = 'redis';
      process.env.TASKDRIVER_STORAGE_CONNECTION_STRING = 'redis://localhost:6379';
      process.env.TASKDRIVER_REDIS_DATABASE = '1';
      process.env.TASKDRIVER_REDIS_KEY_PREFIX = 'test:';

      const config = loadConfig();
      expect(config.storage.provider).toBe('redis');
      expect(config.storage.connectionString).toBe('redis://localhost:6379');
      expect(config.storage.redis?.database).toBe(1);
      expect(config.storage.redis?.keyPrefix).toBe('test:');
    });

    it('should handle file storage data directory', () => {
      process.env.TASKDRIVER_STORAGE_PROVIDER = 'file';
      process.env.TASKDRIVER_FILE_DATA_DIR = '/custom/data/path';

      const config = loadConfig();
      expect(config.storage.provider).toBe('file');
      expect(config.storage.fileStorage?.dataDir).toBe('/custom/data/path');
    });

    it('should parse numeric values correctly', () => {
      process.env.TASKDRIVER_PORT = '9000';
      process.env.TASKDRIVER_API_KEY_LENGTH = '48';

      const config = loadConfig();
      expect(config.server.port).toBe(9000);
      expect(config.security.apiKeyLength).toBe(48);
    });

    it('should parse boolean values correctly', () => {
      process.env.TASKDRIVER_LOG_PRETTY = 'true';
      process.env.TASKDRIVER_ENABLE_AUTH = 'false';

      const config = loadConfig();
      expect(config.logging.pretty).toBe(true);
      expect(config.security.enableAuth).toBe(false);
    });

    it('should handle boolean values with different cases', () => {
      process.env.TASKDRIVER_LOG_PRETTY = 'TRUE';
      process.env.TASKDRIVER_ENABLE_AUTH = 'False';

      const config = loadConfig();
      expect(config.logging.pretty).toBe(true);
      expect(config.security.enableAuth).toBe(false);
    });
  });

  describe('configSchema', () => {
    it('should validate valid configuration', () => {
      const validConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'file',
          fileStorage: {
            dataDir: './data'
          }
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(validConfig);
      expect(error).toBeUndefined();
    });

    it('should reject invalid storage provider', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'invalid'
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should reject invalid log level', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'file',
          fileStorage: {
            dataDir: './data'
          }
        },
        logging: {
          level: 'invalid',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should reject invalid port numbers', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 70000, // Invalid port
          mode: 'mcp'
        },
        storage: {
          provider: 'file',
          fileStorage: {
            dataDir: './data'
          }
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should reject invalid API key length', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'file',
          fileStorage: {
            dataDir: './data'
          }
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 5 // Too short
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should require connection string for MongoDB', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'mongodb',
          mongodb: {
            database: 'taskdriver'
          }
          // Missing connectionString
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should require connection string for Redis', () => {
      const invalidConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'redis',
          redis: {
            database: 0,
            keyPrefix: 'taskdriver:'
          }
          // Missing connectionString
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(invalidConfig);
      expect(error).toBeDefined();
    });

    it('should accept valid MongoDB configuration', () => {
      const validConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'mongodb',
          connectionString: 'mongodb://localhost:27017/taskdriver',
          mongodb: {
            database: 'taskdriver'
          }
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(validConfig);
      expect(error).toBeUndefined();
    });

    it('should accept valid Redis configuration', () => {
      const validConfig = {
        server: {
          host: 'localhost',
          port: 3000,
          mode: 'mcp'
        },
        storage: {
          provider: 'redis',
          connectionString: 'redis://localhost:6379',
          redis: {
            database: 0,
            keyPrefix: 'taskdriver:'
          }
        },
        logging: {
          level: 'info',
          pretty: true
        },
        security: {
          enableAuth: true,
          apiKeyLength: 32
        }
      };

      const { error } = configSchema.validate(validConfig);
      expect(error).toBeUndefined();
    });
  });
});