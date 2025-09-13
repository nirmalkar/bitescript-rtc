import { WebSocket as WsWebSocket } from 'ws';

export interface CustomWebSocket extends WsWebSocket {
  [key: string]: any;
}

import { verifyWsToken } from '../auth/jwt';
import { SignalingMessage } from '../types/types';
import { safeParse } from '../utils/safeParse';
import { sendJson } from '../utils/sendJson';
import { signalingSchema, type SignalingParsed } from '../validators/signalingSchemas';

type RoomManagerLike = {
  addMember: (
    roomId: string,
    clientId: string,
    ws: CustomWebSocket | undefined,
    uid: string,
    name?: string | null
  ) => Promise<void>;
  removeMember: (roomId: string, clientId: string) => Promise<void>;
  removeAllByClientId: (clientId: string) => Promise<void>;
  listParticipants: (roomId: string) => Promise<any[]>;
  broadcast: (roomId: string, message: SignalingMessage, exceptClientId?: string) => Promise<void>;
};

export async function handleConnection(
  ws: CustomWebSocket,
  req: any,
  roomManager: RoomManagerLike
) {
  const params = new URL('http://x' + (req.url || '')).searchParams;
  const token = params.get('token');

  if (!token) {
    sendJson(ws, { type: 'error', error: 'auth_required' });
    ws.close(1008, 'auth required');
    return;
  }

  // Verify JWT token
  const jwtResult = verifyWsToken(token);
  
  if (!jwtResult.ok) {
    sendJson(ws, {
      type: 'error',
      error: 'invalid_token',
      reason: jwtResult.error || 'Invalid token'
    });
    ws.close(1008, 'invalid token');
    return;
  }

  const user = {
    uid: jwtResult.payload.sub || jwtResult.payload.uid || jwtResult.payload.email || 'jwt-user',
    ...jwtResult.payload,
  };

  const uid = user.uid || user.sub || 'unknown';
  const name = user.name || user.email || null;
  const clientId = `${uid}-${Math.random().toString(36).slice(2, 8)}`;

  (ws as any).clientId = clientId;
  (ws as any).uid = uid;


  // Acknowledge connection
  sendJson(ws, { type: 'connected', clientId, uid, name });

  // on message
  ws.on('message', async (raw: string | Buffer | ArrayBuffer | Buffer[]) => {
    // Convert the raw data to a string if it's a Buffer or ArrayBuffer
    const messageString = typeof raw === 'string' ? raw : Buffer.from(raw as any).toString('utf-8');
    const parsed = safeParse(messageString);
    if (!parsed) {
      sendJson(ws, { type: 'error', error: 'invalid_json' });
      return;
    }

    const check = signalingSchema.safeParse(parsed);
    if (!check.success) {
      sendJson(ws, {
        type: 'error',
        error: 'invalid_message',
        reason: JSON.stringify(check.error.format()),
      });
      return;
    }
    const msg = check.data as SignalingParsed;

    try {
      switch (msg.type) {
        case 'join':
          await roomManager.addMember(msg.roomId, clientId, ws, uid, name);
          {
            const participants = await roomManager.listParticipants(msg.roomId);
            await roomManager.broadcast(msg.roomId, {
              type: 'joined',
              roomId: msg.roomId,
              participants,
            });
          }
          break;

        case 'leave':
          await roomManager.removeMember(msg.roomId, clientId);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          const forward = { ...(msg as any), from: uid } as SignalingMessage;
          await roomManager.broadcast(msg.roomId, forward, clientId);
          break;

        default:
          sendJson(ws, { type: 'error', error: 'unknown_type' });
      }
    } catch (err) {
      console.error('message handling error', err);
      sendJson(ws, { type: 'error', error: 'server_error' });
    }
  });

  ws.on('close', () => {
    roomManager.removeAllByClientId(clientId).catch((e) => console.error('cleanup error', e));
  });
}
