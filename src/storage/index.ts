import { TaskDriverConfig } from '../config/index.js';
import { StorageProvider } from './StorageProvider.js';
import { FileStorageProvider } from './FileStorageProvider.js';
import { MongoStorageProvider } from './MongoStorageProvider.js';
import { RedisStorageProvider } from './RedisStorageProvider.js';

/**
 * Create a storage provider based on configuration
 */
export function createStorageProvider(config: TaskDriverConfig): StorageProvider {
  switch (config.storage.provider) {
    case 'file':
      if (!config.storage.fileStorage) {
        throw new Error('File storage configuration is required when provider is "file"');
      }
      return new FileStorageProvider(
        config.storage.fileStorage.dataDir,
        config.storage.fileStorage.lockTimeout
      );
    
    case 'mongodb':
      if (!config.storage.connectionString) {
        throw new Error('MongoDB connection string is required when using MongoDB storage provider');
      }
      return new MongoStorageProvider(
        config.storage.connectionString,
        config.storage.mongodb?.database || 'taskdriver',
        true // Enable transactions in production
      );
    
    case 'redis':
      if (!config.storage.connectionString) {
        throw new Error('Redis connection string is required when using Redis storage provider');
      }
      return new RedisStorageProvider(
        config.storage.connectionString,
        config.storage.redis?.database || 0,
        config.storage.redis?.keyPrefix || 'taskdriver:'
      );
    
    default:
      throw new Error(`Unknown storage provider: ${config.storage.provider}`);
  }
}

export * from './StorageProvider.js';
export * from './FileStorageProvider.js';
export * from './MongoStorageProvider.js';
export * from './RedisStorageProvider.js';