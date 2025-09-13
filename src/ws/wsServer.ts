import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';
import { InMemoryRoomManager } from '../rooms/inMemoryRooms';
import { CustomWebSocket, handleConnection } from './connectionHandler';

//#TODO: For now we always use in-memory; later we'll swap to redis by checking REDIS_URL
export function createWsServer(server: http.Server) {
  console.log('🚀 Creating WebSocket server...');
  const wss = new WebSocketServer({ noServer: true });
  const instanceId = uuidv4();
  console.log(`🏷️  WebSocket server instance ID: ${instanceId}`);

  const roomManager = new InMemoryRoomManager();

  // Add connection event listeners for debugging
  wss.on('connection', (ws: WebSocket) => {
    console.log('🔗 New WebSocket connection established');

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('👋 WebSocket connection closed');
    });
  });

  server.on('upgrade', (req, socket, head) => {
    // Accept all upgrades for now; we might restrict path in future
    wss.handleUpgrade(req, socket as any, head, (ws: WebSocket) => {
      // Cast the WebSocket to our CustomWebSocket type
      handleConnection(ws as unknown as CustomWebSocket, req, roomManager).catch((err) => {
        console.error('handleConnection error', err);
        try {
          ws.close(1011, 'server_error');
        } catch (e) {
          console.error('Error closing WebSocket:', e);
        }
      });
    });
  });

  return { wss, roomManager, instanceId };
}
