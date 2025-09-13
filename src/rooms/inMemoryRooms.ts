import WebSocket from 'ws';
import { Participant, SignalingMessage } from '../types/types';

type Member = { clientId: string; ws?: WebSocket; uid: string; name?: string | null };

export class InMemoryRoomManager {
  private rooms = new Map<string, Map<string, Member>>();

  async addMember(
    roomId: string,
    clientId: string,
    ws: WebSocket | undefined,
    uid: string,
    name?: string | null
  ) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Map());
    this.rooms.get(roomId)!.set(clientId, { clientId, ws, uid, name });
  }

  async removeMember(roomId: string, clientId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.delete(clientId);
    if (room.size === 0) this.rooms.delete(roomId);
  }

  async removeAllByClientId(clientId: string) {
    for (const [roomId, members] of this.rooms.entries()) {
      if (members.has(clientId)) {
        members.delete(clientId);
        if (members.size === 0) this.rooms.delete(roomId);
      }
    }
  }

  async listParticipants(roomId: string): Promise<Participant[]> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.values()).map((m) => ({
      clientId: m.clientId,
      uid: m.uid,
      name: m.name ?? null,
    }));
  }

  async broadcast(roomId: string, message: SignalingMessage, exceptClientId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const [clientId, member] of room.entries()) {
      if (clientId === exceptClientId) continue;
      const ws = member.ws;
      if (ws && ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch {
          console.warn('broadcast send failed');
        }
      }
    }
  }
}
