import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Structured Logger for TaskDriver
 * Provides centralized logging with different levels, structured output,
 * and integration with monitoring systems
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogContext {
  correlationId?: string;
  userId?: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  requestId?: string;
  operation?: string;
  duration?: number;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
  metrics?: {
    [key: string]: number;
  };
}

class Logger {
  private logLevel: LogLevel;
  private serviceName: string;
  private environment: string;
  private version: string;
  private testLogFile?: string;

  constructor(
    serviceName: string = 'taskdriver',
    logLevel: LogLevel = 'info',
    environment: string = process.env.NODE_ENV || 'development',
    version: string = process.env.npm_package_version || '1.0.0'
  ) {
    this.serviceName = serviceName;
    this.logLevel = logLevel;
    this.environment = environment;
    this.version = version;
    
    // Set up test log file if running tests
    if (this.environment === 'test' && process.env.TEST_LOG_FILE !== 'false') {
      const logDir = path.join(process.cwd(), 'test-logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.testLogFile = path.join(logDir, `test-${Date.now()}-${process.pid}.log`);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  private formatLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
    metrics?: { [key: string]: number }
  ): LogEntry {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };
    
    // Add service info to context
    if (!context) {
      context = {};
    }
    context.service = this.serviceName;
    context.environment = this.environment;
    context.version = this.version;

    if (context) {
      logEntry.context = context;
    }

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      };
    }

    if (metrics) {
      logEntry.metrics = metrics;
    }

    return logEntry;
  }

  private writeLog(logEntry: LogEntry): void {
    const output = JSON.stringify(logEntry);
    
    // Write to test log file if running tests
    if (this.testLogFile) {
      try {
        fs.appendFileSync(this.testLogFile, output + '\n');
      } catch (error) {
        // Fallback to console if file writing fails
        console.error('Failed to write to test log file:', error);
        if (logEntry.level === 'error' || logEntry.level === 'warn') {
          console.error(output);
        } else {
          console.log(output);
        }
      }
    } else {
      // Normal console output for non-test environments
      if (logEntry.level === 'error' || logEntry.level === 'warn') {
        console.error(output);
      } else {
        console.log(output);
      }
    }
  }

  error(message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog('error')) return;
    const logEntry = this.formatLogEntry('error', message, context, error);
    this.writeLog(logEntry);
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;
    const logEntry = this.formatLogEntry('warn', message, context);
    this.writeLog(logEntry);
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    const logEntry = this.formatLogEntry('info', message, context);
    this.writeLog(logEntry);
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;
    const logEntry = this.formatLogEntry('debug', message, context);
    this.writeLog(logEntry);
  }

  trace(message: string, context?: LogContext): void {
    if (!this.shouldLog('trace')) return;
    const logEntry = this.formatLogEntry('trace', message, context);
    this.writeLog(logEntry);
  }

  /**
   * Log with custom metrics
   */
  metric(message: string, metrics: { [key: string]: number }, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    const logEntry = this.formatLogEntry('info', message, context, undefined, metrics);
    this.writeLog(logEntry);
  }

  /**
   * Time a function execution and log the result
   */
  async timeAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = performance.now();
    const operationContext = { ...context, operation };
    
    this.debug(`Starting operation: ${operation}`, operationContext);
    
    try {
      const result = await fn();
      const duration = performance.now() - startTime;
      
      this.metric(`Operation completed: ${operation}`, 
        { duration, success: 1 },
        { ...operationContext, duration }
      );
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.error(`Operation failed: ${operation}`, 
        { ...operationContext, duration },
        error as Error
      );
      
      this.metric(`Operation failed: ${operation}`,
        { duration, success: 0, error: 1 },
        { ...operationContext, duration }
      );
      
      throw error;
    }
  }

  /**
   * Time a synchronous function execution and log the result
   */
  timeSync<T>(
    operation: string,
    fn: () => T,
    context?: LogContext
  ): T {
    const startTime = performance.now();
    const operationContext = { ...context, operation };
    
    this.debug(`Starting operation: ${operation}`, operationContext);
    
    try {
      const result = fn();
      const duration = performance.now() - startTime;
      
      this.metric(`Operation completed: ${operation}`, 
        { duration, success: 1 },
        { ...operationContext, duration }
      );
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      this.error(`Operation failed: ${operation}`, 
        { ...operationContext, duration },
        error as Error
      );
      
      this.metric(`Operation failed: ${operation}`,
        { duration, success: 0, error: 1 },
        { ...operationContext, duration }
      );
      
      throw error;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger(this.serviceName, this.logLevel, this.environment, this.version);
    
    // Override the formatLogEntry method to include additional context
    const originalFormatLogEntry = childLogger.formatLogEntry.bind(childLogger);
    childLogger.formatLogEntry = (level, message, context, error, metrics) => {
      const mergedContext = { ...additionalContext, ...context };
      return originalFormatLogEntry(level, message, mergedContext, error, metrics);
    };
    
    return childLogger;
  }

  /**
   * Set log level dynamically
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * Get test log file path (for testing environments)
   */
  getTestLogFile(): string | undefined {
    return this.testLogFile;
  }
}

// Create default logger instance
export const logger = new Logger();

// Export Logger class for custom instances
export { Logger };

/**
 * Helper function to create operation-specific loggers
 */
export function createOperationLogger(operation: string, context?: LogContext): Logger {
  return logger.child({ operation, ...context });
}

/**
 * Helper function to log HTTP requests
 */
export function logHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  context?: LogContext
): void {
  const level = statusCode >= 400 ? 'warn' : 'info';
  const message = `HTTP ${method} ${path} ${statusCode}`;
  
  logger.metric(message, {
    http_status_code: statusCode,
    http_duration_ms: duration,
    http_success: statusCode < 400 ? 1 : 0
  }, {
    ...context,
    http_method: method,
    http_path: path,
    http_status_code: statusCode
  });
}

/**
 * Helper function to log database operations
 */
export function logDatabaseOperation(
  operation: string,
  table: string,
  duration: number,
  recordCount?: number,
  context?: LogContext
): void {
  logger.metric(`Database ${operation} on ${table}`, {
    db_duration_ms: duration,
    db_record_count: recordCount || 0
  }, {
    ...context,
    db_operation: operation,
    db_table: table
  });
}

/**
 * Helper function to log cache operations
 */
export function logCacheOperation(
  operation: 'hit' | 'miss' | 'set' | 'delete',
  key: string,
  duration?: number,
  context?: LogContext
): void {
  logger.metric(`Cache ${operation} for ${key}`, {
    cache_duration_ms: duration || 0,
    cache_hit: operation === 'hit' ? 1 : 0,
    cache_miss: operation === 'miss' ? 1 : 0
  }, {
    ...context,
    cache_operation: operation,
    cache_key: key
  });
}