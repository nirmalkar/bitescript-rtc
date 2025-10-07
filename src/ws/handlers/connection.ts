import { RawData, WebSocket as WS } from 'ws';
import { WebSocketClient, RoomDoc } from '../../types/webSocket';
import { startHeartbeat } from './heartbeat';
import { handleMessage } from './messageHandler';
import { safeParse } from '../../utils/safeParse';
import logger from '../../utils/logger';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// Message rate limiting configuration
const messageRateLimiter = new RateLimiterMemory({
  points: 100, // 100 messages
  duration: 10, // per 10 seconds per client
  blockDuration: 60, // block for 1 minute if limit is exceeded
});

// Track message rates per client
const clientMessageRates = new Map<string, number>();

type Ctx = {
  wss: any;
  rooms: Map<string, RoomDoc>;
  roomManager: any;
  activeConnections: Set<WebSocketClient>;
  instanceId: string;
  logger: typeof logger;
};

export async function handleConnection(wsRaw: WS, req: any, ctx: Ctx) {
  const { rooms, roomManager, activeConnections } = ctx;
  const ws = wsRaw as WebSocketClient;

  // Initialize socket metadata — keep same as original
  ws.id = ws.id || Math.random().toString(36).slice(2, 10); // fallback if not set earlier
  ws.isAlive = true;
  ws.ip = ws.ip || req.socket?.remoteAddress || 'unknown';
  ws.userAgent =
    ws.userAgent || (req.headers && (req.headers['user-agent'] as string)) || 'unknown';
  ws.origin = ws.origin || (req.headers && (req.headers.origin as string)) || 'unknown';
  ws.roomId =
    ws.roomId ??
    (req.url ? new URL(req.url, `http://${req.headers.host}`).searchParams.get('roomId') : null);

  activeConnections.add(ws);

  // heartbeat
  const stopHeartbeat = startHeartbeat(ws as any, {
    intervalMs: 30_000,
    maxMissed: 3,
    onTerminate() {
      activeConnections.delete(ws);
      try {
        removeClientFromAuthoritativeRoom();
      } catch {}
      void (async () => {
        try {
          await roomManager.removeAllByClientId(ws.id);
        } catch (e) {
          logger.warn('removeAllByClientId failed: %o', e);
        }
      })();
    },
  });

  // helper to remove from authoritative rooms (used in cleanup)
  function removeClientFromAuthoritativeRoom() {
    try {
      const prevRoom = ws.roomId ?? null;
      if (!prevRoom) return;
      const room = rooms.get(prevRoom);
      if (!room) return;
      room.clients.delete(ws);
      // delete room when empty, same as before
      if (room.clients.size === 0) rooms.delete(prevRoom);
    } catch (e) {
      // ignore
    }
  }

  // cleanup routine
  const cleanup = async () => {
    try {
      stopHeartbeat();
    } catch {}
    const prevRoom = ws.roomId ?? null;
    activeConnections.delete(ws);
    // notify peers
    try {
      // broadcastPeersUpdate imported inside handler to avoid circular import
      const { broadcastPeersUpdate } = await import('../../utils/wsHelpers');
      broadcastPeersUpdate(activeConnections, prevRoom);
    } catch (e) {
      logger.warn('broadcastPeersUpdate failed in cleanup: %o', e);
    }
    removeClientFromAuthoritativeRoom();
    try {
      await roomManager.removeAllByClientId(ws.id);
    } catch (err) {
      logger.warn('roomManager.removeAllByClientId failed for %s: %o', ws.id, err);
    }
  };

  ws.on('close', () => {
    void cleanup();
  });

  ws.on('error', (err) => {
    logger.warn('WebSocket client error %s: %o', ws.id, err);
    void cleanup();
  });

  // Message handler with rate limiting and error handling
  ws.on('message', async (data: RawData, isBinary: boolean) => {
    try {
      // Parse the incoming message
      const strOrBuffer = isBinary ? data : data.toString();
      const message = safeParse<any>(strOrBuffer as any);

      if (!message) {
        throw new Error('Invalid message format');
      }

      // Apply rate limiting
      try {
        await messageRateLimiter.consume(ws.id);
      } catch (rateLimiterRes) {
        logger.warn('Rate limit exceeded for client %s', ws.id);
        ws.send(JSON.stringify({
          type: 'error',
          from: 'server',
          error: 'Rate limit exceeded. Please try again later.'
        }));
        return;
      }

      // Track message rate for analytics
      const messageCount = (clientMessageRates.get(ws.id) || 0) + 1;
      clientMessageRates.set(ws.id, messageCount);

      // Process the message
      await handleMessage({ ws, message, ctx });
    } catch (error) {
      logger.error('Error handling message: %o', error);
      try {
        const { sendToClient } = await import('../../utils/wsHelpers');
        sendToClient(ws, {
          type: 'error',
          from: 'server',
          payload: { message: 'Error processing message' },
        });
      } catch (e) {
        logger.warn('Failed to send error to client: %o', e);
      }
    }
  });

  // Clean up rate limiting on disconnect
  ws.on('close', () => {
    clientMessageRates.delete(ws.id);
  });

  // send initial connected message + peers
  try {
    if (ws.readyState === (WS as any).OPEN) {
      const { getPeers } = await import('../../utils/wsHelpers');
      ws.send(
        JSON.stringify({
          type: 'connected',
          from: 'server',
          payload: {
            message: 'Connected',
            id: ws.id,
            peers: getPeers(activeConnections, ws.roomId ?? null),
          },
          timestamp: Date.now(),
        })
      );
    }
  } catch (err) {
    logger.debug('Failed to send connected payload to %s: %o', ws.id, err);
  }

  // broadcast peers update
  try {
    const { broadcastPeersUpdate } = await import('../../utils/wsHelpers');
    broadcastPeersUpdate(activeConnections, ws.roomId ?? null);
  } catch (e) {
    logger.warn('broadcastPeersUpdate failed after connect: %o', e);
  }
}
