import WebSocket from 'ws';

import { Participant, SignalingMessage } from '../types/types';

type Member = { clientId: string; ws?: WebSocket; uid: string; name?: string | null };

/**
 * In-memory room manager.
 *
 * Methods return Promise<...> to satisfy an async RoomManagerLike interface,
 * but operations are synchronous in-memory. We return Promise.resolve(...) so
 * runtime behavior is unchanged while matching the expected types.
 */
export class InMemoryRoomManager {
  private rooms = new Map<string, Map<string, Member>>();

  addMember(
    roomId: string,
    clientId: string,
    ws: WebSocket | undefined,
    uid: string,
    name?: string | null
  ): Promise<void> {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Map());
    this.rooms.get(roomId)!.set(clientId, { clientId, ws, uid, name });
    return Promise.resolve();
  }

  removeMember(roomId: string, clientId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve();
    room.delete(clientId);
    if (room.size === 0) this.rooms.delete(roomId);
    return Promise.resolve();
  }

  removeAllByClientId(clientId: string): Promise<void> {
    for (const [roomId, members] of this.rooms.entries()) {
      if (members.has(clientId)) {
        members.delete(clientId);
        if (members.size === 0) this.rooms.delete(roomId);
      }
    }
    return Promise.resolve();
  }

  listParticipants(roomId: string): Promise<Participant[]> {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve([]);
    const participants: Participant[] = Array.from(room.values()).map((m) => ({
      clientId: m.clientId,
      uid: m.uid,
      name: m.name ?? null,
    }));
    return Promise.resolve(participants);
  }

  broadcast(roomId: string, message: SignalingMessage, exceptClientId?: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return Promise.resolve();
    for (const [clientId, member] of room.entries()) {
      if (clientId === exceptClientId) continue;
      const ws = member.ws;
      if (ws && ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          // keep same behavior: swallow per-client failures but continue
        }
      }
    }
    return Promise.resolve();
  }
}
