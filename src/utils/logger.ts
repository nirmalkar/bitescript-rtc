import { format } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import FileStreamRotator from 'file-stream-rotator';
import type { Writable } from 'stream';

// Ensure logs directory exists
const LOGS_DIR = join(process.cwd(), 'logs');
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'security';

export interface LogTransport {
  write: (log: string) => void;
  end: () => void;
}

export interface LoggerConfig {
  level?: LogLevel;
  enableConsole?: boolean;
  enableFileRotation?: boolean;
  logDirectory?: string;
  maxSize?: string;
  maxFiles?: number;
  externalTransports?: LogTransport[];
}
type RequestInfo = {
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  requestId?: string;
};

type SecurityEvent = {
  type: 'AUTH_ATTEMPT' | 'RATE_LIMIT' | 'UNAUTHORIZED_ACCESS' | 'SUSPICIOUS_ACTIVITY';
  message: string;
  metadata?: Record<string, any>;
  request?: RequestInfo;
};

class Logger {
  private static instance: Logger;
  private level: LogLevel;
  private context: string;
  private transports: (Writable | LogTransport)[] = [];
  private fileStream: any; // File stream for rotation

  private constructor(context: string = 'App', config: LoggerConfig = {}) {
    this.context = context;
    this.level = (process.env.LOG_LEVEL as LogLevel) || config.level || 'info';

    // Initialize transports based on config
    this.initializeTransports(config);
  }

  private initializeTransports(config: LoggerConfig) {
    // Console transport (enabled by default)
    if (config.enableConsole !== false) {
      this.transports.push(process.stdout);
    }

    // File rotation transport
    if (config.enableFileRotation) {
      try {
        const logDir = config.logDirectory || LOGS_DIR;
        this.fileStream = FileStreamRotator.getStream({
          filename: join(logDir, 'app-%DATE%.log'),
          frequency: '1d', // Rotate daily
          date_format: 'YYYY-MM-DD',
          size: config.maxSize || '10M',
          max_logs: config.maxFiles?.toString() || '30d',
          audit_file: join(logDir, 'audit.json'),
          extension: '.log',
          create_symlink: true,
          symlink_name: 'app-current.log',
        });

        this.transports.push(this.fileStream);
      } catch (error) {
        console.error('Failed to initialize file rotation:', error);
      }
    }

    // Add any external transports
    if (config.externalTransports?.length) {
      this.transports.push(...config.externalTransports);
    }
  }

  public static getLogger(context?: string, config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(context, config);
    }
    return Logger.instance;
  }

  public addTransport(transport: Writable) {
    this.transports.push(transport);
  }

  public removeTransport(transport: Writable) {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      this.transports.splice(index, 1);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      security: 1, // Same level as info
    };
    return levels[this.level] <= levels[level];
  }

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedMessage = format(message, ...args);

    // Create structured log entry
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      context: this.context,
      message: formattedMessage,
      // Add any additional metadata from args
      ...(args[0] && typeof args[0] === 'object' ? args[0] : {}),
    };

    // Return as JSON string for structured logging
    return JSON.stringify(logEntry);
  }

  private writeLog(level: LogLevel, message: string, ...args: any[]) {
    if (!this.shouldLog(level)) return;

    const logMessage = this.formatMessage(level, message, ...args) + '\n';

    // Write to all transports
    this.transports.forEach((transport) => {
      transport.write(logMessage);
    });
  }

  public debug(message: string, ...args: any[]): void {
    this.writeLog('debug', message, ...args);
  }

  public info(message: string, ...args: any[]): void {
    this.writeLog('info', message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    this.writeLog('warn', message, ...args);
  }

  public error(message: string, ...args: any[]): void {
    this.writeLog('error', message, ...args);
  }

  // Security specific logging
  public security(event: SecurityEvent): void {
    this.writeLog('security', event.message, {
      ...event.metadata,
      type: event.type,
      request: event.request
    });
  }

  // Request logging middleware
  public requestLogger() {
    return (req: any, res: any, next: any) => {
      const start = Date.now();
      const requestId = req.headers['x-request-id'] || Math.random().toString(36).substring(2, 9);

      // Log request start
      this.info(`Request started: ${req.method} ${req.path}`, {
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Log response when finished
      res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration}ms`,
          user: req.user?.id || 'anonymous',
        };

        if (res.statusCode >= 400) {
          this.error('Request error', logData);
        } else {
          this.info('Request completed', logData);
        }
      });

      next();
    };
  }

  // Log suspicious activity
  public logSuspiciousActivity(event: Omit<SecurityEvent, 'type'>, requestInfo?: RequestInfo) {
    this.security({
      type: 'SUSPICIOUS_ACTIVITY',
      ...event,
      request: requestInfo,
    });
  }

  // Log authentication attempts
  public logAuthAttempt(
    success: boolean,
    message: string,
    metadata: Record<string, any> = {},
    requestInfo?: RequestInfo
  ) {
    this.security({
      type: 'AUTH_ATTEMPT',
      message,
      metadata: {
        success,
        ...metadata,
      },
      request: requestInfo,
    });
  }
}

// Default logger instance
export const logger = Logger.getLogger('App', {
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  enableConsole: process.env.NODE_ENV !== 'production' || process.env.LOG_TO_CONSOLE === 'true',
  enableFileRotation: process.env.LOG_TO_FILE === 'true',
  maxSize: process.env.LOG_MAX_SIZE || '10M',
  maxFiles: process.env.LOG_MAX_FILES ? parseInt(process.env.LOG_MAX_FILES) : 30,
});

// Helper to create a child logger with context
export const createLogger = (context: string) => Logger.getLogger(context);

export default logger;

