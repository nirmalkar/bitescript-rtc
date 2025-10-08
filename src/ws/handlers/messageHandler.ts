import { WebSocket as WS } from 'ws';
import { WebSocketClient, RoomDoc } from '../../types/webSocket';
import logger from '../../utils/logger';

type Ctx = {
  wss: any;
  rooms: Map<string, RoomDoc>;
  roomManager: any;
  activeConnections: Set<WebSocketClient>;
  instanceId: string;
  logger: typeof logger;
};

export async function handleMessage(args: {
  message: any;
  ws: WebSocketClient;
  ctx: Ctx;
}): Promise<void> {
  const { message, ws, ctx } = args;
  const { rooms, roomManager, activeConnections } = ctx;

  const type = message.type;
  const payload = message.payload ?? {};
  const to = message.to ?? payload?.to;

  // Lazy import helpers to avoid circular import issues
  // eslint-disable-next-line import/no-unresolved
  const helpers = await import('../../utils/wsHelpers.js');
  const {
    getOrCreateRoom,
    sendToClient,
    broadcastToRoom,
    getPeers,
    broadcastPeersUpdate,
    removeClientFromRoom,
  } = helpers;

  // --- Join ---
  if (type === 'join' || type === 'join-room') {
    const oldRoom = ws.roomId ?? null;
    const newRoom = payload?.roomId ?? payload?.room ?? message.roomId ?? ws.roomId;
    if (!newRoom || typeof newRoom !== 'string') {
      sendToClient(ws, {
        type: 'error',
        from: 'server',
        payload: { message: 'join requires roomId' },
      });
      return;
    }
    ws.roomId = newRoom;
    ws.userId = payload?.userId ?? ws.userId ?? ws.id;

    const room = getOrCreateRoom(rooms, newRoom);
    room.clients.add(ws);

    // add to roomManager for signalling/direct send
    try {
      await roomManager.addMember(newRoom, ws.id, ws, ws.userId ?? ws.id);
    } catch (err) {
      logger.warn('roomManager.addMember failed for %s in %s: %o', ws.id, newRoom, err);
    }

    sendToClient(ws, {
      type: 'joined',
      from: 'server',
      payload: {
        roomId: newRoom,
        roomVersion: room.version,
        peers: Array.from(room.clients).map((c) => c.userId ?? c.id),
      },
      timestamp: Date.now(),
    });

    sendToClient(ws, {
      type: 'doc',
      from: 'server',
      payload: { roomId: newRoom, version: room.version, text: room.text },
      timestamp: Date.now(),
    });

    broadcastPeersUpdate(activeConnections, oldRoom);
    broadcastPeersUpdate(activeConnections, newRoom);
    return;
  }

  // --- get-peers ---
  if (type === 'get-peers') {
    try {
      const roomId = payload?.roomId ?? ws.roomId;
      sendToClient(ws, {
        type: 'peers-updated',
        from: 'server',
        payload: { peers: getPeers(activeConnections, roomId) },
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.warn('Failed to reply with peers list to %s: %o', ws.id, err);
    }
    return;
  }

  // --- get-doc / request-doc ---
  if (type === 'get-doc' || type === 'request-doc') {
    const roomId = payload?.roomId ?? ws.roomId;
    if (!roomId) {
      sendToClient(ws, {
        type: 'doc',
        from: 'server',
        payload: { roomId: null, version: 0, text: '' },
      });
      return;
    }
    const room = getOrCreateRoom(rooms, roomId);
    sendToClient(ws, {
      type: 'doc',
      from: 'server',
      payload: { roomId, version: room.version, text: room.text },
      timestamp: Date.now(),
    });
    return;
  }

  // --- update authoritative doc ---
  if (type === 'update') {
    const roomId = payload?.roomId ?? ws.roomId;
    const text = payload?.text ?? '';
    const baseVersion = payload?.baseVersion ?? null;
    const author = payload?.userId ?? ws.userId ?? ws.id;

    if (!roomId) {
      sendToClient(ws, {
        type: 'update-rejected',
        from: 'server',
        payload: { message: 'no room', currentVersion: null, text: '' },
      });
      return;
    }

    const room = getOrCreateRoom(rooms, roomId);
    if (baseVersion == null || baseVersion === room.version) {
      room.version += 1;
      room.text = String(text);
      broadcastToRoom(rooms, roomId, {
        type: 'doc-updated',
        from: 'server',
        payload: { roomId, version: room.version, text: room.text, author },
        timestamp: Date.now(),
      });
      return;
    } else {
      sendToClient(ws, {
        type: 'update-rejected',
        from: 'server',
        payload: { roomId, currentVersion: room.version, text: room.text },
        timestamp: Date.now(),
      });
      return;
    }
  }

  // --- cursor ---
  if (type === 'cursor') {
    const roomId = payload?.roomId ?? ws.roomId;
    if (!roomId) return;
    const userId = payload?.userId ?? ws.userId ?? ws.id;
    broadcastToRoom(
      rooms,
      roomId,
      {
        type: 'cursor',
        from: userId,
        payload: {
          roomId,
          userId,
          cursor: payload?.cursor ?? null,
          selection: payload?.selection ?? null,
        },
        timestamp: Date.now(),
      },
      ws
    );
    return;
  }

  // --- WebRTC signalling ---
  if (type === 'offer' || type === 'answer' || type === 'ice-candidate' || type === 'ice') {
    const fromId = ws.userId ?? ws.id;
    const toId = to ?? payload?.to;
    const targetRoomId = ws.roomId ?? payload?.roomId ?? null;

    const forward = { type, from: fromId, payload, to: toId, timestamp: Date.now() };

    if (toId) {
      let delivered = false;

      // 1) Try roomManager.sendToClient if available
      if (typeof roomManager.sendToClient === 'function') {
        try {
          delivered = await roomManager.sendToClient(targetRoomId ?? '', toId, forward as any);
        } catch (err) {
          logger.warn('roomManager.sendToClient threw: %o', err);
          delivered = false;
        }
      }

      // 2) Fallback to authoritative room
      if (!delivered && ws.roomId) {
        try {
          const room = rooms.get(ws.roomId);
          if (room) {
            const target = Array.from(room.clients).find((c) => c.userId === toId || c.id === toId);
            if (target && target.readyState === (WS as any).OPEN) {
              sendToClient(target, forward);
              delivered = true;
            }
          }
        } catch (err) {
          logger.warn('Fallback delivery to authoritative room failed: %o', err);
        }
      }

      // 3) Global fallback
      if (!delivered) {
        try {
          const globalTarget = Array.from(activeConnections).find(
            (c) => c.userId === toId || c.id === toId
          );
          if (globalTarget && globalTarget.readyState === (WS as any).OPEN) {
            sendToClient(globalTarget, forward);
            delivered = true;
          }
        } catch (err) {
          logger.warn('Global fallback delivery failed: %o', err);
        }
      }

      // 4) Final: broadcast to room except sender
      if (!delivered && ws.roomId) {
        broadcastToRoom(rooms, ws.roomId, forward, ws);
      }
      return;
    } else {
      // broadcast to room (except sender)
      if (ws.roomId) {
        broadcastToRoom(
          rooms,
          ws.roomId,
          { type, from: fromId, payload, timestamp: Date.now() },
          ws
        );
      }
      return;
    }
  }

  // --- leave ---
  if (type === 'leave') {
    const prevRoom = ws.roomId ?? null;
    removeClientFromRoom(rooms, ws);
    ws.roomId = null;
    try {
      if (prevRoom) await roomManager.removeMember(prevRoom, ws.id);
    } catch (err) {
      logger.warn('roomManager.removeMember failed for %s in %s: %o', ws.id, prevRoom, err);
    }
    sendToClient(ws, { type: 'left', from: 'server', payload: {} });
    broadcastPeersUpdate(activeConnections, prevRoom);
    return;
  }

  // --- fallback generic message broadcasting ---
  {
    for (const client of activeConnections) {
      if (client === ws) continue;
      if (client.readyState !== (WS as any).OPEN) continue;

      if (ws.roomId && client.roomId) {
        if (client.roomId === ws.roomId) {
          try {
            client.send(JSON.stringify(message));
          } catch (err) {
            logger.warn('Failed to send to client %s: %o', client.id, err);
          }
        }
      } else {
        try {
          client.send(JSON.stringify(message));
        } catch (err) {
          logger.warn('Failed to send to client %s: %o', client.id, err);
        }
      }
    }
  }
}
