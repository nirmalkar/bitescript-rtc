import { Request, Response, NextFunction, RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import type { Config } from '../configuration';

// WebSocket rate limiting configuration
const wsRateLimiter = new RateLimiterMemory({
  points: 30, // 30 connection attempts
  duration: 60, // per 60 seconds
  blockDuration: 300, // block for 5 minutes if limit is exceeded
});

// Track active WebSocket connections per IP
const wsConnections = new Map<string, number>();
const MAX_WS_CONNECTIONS_PER_IP = 5; // Maximum concurrent WebSocket connections per IP

export function createSecurityMiddleware(config: Config): RequestHandler[] {
  // Configure CORS
  const corsOptions = {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (config.cors.allowedOrigins.length === 0) {
        // If no allowed origins are configured, allow all in development
        if (config.nodeEnv === 'development') {
          return callback(null, true);
        }
        return callback(new Error('CORS not configured properly'));
      }

      if (config.cors.allowedOrigins.includes(origin) || config.cors.allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
  };

  // Configure rate limiting
  // Default rate limiter for most API endpoints
  const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => {
      // Skip rate limiting for health checks and in development
      return req.path === '/api/health' || config.nodeEnv === 'development';
    }
  });

  // Stricter rate limiter for authentication endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 requests per windowMs for auth endpoints
    message: { error: 'Too many login attempts, please try again later.' }
  });

  // Apply rate limiting based on path
  const rateLimiter: RequestHandler = (req, res, next) => {
    // Apply stricter limits to auth endpoints
    if (req.path.startsWith('/api/auth/')) {
      return authLimiter(req, res, next);
    }
    // Apply default limits to all other API endpoints
    if (req.path.startsWith('/api/')) {
      return defaultLimiter(req, res, next);
    }
    // Skip rate limiting for other routes (e.g., static files)
    next();
  };

  // WebSocket connection limiter middleware
  const wsConnectionLimiter = (req: Request, res: Response, next: NextFunction) => {
    // Only apply to WebSocket upgrade requests
    if (req.headers.upgrade === 'websocket') {
      const ip = req.ip || req.socket.remoteAddress;
      
      if (!ip) {
        return res.status(400).json({ error: 'Invalid IP address' });
      }

      const connectionCount = wsConnections.get(ip) || 0;
      if (connectionCount >= MAX_WS_CONNECTIONS_PER_IP) {
        return res.status(429).json({ 
          error: 'Too many WebSocket connections',
          retryAfter: 300 // 5 minutes in seconds
        });
      }

      // Increment connection count
      wsConnections.set(ip, connectionCount + 1);
      
      // Decrement on connection close
      req.on('close', () => {
        const currentCount = wsConnections.get(ip) || 0;
        if (currentCount > 0) {
          wsConnections.set(ip, currentCount - 1);
        }
      });
    }
    next();
  };

  // Security headers middleware
  return [
    // Rate limiting for HTTP requests
    rateLimiter,
    // WebSocket connection limiting
    wsConnectionLimiter,
    // Set security headers using helmet
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      xssFilter: true,
    }),

    // Disable X-Powered-By header
    (req: Request, res: Response, next: NextFunction) => {
      res.removeHeader('X-Powered-By');
      next();
    },

    // Apply CORS
    cors(corsOptions),

    // Apply rate limiting to all API routes
    (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        return apiLimiter(req, res, next);
      }
      next();
    },
  ];
}

export default createSecurityMiddleware;
