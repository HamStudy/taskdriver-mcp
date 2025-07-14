// Core entity types
export * from './Project.js';
export * from './TaskType.js';
export * from './Task.js';
export * from './Agent.js';
export * from './Session.js';

// Additional enums
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type AgentStatus = 'idle' | 'working' | 'disabled';

// Common utility types
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

// Storage and service types
export interface StorageConfig {
  provider: 'file' | 'mongodb' | 'redis';
  connectionString?: string;
  options?: Record<string, any>;
}

export interface ServerConfig {
  port: number;
  host: string;
  storage: StorageConfig;
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
  };
  security: {
    enableAuth: boolean;
    apiKeyLength: number;
  };
}