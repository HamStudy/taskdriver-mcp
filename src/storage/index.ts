import { TaskDriverConfig } from '../config/index.js';
import { StorageProvider } from './StorageProvider.js';
import { FileStorageProvider } from './FileStorageProvider.js';
// MongoDB and Redis providers temporarily disabled during lease-based migration
// import { MongoStorageProvider } from './MongoStorageProvider.js';
// import { RedisStorageProvider } from './RedisStorageProvider.js';

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
      throw new Error('MongoDB storage provider temporarily disabled during lease-based migration. Use "file" storage provider.');
    
    case 'redis':
      if (!config.storage.connectionString) {
        throw new Error('Redis connection string is required when using Redis storage provider');
      }
      throw new Error('Redis storage provider temporarily disabled during lease-based migration. Use "file" storage provider.');
    
    default:
      throw new Error(`Unknown storage provider: ${config.storage.provider}`);
  }
}

export * from './StorageProvider.js';
export * from './FileStorageProvider.js';
// MongoDB and Redis providers temporarily disabled during lease-based migration
// export * from './MongoStorageProvider.js';
// export * from './RedisStorageProvider.js';