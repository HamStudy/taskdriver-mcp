// Core entity types
export * from './Project.js';
export * from './TaskType.js';
export * from './Task.js';
export * from './Agent.js';
export * from './Session.js';

// Additional enums
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

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
  value?: string | number | boolean | object | null;
}

// Error handling types and utilities
export interface ErrorWithMessage {
  message: string;
}

export interface ErrorWithCode extends ErrorWithMessage {
  code: string;
}

export function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

export function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return (
    isErrorWithMessage(error) &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  );
}

export function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
  if (isErrorWithMessage(maybeError)) return maybeError;
  
  try {
    return new Error(JSON.stringify(maybeError));
  } catch {
    // fallback in case there's an error stringifying the maybeError
    // like with circular references for example.
    return new Error(String(maybeError));
  }
}

// Storage and service types
export interface StorageConfig {
  provider: 'file' | 'mongodb' | 'redis';
  connectionString?: string;
  options?: Record<string, unknown>;
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