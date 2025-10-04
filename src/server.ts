import express from 'express';
import http from 'http';
import { createWsServer } from './ws/wsServer';
import { signWsToken } from './auth/jwt';

export function createServer() {
  const app = express();

  // Enable CORS for all routes (dev-friendly; tighten in prod)
  app.use((req, res, next): void => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    next();
  });

  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'bitescript-rtc' }));

  // Return ICE servers object for clients (protect in prod)
  app.get('/api/turn', (_req, res) => {
    if (process.env.TURN_URL) {
      return res.json({
        iceServers: [
          process.env.STUN_URL ? { urls: process.env.STUN_URL } : undefined,
          {
            urls: process.env.TURN_URL,
            username: process.env.TURN_USER,
            credential: process.env.TURN_PASS,
          },
        ].filter(Boolean),
      });
    }
    return res.json({ iceServers: [] });
  });

  app.post('/api/ws-token', (req, res) => {
    // TODO: In prod, validate the user session / authorization here.
    // e.g. if (!req.session?.user) return res.status(403).json({ error: 'unauthorized' });
    const secretConfigured = !!process.env.WS_JWT_SECRET;
    if (!secretConfigured) {
      console.error('WS_JWT_SECRET is not configured on server; cannot sign tokens');
      return res.status(500).json({ error: 'server_misconfigured' });
    }

    const userId = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
    const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId : undefined;

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
