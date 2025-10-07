import cors, { CorsOptions } from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Request, Response, NextFunction, RequestHandler } from 'express-serve-static-core';

import type { Config } from '../configuration';
import { logger } from '../utils/logger';

import { securityMonitoringMiddleware } from './securityMonitoring';

interface ConnectionAttempt {
  count: number;
  lastAttempt: number;
}

const connectionAttempts = new Map<string, ConnectionAttempt>();
const wsConnections = new Map<string, number>();

const MAX_WS_CONNECTIONS_PER_IP = 5;

export function createSecurityMiddleware(config: Config): RequestHandler[] {
  const corsOptions: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      try {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (!config.cors?.allowedOrigins?.length) {
          // If no allowed origins are configured, allow all in development only
          if (config.nodeEnv === 'development') {
            logger.warn('No CORS allowed origins configured, allowing all in development');
            return callback(null, true);
          }
          logger.error('CORS not properly configured in production');
          return callback(new Error('CORS not configured properly'));
        }

        // Allow if origin is in allowed list or if wildcard is present
        if (
          config.cors.allowedOrigins.includes(origin) ||
          config.cors.allowedOrigins.includes('*')
        ) {
          return callback(null, true);
        }

        logger.warn(`CORS request blocked from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      } catch (error) {
        logger.error('Error in CORS validation', { error });
        callback(error instanceof Error ? error : new Error('CORS validation failed'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200, // For legacy browser support
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
  };

  // API rate limiter (local to factory)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  // Default rate limiter for most API endpoints
  const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
    skip: (req: Request) => {
      // Skip rate limiting for health checks and in development
      return req.path === '/api/health' || config.nodeEnv === 'development';
    },
  });

  // Stricter rate limiter for authentication endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 requests per windowMs for auth endpoints
    message: { error: 'Too many login attempts, please try again later.' },
    handler: (req: Request, res: Response) => {
      logger.warn('Authentication rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent'],
      });
      res.status(429).json({ error: 'Too many login attempts, please try again later.' });
    },
  });

  // Apply rate limiting based on path
  const rateLimiter: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    // Apply stricter limits to auth endpoints
    if (req.path.startsWith('/api/auth/')) {
      return authLimiter(req, res, next);
    }
    // Apply default limits to all other API endpoints
    if (req.path.startsWith('/api/')) {
      return defaultLimiter(req, res, next);
    }
    // Skip rate limiting for other routes (e.g., static files)
    return next();
  };

  // WebSocket connection limiter middleware
  const wsConnectionLimiter = (req: Request, res: Response, next: NextFunction): void => {
    // Only apply to WebSocket upgrade requests
    if ((req.headers.upgrade || '').toLowerCase() === 'websocket') {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Track connection attempts
      const now = Date.now();
      const attemptWindow = now - 60000; // 1 minute window

      // Clean up old attempts
      connectionAttempts.forEach((value, key) => {
        if (value.lastAttempt < attemptWindow) {
          connectionAttempts.delete(key);
        }
      });

      // Get or initialize attempt counter
      const attempts = connectionAttempts.get(ip) || { count: 0, lastAttempt: 0 };

      // Check rate limit (e.g., max 10 connection attempts per minute)
      if (attempts.count >= 10 && now - attempts.lastAttempt < 60000) {
        logger.warn('WebSocket connection rate limit exceeded', {
          ip,
          userAgent,
          path: req.path,
          attempts: attempts.count,
        });

        res.status(429).json({
          error: 'Too many connection attempts',
          retryAfter: Math.ceil((attempts.lastAttempt + 60000 - now) / 1000),
        });
        return;
      }

      // Update attempt counter
      connectionAttempts.set(ip, {
        count: attempts.count + 1,
        lastAttempt: now,
      });

      const connectionCount = wsConnections.get(ip) || 0;
      if (connectionCount >= MAX_WS_CONNECTIONS_PER_IP) {
        logger.warn('Maximum WebSocket connections exceeded', {
          ip,
          userAgent,
          path: req.path,
          currentConnections: connectionCount,
          maxConnections: MAX_WS_CONNECTIONS_PER_IP,
        });

        res.status(429).json({
          error: 'Too many WebSocket connections',
          retryAfter: 300, // 5 minutes in seconds
        });
        return;
      }

      // Log new connection
      logger.info('New WebSocket connection', {
        ip,
        userAgent,
        path: req.path,
        connectionCount: connectionCount + 1,
      });

      // Increment connection count
      wsConnections.set(ip, connectionCount + 1);

      // Decrement on connection close
      req.on('close', () => {
        const currentCount = wsConnections.get(ip) || 0;
        if (currentCount > 0) {
          wsConnections.set(ip, currentCount - 1);
          logger.debug('WebSocket connection closed', {
            ip,
            remainingConnections: currentCount - 1,
          });
        }
      });
    }
    next();
  };

  // Security headers middleware with enhanced CSP
  return [
    // Security monitoring middleware (should be first to catch all requests)
    securityMonitoringMiddleware as unknown as RequestHandler,

    // Apply CORS before other middleware
    cors(corsOptions),

    // Rate limiting for HTTP requests
    rateLimiter,

    // WebSocket connection limiting
    wsConnectionLimiter,

    // Set security headers using helmet with more permissive CSP for web apps
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Required for some web frameworks
            "'unsafe-eval'", // Required for some web frameworks
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https: data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
        },
      },
      frameguard: {
        action: 'deny',
      },
      hsts: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
      xssFilter: true,
    }),

    // Disable X-Powered-By header
    (_req: Request, res: Response, next: NextFunction): void => {
      res.removeHeader('X-Powered-By');
      next();
    },

    // Apply rate limiting to all API routes
    (req: Request, res: Response, next: NextFunction): void => {
      if (req.path.startsWith('/api/')) {
        return void apiLimiter(req, res, next);
      }
      return void next();
    },
  ];
}

// Ensure module exposes both named + default export to avoid CJS/ESM interop issues
export default createSecurityMiddleware;
