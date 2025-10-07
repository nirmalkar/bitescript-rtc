// Simple unique ID generator
// Uses a combination of timestamp and random number for uniqueness
export function generateUniqueId(): string {
  // Get current timestamp in base-36
  const timestamp = Date.now().toString(36);
  
  // Generate a random string
  const randomStr = Math.random().toString(36).substring(2, 10);
  
  // Combine them with a separator
  return `${timestamp}-${randomStr}`;
}

// Alias for backward compatibility
export const nanoid = generateUniqueId;
