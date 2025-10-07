import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any; // Replace 'any' with your actual user type if available
    }
  }
}

// This allows TypeScript to understand the types for Express middleware
declare module 'express-serve-static-core' {
  interface Request {
    user?: any; // Replace 'any' with your actual user type if available
  }
}
