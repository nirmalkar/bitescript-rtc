// src/ws/createWsServer.ts
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket as WS, WebSocketServer as WSS } from 'ws';
import { verifyWsToken } from '../auth/jwt';
import { InMemoryRoomManager } from '../rooms/inMemoryRooms';

interface WebSocketClient extends WS {
  id: string;
  isAlive: boolean;
  ip?: string;
  userAgent?: string;
  origin?: string;
}

// Default allowed origins (add your production domains here)
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://your-production-domain.com',
];

export function createWsServer(server: http.Server) {
  console.log('🚀 Initializing WebSocket server...');

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  console.log('🌐 Allowed origins:', allowedOrigins);

  // IMPORTANT: noServer: true -> we will handle upgrade manually in server.on('upgrade')
  const wss = new WSS({
    noServer: true,
    clientTracking: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024,
    },
  });

  const instanceId = uuidv4();
  const roomManager = new InMemoryRoomManager();
  const activeConnections = new Set<WebSocketClient>();
  const HEARTBEAT_INTERVAL = 30000; // 30 seconds

  // Single place for new connection setup
  function handleNewConnection(ws: WebSocketClient, req: http.IncomingMessage) {
    ws.id = uuidv4();
    ws.isAlive = true;
    ws.ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    ws.userAgent = (req.headers['user-agent'] as string) || 'unknown';
    ws.origin = (req.headers.origin as string) || 'unknown';

    activeConnections.add(ws);

    // Heartbeat
    let missedPings = 0;
    const maxMissedPings = 3;
    const heartbeatInterval = setInterval(() => {
      if (!ws.isAlive) {
        missedPings++;
        if (missedPings >= maxMissedPings) {
          clearInterval(heartbeatInterval);
          return ws.terminate();
        }
      } else {
        missedPings = 0;
      }

      ws.isAlive = false;
      try {
        ws.ping('ping');
      } catch (error) {
        clearInterval(heartbeatInterval);
        ws.terminate();
      }
    }, HEARTBEAT_INTERVAL);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        // Broadcast to all clients in the same room
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) { // 1 = OPEN
            client.send(JSON.stringify(message));
          }
        });
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Send initial connected message
    try {
      ws.send(
        JSON.stringify({
          type: 'connected',
          from: 'server',
          payload: { message: 'Successfully connected to WebSocket server' },
        })
      );
    } catch (err) {
      // client may have closed already
    }
  }

  // Reuse the handler for normal connections (if any)
  wss.on('connection', (ws: WS, req: http.IncomingMessage) => {
    handleNewConnection(ws as WebSocketClient, req);
  });

  wss.on('error', (error: Error) => {
    console.error('WebSocket server error:', error);
  });

  // Manual upgrade handling (auth / origin checks here)
  server.on('upgrade', (req, socket, head) => {
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
            console.warn('Error parsing URL during CORS check:', e);
            return false;
          }
        });

        if (!isAllowed) {
          console.warn(
            `🚫 Blocked WebSocket connection from unauthorized origin: ${origin} (${requestIp})`
          );
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch (error) {
        console.error('Error during CORS check:', error);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const userId = url.searchParams.get('userId');
      // roomId is available here if needed for room-based functionality
      // const roomId = url.searchParams.get('roomId');

      if (!isDevelopment && !token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!isDevelopment && token) {
        const jwtResult = verifyWsToken(token);
        if (!jwtResult.ok) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      // Now perform the upgrade and trigger the same connection flow
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        // Optionally set some initial metadata from query params
        (ws as WebSocketClient).id = userId || (ws as any).id || 'anonymous';
        (ws as WebSocketClient).isAlive = true;
        (ws as WebSocketClient).ip = requestIp;
        (ws as WebSocketClient).userAgent = (req.headers['user-agent'] as string) || 'unknown';
        (ws as WebSocketClient).origin = origin;

        // Emit 'connection' so our single handler runs
        wss.emit('connection', ws, req);
      });
    } catch (error) {
      console.error('Error during WebSocket upgrade:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  console.log('🚀 WebSocket server ready');

  // Room manager and instance ID are available for future use
  void { instanceId, roomManager };
  
  return {
    wss,
    roomManager,
    instanceId,
    close: async () => {
      console.log('🛑 Closing WebSocket server...');
      for (const client of activeConnections) {
        try {
          if (client.readyState === 1) { // 1 = OPEN
            client.close(1001, 'Server shutting down');
          }
        } catch (err) {
          console.warn('Error closing client:', err);
        }
      }
      return new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            console.error('Error closing WebSocket server:', error);
            reject(error);
          } else {
            console.log('✅ WebSocket server closed');
            resolve();
          }
        });
      });
    },
  };
}
