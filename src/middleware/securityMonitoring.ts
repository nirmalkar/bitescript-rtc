import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

type SecurityContext = {
  method: string;
  path: string;
  ip?: string;
  userId?: string;
  requestId: string;
  userAgent?: string;
};

export function securityMonitoringMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const requestId =
    req.headers['x-request-id']?.toString() || Math.random().toString(36).substring(2, 9);

  // Create security context for logging
  const securityContext: SecurityContext = {
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress?.toString() || undefined,
    userAgent: req.headers['user-agent'],
    userId: (req as any).user?.id || 'anonymous',
    requestId,
  };

  // Monitor for suspicious headers
  monitorSuspiciousHeaders(req.headers, securityContext);

  // Monitor for common attack patterns
  monitorAttackPatterns(req, securityContext);

  // Log authentication attempts
  if (isAuthPath(req.path)) {
    logger.logAuthAttempt(
      false, // Will be updated when auth is successful
      'Authentication attempt',
      { path: req.path, method: req.method },
      securityContext
    );
  }

  // Response monitoring
  const originalSend = res.send;
  res.send = function (body: any): Response {
    const responseTime = Date.now() - start;

    // Log slow responses
    if (responseTime > 1000) {
      // More than 1 second
      logger.warn('Slow response detected', {
        ...securityContext,
        responseTime: `${responseTime}ms`,
        statusCode: res.statusCode,
      });
    }

    // Log error responses
    if (res.statusCode >= 400) {
      logger.error('Error response', {
        ...securityContext,
        statusCode: res.statusCode,
        response:
          typeof body === 'string' ? body.substring(0, 500) : 'Response body too large to log',
      });
    }

    return originalSend.apply(res, arguments as any);
  };

  next();
}

function monitorSuspiciousHeaders(
  headers: { [key: string]: string | string[] | undefined },
  context: SecurityContext
) {
  const suspiciousHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'x-client-ip',
    'x-originating-ip',
    'x-remote-ip',
    'x-remote-addr',
  ];

  const detectedSuspiciousHeaders = Object.entries(headers).filter(([key]) =>
    suspiciousHeaders.includes(key.toLowerCase())
  );

  if (detectedSuspiciousHeaders.length > 0) {
    logger.logSuspiciousActivity(
      {
        message: 'Suspicious headers detected',
        metadata: {
          headers: detectedSuspiciousHeaders,
          requestId: context.requestId,
        },
      },
      context
    );
  }
}

function monitorAttackPatterns(req: Request, context: SecurityContext) {
  const attackPatterns = [
    { pattern: /<script[^>]*>.*<\/script>/gi, name: 'HTML Injection' },
    {
      pattern: /\b(?:union\s+select|select\s+\*\s+from|drop\s+table|1=1|\/\*.*\*\/)/gi,
      name: 'SQL Injection',
    },
    {
      pattern:
        /\b(?:eval\(|setTimeout\(|setInterval\(|Function\(|document\.|window\.|location\.)/gi,
      name: 'JavaScript Injection',
    },
    { pattern: /\b(?:\$\{.*\}|\$\{.*\}|\$\{.*\})/gi, name: 'Template Injection' },
  ];

  const requestString = `${req.method} ${req.path} ${JSON.stringify(req.query)} ${JSON.stringify(req.body)}`;
  const detectedAttacks = attackPatterns
    .filter(({ pattern }) => pattern.test(requestString))
    .map(({ name }) => name);

  if (detectedAttacks.length > 0) {
    logger.logSuspiciousActivity(
      {
        message: 'Possible attack pattern detected in request',
        metadata: {
          attackTypes: detectedAttacks,
          requestId: context.requestId,
          path: req.path,
          method: req.method,
        },
      },
      context
    );
  }
}

function isAuthPath(path: string): boolean {
  const authPaths = ['/auth', '/login', '/signin', '/register', '/signup'];
  return authPaths.some((authPath) => path.includes(authPath));
}

export function createWebSocketRateLimitMiddleware(limiter: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    limiter.limit(req.ip || req.connection.remoteAddress, (err: any) => {
      if (err) {
        logger.logSuspiciousActivity({
          message: 'WebSocket rate limit exceeded',
          metadata: {
            ip: req.ip || req.connection.remoteAddress,
            path: req.path,
            userAgent: req.headers['user-agent'],
          },
        });
        res.status(429).json({ error: 'Too many requests, please try again later.' });
        return;
      }
      next();
    });
  };
}
