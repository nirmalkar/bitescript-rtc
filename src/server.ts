import express from 'express';
import http from 'http';
import compression from 'compression';
import { createWsServer } from './ws/wsServer';
import { signWsToken } from './auth/jwt';
import { config } from './configuration';
import createSecurityMiddleware from './middleware/security';

export function createServer() {
  const app = express();

  // Apply security middleware with config
  const securityMiddleware = createSecurityMiddleware(config);
  app.use(securityMiddleware);
  
  // Enable JSON body parsing with size limit
  app.use(express.json({ limit: '10kb' }));
  
  // Enable compression
  app.use(compression());

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bitescript-rtc' }));

  // Return ICE servers object for clients (protect in prod)
  app.get('/api/turn', (_req, res) => {
    const iceServers = [];
    
    // Add STUN server if configured
    if (config.turn.stunUrl) {
      iceServers.push({ urls: config.turn.stunUrl });
    }
    
    // Add TURN server if configured
    if (config.turn.turnUrl && config.turn.turnUsername && config.turn.turnPassword) {
      iceServers.push({
        urls: config.turn.turnUrl,
        username: config.turn.turnUsername,
        credential: config.turn.turnPassword,
      });
    }
    
    return res.json({ iceServers });
  });

  app.post('/api/ws-token', (req, res) => {
    // In production, you should validate the user session/authorization here
    // For example:
    // if (!req.user) {
    //   return res.status(403).json({ error: 'Unauthorized' });
    // }
    
    // Get user ID and room ID from the request
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
    const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId : undefined;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    if (!config.jwt.secret || config.jwt.secret === 'default_jwt_secret') {
      console.error('JWT secret is not properly configured');
      return res.status(500).json({ error: 'server_misconfigured' });
    }

    try {
      const token = signWsToken(
        // payload
        {
          ...(userId ? { userId } : {}),
          ...(roomId ? { roomId } : {}),
        },
        // opts
        { expiresIn: '5m' }
      );

      return res.json({ token });
    } catch (err) {
      console.error('Failed to sign WS token', err);
      return res.status(500).json({ error: 'token_generation_failed' });
    }
  });

  const server = http.createServer(app);
  const ws = createWsServer(server);

  return { server, app, ws };
}
