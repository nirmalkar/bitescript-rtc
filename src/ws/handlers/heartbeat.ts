import { WebSocket } from 'ws';

import logger from '../../utils/logger';

export function startHeartbeat(
  ws: WebSocket & {
    isAlive?: boolean;
    terminate: () => void;
    ping: () => void;
    on: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
  },
  opts: {
    intervalMs: number;
    maxMissed: number;
    onTerminate: () => void;
  }
): () => void {
  let missed = 0;
  const id = setInterval(() => {
    if (!ws.isAlive) {
      missed++;
      if (missed >= opts.maxMissed) {
        clearInterval(id);
        try {
          opts.onTerminate();
        } catch (err) {
          logger.warn('onTerminate threw in heartbeat: %o', err);
        }
        try {
          ws.terminate();
        } catch (err) {
          logger.warn('ws.terminate threw in heartbeat: %o', err);
        }
        return;
      }
    } else {
      missed = 0;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch (err) {
      logger.warn('ws.ping threw in heartbeat: %o', err);
      clearInterval(id);
      try {
        opts.onTerminate();
      } catch (err2) {
        logger.warn('onTerminate threw after ping failure: %o', err2);
      }
      try {
        ws.terminate();
      } catch (err3) {
        logger.warn('ws.terminate threw after ping failure: %o', err3);
      }
    }
  }, opts.intervalMs);

  const onPong = (): void => {
    ws.isAlive = true;
  };

  ws.on('pong', onPong);

  return (): void => {
    try {
      clearInterval(id);
      // some ws implementations expose `off`, others `removeListener` — check both safely
      if (typeof ws.off === 'function') {
        ws.off('pong', onPong);
      } else if (typeof ws.removeListener === 'function') {
        ws.removeListener('pong', onPong);
      }
    } catch (err) {
      logger.warn('Error cleaning up heartbeat: %o', err);
    }
  };
}
