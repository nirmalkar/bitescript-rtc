import { Server as HttpServer, IncomingMessage } from 'http';
import { Socket } from 'net';

import WebSocket from 'ws';

import { InMemoryRoomManager } from '../rooms/inMemoryRooms';
import {
  DEFAULT_ALLOWED_ORIGINS,
  RoomDoc as SharedRoomDoc,
  WebSocketClient as SharedWebSocketClient,
} from '../types/webSocket';
import logger from '../utils/logger';

import { handleConnection } from './handlers/connection';
import { createUpgradeHandler } from './handlers/upgradeHandler';

import { generateUniqueId } from '../utils/uniqueId';

interface WebSocketClient extends SharedWebSocketClient, WebSocket {}

const WSS = WebSocket.Server;

const asSocket = (socket: unknown): Socket => {
  return socket as InstanceType<typeof Socket>;
};

const asWebSocketClient = (ws: WebSocket): WebSocketClient => {
  const client = ws as WebSocketClient;
  if (!client.id) {
    client.id = generateUniqueId();
    client.isAlive = true;
  }
  return client;
};

export interface WsServer {
  close: () => Promise<void>;
}

export function createWsServer(server: HttpServer): WsServer {
  // Initialize allowed origins from environment or use defaults
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o: string) => (o || '').trim())
    .filter(Boolean);

  // Use allowedOrigins if not empty, otherwise use DEFAULT_ALLOWED_ORIGINS
  const originsToUse = allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

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

  const roomManager = new InMemoryRoomManager();
  const activeConnections = new Set<WebSocketClient>();
  const rooms = new Map<string, SharedRoomDoc>();

  const instanceId = generateUniqueId();

  // Wire upgrade handler (delegates auth & wss.handleUpgrade)
  server.on('upgrade', (request, socket, head) => {
    try {
      const upgradeHandler = createUpgradeHandler({ wss, allowedOrigins: originsToUse });
      // The upgrade handler is responsible for handling the upgrade request
      // and calling wss.handleUpgrade() when appropriate
      upgradeHandler(request, asSocket(socket), head);
    } catch (error) {
      logger.error('Unexpected error in upgrade handler: %o', error);
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
  });

  // Handle new connections
  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const client = asWebSocketClient(ws);
    void handleConnection(client, request, {
      wss,
      rooms,
      roomManager,
      activeConnections,
      instanceId,
      logger,
    });
  });

  wss.on('error', (err: Error) => {
    logger.error('WebSocketServer error: %o', err);
  });

  const closeServer = async (): Promise<void> => {
    logger.info('Closing WebSocket server...');

    // Add a small delay to allow pending operations to complete
    await new Promise((_resolve) => {
      setTimeout(_resolve, 100);
    });

    // Close all active connections
    const closePromises = Array.from(activeConnections).map(async (client): Promise<void> => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          await new Promise<void>((_resolve) => {
            client.once('close', _resolve);
            client.close(1001, 'Server shutting down');
          });
        } else {
          client.terminate();
        }
      } catch (error) {
        logger.warn('Error closing client connection: %o', error);
      } finally {
        activeConnections.delete(client);
      }
    });

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_resolve) => {
        setTimeout(_resolve, 5000, 'timeout');
      });

      // Wait for all connections to close or timeout after 5 seconds
      await Promise.race([Promise.all(closePromises), timeoutPromise]);

      // Close the WebSocket server
      await new Promise<void>((_resolve, _reject) => {
        wss.close((error?: Error) => {
          if (error) {
            logger.error('Error closing WebSocket server: %o', error);
            _reject(error);
          } else {
            logger.info('WebSocket server closed successfully');
            _resolve();
          }
        });
      });
    } catch (error) {
      logger.error('Error during WebSocket server shutdown: %o', error);
      throw error;
    }
  };

  return {
    close: closeServer,
  };
}
