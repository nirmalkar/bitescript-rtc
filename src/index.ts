import './config';

import { createServer } from './server';

// Create and start the server
const { server } = createServer();
const port = Number(process.env.PORT || 4000);

server.listen(port, () => {
  console.log(`🛰️  bitescript-rtc server running on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});
