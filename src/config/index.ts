import { TaskDriverConfig, configSchema } from './types.js';

/**
 * Load configuration from environment variables
 * Following 12-factor app methodology
 */
export function loadConfig(): TaskDriverConfig {
  const envConfig = {
    server: {
      host: process.env.TASKDRIVER_HOST,
      port: process.env.TASKDRIVER_PORT ? parseInt(process.env.TASKDRIVER_PORT, 10) : undefined,
      mode: process.env.TASKDRIVER_MODE,
    },
    storage: {
      provider: process.env.TASKDRIVER_STORAGE_PROVIDER,
      connectionString: process.env.TASKDRIVER_STORAGE_CONNECTION_STRING,
      fileStorage: {
        dataDir: process.env.TASKDRIVER_FILE_DATA_DIR,
        lockTimeout: process.env.TASKDRIVER_FILE_LOCK_TIMEOUT 
          ? parseInt(process.env.TASKDRIVER_FILE_LOCK_TIMEOUT, 10) 
          : undefined,
      },
      mongodb: {
        database: process.env.TASKDRIVER_MONGODB_DATABASE,
        options: process.env.TASKDRIVER_MONGODB_OPTIONS 
          ? JSON.parse(process.env.TASKDRIVER_MONGODB_OPTIONS) 
          : undefined,
      },
      redis: {
        database: process.env.TASKDRIVER_REDIS_DATABASE 
          ? parseInt(process.env.TASKDRIVER_REDIS_DATABASE, 10) 
          : undefined,
        keyPrefix: process.env.TASKDRIVER_REDIS_KEY_PREFIX,
        options: process.env.TASKDRIVER_REDIS_OPTIONS 
          ? JSON.parse(process.env.TASKDRIVER_REDIS_OPTIONS) 
          : undefined,
      },
    },
    logging: {
      level: process.env.TASKDRIVER_LOG_LEVEL,
      pretty: process.env.TASKDRIVER_LOG_PRETTY?.toLowerCase() === 'true',
      correlation: process.env.TASKDRIVER_LOG_CORRELATION?.toLowerCase() !== 'false',
    },
    security: {
      enableAuth: process.env.TASKDRIVER_ENABLE_AUTH?.toLowerCase() !== 'false',
      apiKeyLength: process.env.TASKDRIVER_API_KEY_LENGTH 
        ? parseInt(process.env.TASKDRIVER_API_KEY_LENGTH, 10) 
        : undefined,
      sessionTimeout: process.env.TASKDRIVER_SESSION_TIMEOUT 
        ? parseInt(process.env.TASKDRIVER_SESSION_TIMEOUT, 10) 
        : undefined,
    },
    defaults: {
      maxRetries: process.env.TASKDRIVER_DEFAULT_MAX_RETRIES 
        ? parseInt(process.env.TASKDRIVER_DEFAULT_MAX_RETRIES, 10) 
        : undefined,
      leaseDurationMinutes: process.env.TASKDRIVER_DEFAULT_LEASE_DURATION 
        ? parseInt(process.env.TASKDRIVER_DEFAULT_LEASE_DURATION, 10) 
        : undefined,
      reaperIntervalMinutes: process.env.TASKDRIVER_REAPER_INTERVAL 
        ? parseInt(process.env.TASKDRIVER_REAPER_INTERVAL, 10) 
        : undefined,
    },
  };

  // Remove undefined values to let Joi apply defaults
  const cleanConfig = removeUndefined(envConfig);

  // Validate and apply defaults
  const { error, value } = configSchema.validate(cleanConfig, {
    allowUnknown: false,
    stripUnknown: true,
  });

  if (error) {
    throw new Error(`Configuration validation failed: ${error.message}`);
  }

  return value;
}

/**
 * Recursively remove undefined values from an object
 */
function removeUndefined(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeUndefined);
  }

  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefined(value);
    }
  }
  return cleaned;
}

/**
 * Get environment-specific configuration examples
 */
export function getConfigExamples() {
  return {
    development: {
      TASKDRIVER_STORAGE_PROVIDER: 'file',
      TASKDRIVER_FILE_DATA_DIR: './data',
      TASKDRIVER_LOG_LEVEL: 'debug',
      TASKDRIVER_LOG_PRETTY: 'true',
      TASKDRIVER_ENABLE_AUTH: 'false',
    },
    production: {
      TASKDRIVER_HOST: '0.0.0.0',
      TASKDRIVER_PORT: '3000',
      TASKDRIVER_STORAGE_PROVIDER: 'mongodb',
      TASKDRIVER_STORAGE_CONNECTION_STRING: 'mongodb://localhost:27017',
      TASKDRIVER_MONGODB_DATABASE: 'taskdriver',
      TASKDRIVER_LOG_LEVEL: 'info',
      TASKDRIVER_LOG_PRETTY: 'false',
      TASKDRIVER_ENABLE_AUTH: 'true',
    },
  };
}

export * from './types.js';