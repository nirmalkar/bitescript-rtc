import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer as WSS } from 'ws';
import { InMemoryRoomManager } from '../rooms/inMemoryRooms';
import { createUpgradeHandler } from './handlers/upgradeHandler';
import { handleConnection } from './handlers/connection';
import { WebSocketClient, RoomDoc, DEFAULT_ALLOWED_ORIGINS } from '../types/webSocket';
import logger from '../utils/logger';

export function createWsServer(server: http.Server) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;

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
  const rooms = new Map<string, RoomDoc>();

  // Wire upgrade handler (delegates auth & wss.handleUpgrade)
  server.on('upgrade', createUpgradeHandler({ wss, allowedOrigins }));

  // Wire connection event to connection handler, passing shared context
  wss.on('connection', (ws, req) => {
    // do not await; connection handler manages its own async cleanup
    void handleConnection(ws as any, req as any, {
      wss,
      rooms,
      roomManager,
      activeConnections,
      instanceId,
      logger,
    });
  });

  wss.on('error', (err) => {
    logger.error('WebSocketServer error: %o', err);
  });

  return {
    wss,
    roomManager,
    instanceId,
    close: async () => {
      for (const client of Array.from(activeConnections)) {
        try {
          if (client.readyState === WebSocket.OPEN) {
            client.close(1001, 'Server shutting down');
          } else {
            try {
              client.terminate();
            } catch {}
          }
        } catch (err) {
          logger.warn('Error closing client: %o', err);
        } finally {
          activeConnections.delete(client);
        }
      }

      return new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            logger.error('Error closing WebSocket server: %o', error);
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
