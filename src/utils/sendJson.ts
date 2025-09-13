import { ErrorEvent } from '../types/types';
import { CustomWebSocket } from '../ws/connectionHandler';
import { logger } from './logger';

type SendResult = {
  success: boolean;
  error?: Error;
};

const ERROR_RESPONSE: ErrorEvent = {
  type: 'error',
  error: 'Failed to process message',
  reason: 'Internal server error',
} as const;

/**
 * Safely sends JSON data over a WebSocket connection
 * @param ws - The WebSocket connection
 * @param payload - The data to send (will be stringified)
 * @returns Object containing success status and optional error
 */
export function sendJson(ws: CustomWebSocket, payload: unknown): SendResult {
  try {
    const message = JSON.stringify(payload);
    ws.send(message);

    logger.debug('Message sent', {
      messageLength: message.length,
      messageType: typeof payload,
    });

    return { success: true };
  } catch (error) {
    const err = error as Error;

    logger.error('Message send failed', {
      error: err.message,
      stack: err.stack,
    });

    // Attempt to notify client of the error
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(ERROR_RESPONSE));
      } catch (sendError) {
        logger.error('Error notification failed', {
          error: (sendError as Error).message,
        });
      }
    }

    return { success: false, error: err };
  }
}
