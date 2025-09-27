import { WebSocket as WsWebSocket } from 'ws';

export interface CustomWebSocket extends WsWebSocket {
  isAlive?: boolean;
  lastActivity?: number;
  roomId?: string;
  userId?: string;
  clientId?: string;
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

function generateRoomId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export async function handleConnection(
  ws: CustomWebSocket,
  req: any,
  roomManager: RoomManagerLike
) {
  // Ensure WebSocket is in OPEN state
  if (ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not in OPEN state:', ws.readyState);
    return;
  }
  const url = new URL('http://x' + (req.url || ''));
  const token = url.searchParams.get('token') || '';
  let roomId = url.searchParams.get('roomId') || '';
  const userId = url.searchParams.get('userId') || '';
  
  // Verify JWT token first
  if (!token) {
    sendJson(ws, { type: 'error', error: 'auth_required', message: 'Authentication token is required' });
    ws.close(1008, 'auth_required');
    return;
  }

  // Verify JWT token
  const jwtResult = verifyWsToken(token);
  if (!jwtResult.ok) {
    sendJson(ws, { 
      type: 'error', 
      error: 'auth_failed', 
      message: 'Invalid or expired token',
      details: jwtResult.error 
    });
    ws.close(1008, 'auth_failed');
    return;
  }

  // If roomId is provided in JWT, it takes precedence over the one in URL
  const jwtRoomId = jwtResult.payload.roomId;
  if (jwtRoomId) {
    roomId = jwtRoomId;
  }

  // If no roomId is provided, generate a new one
  const isNewRoom = !roomId;
  if (isNewRoom) {
    roomId = generateRoomId();
  }

  // Store room and user info on the WebSocket connection
  ws.roomId = roomId;
  ws.userId = userId;
  ws.clientId = `${userId}-${Date.now()}`;
  
  // Send a welcome message to confirm connection is ready
  try {
    await sendJson(ws, {
      type: 'connection_ready',
      clientId: ws.clientId,
      roomId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending welcome message:', error);
    ws.terminate();
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

  // Handle WebSocket close event
  ws.on('close', async () => {
    if (!ws.roomId || !ws.clientId) return;
    
    try {
      // Get the list of participants before removing the current user
      const participants = await roomManager.listParticipants(ws.roomId);
      
      // Remove the user from the room
      await roomManager.removeAllByClientId(ws.clientId);
      
      // Notify other participants that someone left
      if (participants.length > 1) { // Only broadcast if there were other participants
        await roomManager.broadcast(ws.roomId, {
          type: 'participant_left',
          roomId: ws.roomId,
          userId: ws.userId || 'unknown',
          clientId: ws.clientId,
          participantCount: participants.length - 1
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error during WebSocket close:', errorMessage);
    }
  });
}
