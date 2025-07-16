import Joi from 'joi';

export interface TaskDriverConfig {
  // Server configuration
  server: {
    host: string;
    port: number;
    mode: 'mcp' | 'http';
  };

  // Storage configuration
  storage: {
    provider: 'file' | 'mongodb' | 'redis';
    connectionString?: string;
    fileStorage?: {
      dataDir: string;
      lockTimeout: number;
    };
    mongodb?: {
      database: string;
      options?: Record<string, string | number | boolean>;
    };
    redis?: {
      database: number;
      keyPrefix: string;
      options?: Record<string, string | number | boolean>;
    };
  };

  // Logging configuration
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
    correlation: boolean;
  };

  // Security configuration
  security: {
    enableAuth: boolean;
    apiKeyLength: number;
    sessionTimeout: number;
  };

  // MCP configuration
  mcp: {
    promptPrefix: string;
  };

  // Default project settings
  defaults: {
    maxRetries: number;
    leaseDurationMinutes: number;
    reaperIntervalMinutes: number;
  };
}

export const configSchema = Joi.object<TaskDriverConfig>({
  server: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().port().default(3000),
    mode: Joi.string().valid('mcp', 'http').default('mcp'),
  }).default(),

  storage: Joi.object({
    provider: Joi.string().valid('file', 'mongodb', 'redis').default('file'),
    connectionString: Joi.string().when('provider', {
      is: Joi.valid('mongodb', 'redis'),
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    fileStorage: Joi.object({
      dataDir: Joi.string().default('./data'),
      lockTimeout: Joi.number().default(30000), // 30 seconds
    }).when('provider', {
      is: 'file',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    mongodb: Joi.object({
      database: Joi.string().default('taskdriver'),
      options: Joi.object().default({}),
    }).when('provider', {
      is: 'mongodb',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    redis: Joi.object({
      database: Joi.number().default(0),
      keyPrefix: Joi.string().default('taskdriver:'),
      options: Joi.object().default({}),
    }).when('provider', {
      is: 'redis',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }).default(),

  logging: Joi.object({
    level: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
    pretty: Joi.boolean().default(process.env.NODE_ENV !== 'production'),
    correlation: Joi.boolean().default(true),
  }).default(),

  mcp: Joi.object({
    promptPrefix: Joi.string().default('taskdriver'),
  }).default(),

  security: Joi.object({
    enableAuth: Joi.boolean().default(true),
    apiKeyLength: Joi.number().min(16).max(128).default(32),
    sessionTimeout: Joi.number().default(3600000), // 1 hour
  }).default(),

  defaults: Joi.object({
    maxRetries: Joi.number().min(0).default(3),
    leaseDurationMinutes: Joi.number().min(1).default(10),
    reaperIntervalMinutes: Joi.number().min(1).default(1),
  }).default(),
}).default();