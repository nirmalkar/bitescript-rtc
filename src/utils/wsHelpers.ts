import { WebSocket as WS } from 'ws';

import logger from './logger';
import { PeerInfo, WebSocketClient, RoomDoc } from '../types/webSocket'; // adjust path if needed

export function getOrCreateRoom(rooms: Map<string, RoomDoc>, roomId: string): RoomDoc {
  let r = rooms.get(roomId);
  if (!r) {
    r = { version: 0, text: '', clients: new Set() };
    rooms.set(roomId, r);
  }
  return r;
}

export function getPeers(
  activeConnections: Set<WebSocketClient>,
  roomId?: string | null
): PeerInfo[] {
  const peerMap = new Map<string, PeerInfo>();

  for (const client of activeConnections) {
    if (client.readyState !== WS.OPEN) continue;
    if (roomId && client.roomId !== roomId) continue;

    const peerId = client.userId ?? client.id;

    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, {
        id: peerId,
        userAgent: client.userAgent,
        ip: client.ip,
        origin: client.origin,
        roomId: client.roomId ?? null,
      });
    }
  }

  return Array.from(peerMap.values());
}

export function broadcastPeersUpdate(
  activeConnections: Set<WebSocketClient>,
  roomId?: string | null
): void {
  const peers = getPeers(activeConnections, roomId);
  const total = peers.length;

  for (const client of activeConnections) {
    if (client.readyState !== WS.OPEN) continue;
    if (roomId && client.roomId !== roomId) continue;

    const countExcludingMe = peers.filter((p) => p.id !== (client.userId ?? client.id)).length;

    const payload = {
      peers,
      count: countExcludingMe,
      total,
    };

    try {
      client.send(
        JSON.stringify({
          type: 'peers-updated',
          from: 'server',
          payload,
          timestamp: Date.now(),
        })
      );
    } catch (err) {
      logger.warn('Failed to send peers-updated to %s: %o', client.id, err);
    }
  }
}

export function sendToClient(client: WebSocketClient, msg: unknown): void {
  if (client.readyState !== WS.OPEN) return;
  try {
    const s = JSON.stringify(msg);
    client.send(s);
  } catch (err) {
    logger.warn('sendToClient failed for %s: %o', client.id, err);
    // swallow send error but log for visibility
  }
}

export function broadcastToRoom(
  rooms: Map<string, RoomDoc>,
  roomId: string,
  msg: unknown,
  except?: WebSocketClient
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  let s: string;
  try {
    s = JSON.stringify(msg);
  } catch (err) {
    logger.warn('broadcastToRoom: failed to stringify message for room %s: %o', roomId, err);
    return;
  }

  for (const c of room.clients) {
    if (c !== except && c.readyState === WS.OPEN) {
      try {
        c.send(s);
      } catch (err) {
        logger.warn('broadcastToRoom: failed to send to %s in room %s: %o', c.id, roomId, err);
        // ignore per-client send error but log it
      }
    }
  }
}

export function removeClientFromRoom(rooms: Map<string, RoomDoc>, client: WebSocketClient): void {
  const roomId = client.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(client);

  // broadcast presence change will be called by caller using broadcastPeersUpdate
  if (room.clients.size === 0) {
    rooms.delete(roomId);
  }
}
