import { RawData, WebSocket as WS } from 'ws';
import { WebSocketClient, RoomDoc } from '../../types/webSocket';
import { startHeartbeat } from './heartbeat';
import { handleMessage } from './messageHandler';
import { safeParse } from '../../utils/safeParse';
import logger from '../../utils/logger';

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

  // message handler delegates to messageHandler.js (keeps logic same)
  ws.on('message', async (data: RawData, isBinary: boolean) => {
    // Use safeParse here to keep behavior consistent (messageHandler expects parsed message)
    const strOrBuffer = isBinary ? data : data.toString();
    const message = safeParse<any>(strOrBuffer as any);

    if (!message) {
      try {
        const { sendToClient } = await import('../../utils/wsHelpers');
        sendToClient(ws, {
          type: 'error',
          from: 'server',
          payload: { message: 'Invalid or too large JSON message' },
        });
      } catch {}
      return;
    }

    try {
      await handleMessage({ message, ws, ctx: { ...ctx } });
    } catch (err) {
      logger.error('message handling error for %s: %o', ws.id, err);
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: 'Server error processing message' },
            from: 'server',
          })
        );
      } catch {}
    }
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
