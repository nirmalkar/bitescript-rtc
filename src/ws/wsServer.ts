// src/ws/createWsServer.ts
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket as WS, WebSocketServer as WSS, type RawData } from 'ws';
import { verifyWsToken } from '../auth/jwt';
import { InMemoryRoomManager } from '../rooms/inMemoryRooms';

interface CursorPayload {
  type: string;
  [key: string]: any;
}

interface PeerInfo {
  id: string;
  userAgent?: string;
  ip?: string;
  origin?: string;
  roomId?: string | null;
}

interface WebSocketClient extends WS {
  id: string;
  userId?: string;
  isAlive: boolean;
  ip?: string;
  userAgent?: string;
  origin?: string;
  roomId?: string | null;
}

/** Authoritative room document */
interface RoomDoc {
  version: number;
  text: string;
  clients: Set<WebSocketClient>;
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://your-production-domain.com',
];

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
  const HEARTBEAT_INTERVAL = 30_000; // 30s
  const MAX_MISSED_PINGS = 3;

  // In-memory authoritative documents per room
  const rooms = new Map<string, RoomDoc>();

  function getOrCreateRoom(roomId: string): RoomDoc {
    let r = rooms.get(roomId);
    if (!r) {
      r = { version: 0, text: '', clients: new Set() };
      rooms.set(roomId, r);
    }
    return r;
  }

  // Helper: compute peers (optionally room-scoped)
  function getPeers(roomId?: string | null): PeerInfo[] {
    const peers: PeerInfo[] = [];
    for (const client of activeConnections) {
      if (client.readyState !== WS.OPEN) continue;
      if (roomId) {
        if (client.roomId !== roomId) continue;
      }
      peers.push({
        id: client.userId ?? client.id,
        userAgent: client.userAgent,
        ip: client.ip,
        origin: client.origin,
        roomId: client.roomId ?? null,
      });
    }
    return peers;
  }

  function broadcastPeersUpdate(roomId?: string | null) {
    const peers = getPeers(roomId); // returns array of { id, ... } for that room
    const total = peers.length;

    for (const client of activeConnections) {
      if (client.readyState !== WS.OPEN) continue;
      if (roomId && client.roomId !== roomId) continue;

      // count of OTHER peers for this recipient (exclude recipient.id)
      const countExcludingMe = peers.filter((p) => p.id !== (client.userId ?? client.id)).length;

      const payload = {
        peers, // full list (includes recipient too)
        count: countExcludingMe, // number of others the recipient should show
        total, // total participants in that room
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
        console.warn('Failed to send peers-updated to', client.id, err);
      }
    }
  }

  function sendToClient(client: WebSocketClient, msg: any) {
    if (client.readyState !== WS.OPEN) return;
    try {
      client.send(JSON.stringify(msg));
    } catch (e) {
      // swallow send error
    }
  }

  function broadcastToRoom(roomId: string, msg: any, except?: WebSocketClient) {
    const room = rooms.get(roomId);
    if (!room) return;
    const s = JSON.stringify(msg);
    for (const c of room.clients) {
      if (c !== except && c.readyState === WS.OPEN) {
        try {
          c.send(s);
        } catch (e) {
          // ignore per-client send error
        }
      }
    }
  }

  function removeClientFromRoom(client: WebSocketClient) {
    const roomId = client.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.clients.delete(client);

    // broadcast presence change
    broadcastPeersUpdate(roomId);

    // optionally delete room when empty; keep doc if you want persistence
    if (room.clients.size === 0) {
      // Keep removal optional; for now we remove to free memory
      rooms.delete(roomId);
    }
  }

  function handleNewConnection(wsRaw: WS, req: http.IncomingMessage) {
    const ws = wsRaw as WebSocketClient;
    ws.id = uuidv4();
    ws.isAlive = true;
    ws.ip = req.socket?.remoteAddress || 'unknown';
    ws.userAgent = (req.headers['user-agent'] as string) || 'unknown';
    ws.origin = (req.headers.origin as string) || 'unknown';
    ws.roomId =
      (req.url && new URL(req.url, `http://${req.headers.host}`).searchParams.get('roomId')) ||
      null;

    // If the HTTP upgrade included a userId query param, use it as initial userId
    try {
      const url = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;
      const userIdQuery = url?.searchParams.get('userId');
      if (userIdQuery) ws.userId = userIdQuery;
    } catch {
      // ignore parse errors
    }

    activeConnections.add(ws);


    // Heartbeat bookkeeping
    let missedPings = 0;
    const heartbeatInterval = setInterval(() => {
      if (!ws.isAlive) {
        missedPings++;
        if (missedPings >= MAX_MISSED_PINGS) {
          clearInterval(heartbeatInterval);
              activeConnections.delete(ws);
          // ensure room membership removed and peers notified
          removeClientFromRoom(ws);
          return ws.terminate();
        }
      } else {
        missedPings = 0;
      }

      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        clearInterval(heartbeatInterval);
        activeConnections.delete(ws);
        removeClientFromRoom(ws);
        try {
          ws.terminate();
        } catch {}
      }
    }, HEARTBEAT_INTERVAL);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const cleanup = () => {
      try {
        clearInterval(heartbeatInterval);
      } catch {}
      const prevRoom = ws.roomId ?? null;
      const prevUserId = ws.userId ?? ws.id;
      activeConnections.delete(ws);
      // notify remaining peers in the same room that peer list changed
      broadcastPeersUpdate(prevRoom);
      // remove from authoritative room if present
      removeClientFromRoom(ws);
    };

    ws.on('close', (_code, _reason) => {
      cleanup();
    });

    ws.on('error', (err) => {
      console.warn('WebSocket client error', ws.id, err);
      cleanup();
    });

    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        const str = isBinary ? data : data.toString();
        const message = JSON.parse(str as string) as CursorPayload;
        const type = message.type;
        const payload = message.payload ?? {};
        const to = message.to ?? payload?.to;

        // If client explicitly joins a room after connection (accept both types)
        if (type === 'join-room' || type === 'join') {
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

          // add to authoritative room
          const room = getOrCreateRoom(newRoom);
          room.clients.add(ws);


          // send acknowledgement + doc
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

          // notify others in both old and new rooms
          broadcastPeersUpdate(oldRoom);
          broadcastPeersUpdate(newRoom);
          return;
        }

        // get-peers request
        if (type === 'get-peers') {
          try {
            const roomId = payload?.roomId ?? ws.roomId;
            sendToClient(ws, {
              type: 'peers-updated',
              from: 'server',
              payload: { peers: getPeers(roomId) },
              timestamp: Date.now(),
            });
          } catch (err) {
            console.warn('Failed to reply with peers list to', ws.id, err);
          }
          return;
        }

        // get-doc request
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
          const room = getOrCreateRoom(roomId);
          sendToClient(ws, {
            type: 'doc',
            from: 'server',
            payload: { roomId, version: room.version, text: room.text },
            timestamp: Date.now(),
          });
          return;
        }

        // update (authoritative doc update)
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

          const room = getOrCreateRoom(roomId);

          // If baseVersion is null, accept as force; else require equality
          if (baseVersion == null || baseVersion === room.version) {
            room.version += 1;
            room.text = String(text);
            // broadcast doc-updated to everyone in room
            broadcastToRoom(roomId, {
              type: 'doc-updated',
              from: 'server',
              payload: { roomId, version: room.version, text: room.text, author },
              timestamp: Date.now(),
            });
            return;
          } else {
            // conflict: reply with authoritative doc
            sendToClient(ws, {
              type: 'update-rejected',
              from: 'server',
              payload: { roomId, currentVersion: room.version, text: room.text },
              timestamp: Date.now(),
            });
            return;
          }
        }

        // cursor broadcast (no persistence)
        if (type === 'cursor') {
          const roomId = payload?.roomId ?? ws.roomId;
          if (!roomId) return;
          const userId = payload?.userId ?? ws.userId ?? ws.id;
          const cursor = payload?.cursor ?? null;
          const selection = payload?.selection ?? null;
          broadcastToRoom(
            roomId,
            {
              type: 'cursor',
              from: userId,
              payload: { roomId, userId, cursor, selection },
              timestamp: Date.now(),
            },
            ws
          );
          return;
        }

        // WebRTC signaling messages (offer/answer/ice-candidate/ice)
        if (type === 'offer' || type === 'answer' || type === 'ice-candidate' || type === 'ice') {
          const fromId = ws.userId ?? ws.id;
          // If 'to' specified, try deliver directly to that user in the same room first
          const toId = to ?? payload?.to;
          if (toId) {
            // find the target in same room or globally
            let target: WebSocketClient | undefined;
            if (ws.roomId) {
              const room = rooms.get(ws.roomId);
              if (room) {
                target = Array.from(room.clients).find((c) => c.userId === toId || c.id === toId);
              }
            }
            if (!target) {
              // fallback: search global active connections
              target = Array.from(activeConnections).find(
                (c) => c.userId === toId || c.id === toId
              );
            }
            if (target && target.readyState === WS.OPEN) {
              sendToClient(target, {
                type,
                from: fromId,
                payload,
                to: toId,
                timestamp: Date.now(),
              });
            } else {
              // if not found, optionally broadcast to room (except sender)
              if (ws.roomId) {
                broadcastToRoom(
                  ws.roomId,
                  { type, from: fromId, payload, timestamp: Date.now() },
                  ws
                );
              }
            }
            return;
          } else {
            // broadcast to room (except sender)
            if (ws.roomId) {
              broadcastToRoom(
                ws.roomId,
                { type, from: fromId, payload, timestamp: Date.now() },
                ws
              );
            }
            return;
          }
        }

        // leave
        if (type === 'leave') {
          const prevRoom = ws.roomId ?? null;
          removeClientFromRoom(ws);
          ws.roomId = null;
          sendToClient(ws, { type: 'left', from: 'server', payload: {} });
          broadcastPeersUpdate(prevRoom);
          return;
        }

        // Fallback: treat as generic message — broadcast to same room, otherwise global
        {
          for (const client of activeConnections) {
            if (client === ws) continue;
            if (client.readyState !== WS.OPEN) continue;

            if (ws.roomId && client.roomId) {
              if (client.roomId === ws.roomId) {
                try {
                  client.send(JSON.stringify(message));
                } catch (err) {
                  console.warn('Failed to send to client', client.id, err);
                }
              }
            } else {
              try {
                client.send(JSON.stringify(message));
              } catch (err) {
                console.warn('Failed to send to client', client.id, err);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error processing incoming WS message:', err);
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

    // Send initial connected message + peers list
    try {
      if (ws.readyState === WS.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'connected',
            from: 'server',
            payload: { message: 'Connected', id: ws.id, peers: getPeers(ws.roomId ?? null) },
            timestamp: Date.now(),
          })
        );
      }
    } catch (err) {
      // client may have closed already
    }

    // After initial connect, broadcast to others that peers changed
    broadcastPeersUpdate(ws.roomId ?? null);
  }

  wss.on('connection', (ws, req) => {
    handleNewConnection(ws, req);
  });

  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  // Manual upgrade handling (auth / origin checks here)
  server.on('upgrade', (req, socket, head) => {
    (async () => {
      const origin = (req.headers.origin as string) || '';
      const requestIp = req.socket.remoteAddress || 'unknown';
      const isDevelopment = process.env.NODE_ENV !== 'production';

      // CORS / origin check (skip strict check in development)
      if (!isDevelopment && allowedOrigins[0] !== '*') {
        try {
          const isAllowed = allowedOrigins.some((allowedOrigin) => {
            if (allowedOrigin === '*') return true;
            if (!origin) return false;
            try {
              const originHostname = new URL(origin).hostname;
              const allowedHostname = new URL(allowedOrigin).hostname;
              return (
                originHostname === allowedHostname || originHostname.endsWith(`.${allowedHostname}`)
              );
            } catch (e) {
              console.warn('Error parsing URL during CORS check:', e);
              return false;
            }
          });

          if (!isAllowed) {
            console.warn(
              `🚫 Blocked WebSocket connection from unauthorized origin: ${origin} (${requestIp})`
            );
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch (error) {
          console.error('Error during CORS check:', error);
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      try {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const userId = url.searchParams.get('userId');
        const roomId = url.searchParams.get('roomId');

        if (!isDevelopment && !token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        if (!isDevelopment && token) {
          const jwtResult = await verifyWsToken(token);
          if (!jwtResult || !('ok' in jwtResult) || !jwtResult.ok) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
        }

        wss.handleUpgrade(req, socket as any, head, (ws) => {
          const client = ws as WebSocketClient;
          client.id = userId || client.id || uuidv4();
          client.userId = userId ?? undefined;
          client.isAlive = true;
          client.ip = requestIp;
          client.userAgent = (req.headers['user-agent'] as string) || 'unknown';
          client.origin = origin;
          client.roomId = roomId || null;

          // Do not auto-add to room here; wait for explicit 'join' message
          wss.emit('connection', ws, req);
        });
      } catch (error) {
        console.error('Error during WebSocket upgrade:', error);
        try {
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        } catch {}
        socket.destroy();
      }
    })().catch((err) => {
      console.error('Unexpected error in upgrade handler:', err);
      try {
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      } catch {}
      socket.destroy();
    });
  });

  void { instanceId, roomManager };

  return {
    wss,
    roomManager,
    instanceId,
    close: async () => {
      for (const client of Array.from(activeConnections)) {
        try {
          if (client.readyState === WS.OPEN) {
            client.close(1001, 'Server shutting down');
          } else {
            try {
              client.terminate();
            } catch {}
          }
        } catch (err) {
          console.warn('Error closing client:', err);
        } finally {
          activeConnections.delete(client);
        }
      }

      return new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) {
            console.error('Error closing WebSocket server:', error);
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
