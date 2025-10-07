// This file extends the Express types
declare namespace Express {
  export interface Request {
    user?: any; // Replace 'any' with your actual user type if available
  }
  
  export interface Response {
    // Add any custom response extensions here
  }
  
  export interface NextFunction {
    // Next function type
  }
}

// This makes the types available globally
export {};
