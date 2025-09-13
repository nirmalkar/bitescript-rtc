import express from 'express';
import http from 'http';
import { createWsServer } from './ws/wsServer';

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'bitescript-rtc' }));

  app.get('/turn', (_req, res) => {
    //#TODO: Return ICE servers object for clients (protect in prod)
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

  const server = http.createServer(app);
  const ws = createWsServer(server);

  return { server, app, ws };
}
