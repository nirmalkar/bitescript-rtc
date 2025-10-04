import { WebSocket } from 'ws';
import logger from '../../utils/logger';

export function startHeartbeat(
  ws: WebSocket & any,
  opts: {
    intervalMs: number;
    maxMissed: number;
    onTerminate: () => void;
  }
) {
  let missed = 0;
  const id = setInterval(() => {
    if (!ws.isAlive) {
      missed++;
      if (missed >= opts.maxMissed) {
        clearInterval(id);
        try {
          opts.onTerminate();
        } catch (e) {
          logger.warn('onTerminate threw in heartbeat: %o', e);
        }
        try {
          ws.terminate();
        } catch {}
        return;
      }
    } else {
      missed = 0;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch (err) {
      clearInterval(id);
      try {
        opts.onTerminate();
      } catch (e) {
        logger.warn('onTerminate threw after ping failure: %o', e);
      }
      try {
        ws.terminate();
      } catch {}
    }
  }, opts.intervalMs);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  return () => {
    try {
      clearInterval(id);
    } catch {}
  };
}
