import { IncomingMessage } from 'http';
import { WebSocketServer as WSS } from 'ws';
import { URL } from 'url';
import { verifyWsToken } from '../../auth/jwt';
import logger from '../../utils/logger';

export function createUpgradeHandler(opts: { wss: WSS; allowedOrigins: string[] }) {
  const { wss, allowedOrigins } = opts;

  return (req: IncomingMessage, socket: any, head: Buffer) => {
    (async () => {
      const origin = (req.headers.origin as string) || '';
      const requestIp = req.socket.remoteAddress || 'unknown';
      const isDevelopment = process.env.NODE_ENV !== 'production';

      // CORS / origin check (skip strict check in development)
      if (!isDevelopment && allowedOrigins[0] !== '*') {
        try {
          const isAllowed = allowedOrigins.some((allowedOrigin) => {
            if (allowedOrigin === '*') return true;
            if (!origin) return false;
            try {
              const originHostname = new URL(origin).hostname;
              const allowedHostname = new URL(allowedOrigin).hostname;
              return (
                originHostname === allowedHostname || originHostname.endsWith(`.${allowedHostname}`)
              );
            } catch (e) {
              logger.warn('Error parsing URL during CORS check: %o', e);
              return false;
            }
          });

          if (!isAllowed) {
            logger.warn(
              `🚫 Blocked WebSocket connection from unauthorized origin: ${origin} (${requestIp})`
            );
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch (err) {
          logger.error('Error during CORS check: %o', err);
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const userId = url.searchParams.get('userId');
        const roomId = url.searchParams.get('roomId');

        if (!isDevelopment && !token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        if (!isDevelopment && token) {
          const jwtResult = await verifyWsToken(token);
          if (!jwtResult || !('ok' in jwtResult) || !jwtResult.ok) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        wss.handleUpgrade(req, socket as any, head, (ws) => {
          // initialize some basic fields on the socket so connection handler can use them
          try {
            const client = ws as any;
            client.id = userId || client.id;
            client.userId = userId ?? undefined;
            client.isAlive = true;
            client.ip = requestIp;
            client.userAgent = (req.headers['user-agent'] as string) || 'unknown';
            client.origin = origin;
            client.roomId = roomId || null;
          } catch (e) {
            // ignore
            logger.debug('Error setting preliminary client fields: %o', e);
          }
          wss.emit('connection', ws, req);
        });
      } catch (err) {
        logger.error('Error during WebSocket upgrade: %o', err);
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        } catch {}
        socket.destroy();
      }
    })().catch((err) => {
      logger.error('Unexpected error in upgrade handler: %o', err);
      try {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      } catch {}
      socket.destroy();
    });
  };
}
