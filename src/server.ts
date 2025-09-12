import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
app.get('/health', (_req: express.Request, res: express.Response) =>
  res.json({ ok: true, msg: 'bitescript-rtc is up' })
);

// This server we need to upgrade to a WebSocket server
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (message: string) => {
    console.log('Received message:', message);
    ws.send(JSON.stringify({ type: 'echo', data: message.toString() }));
  });
  ws.on('close', () => {
    console.log('client disconnected!');
  });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`bitescript-rtc is running on port ${port}`);
});
