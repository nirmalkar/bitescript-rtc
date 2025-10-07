import 'express';

declare global {
  namespace Express {
    export interface Request {
      user?: Record<string, unknown>;
    }

    export interface Response {
      // Add any custom response extensions here
    }

    export interface NextFunction {
      // Next function type (kept for completeness)
    }
  }
}

// This makes the types available globally
export {};
