/**
 * Safely parses a JSON string or Buffer into an object of type T.
 * @template T - The expected return type after parsing
 * @param {string | Buffer} raw - The input string or Buffer containing JSON data
 * @param {number} [maxSizeBytes=65536] - Maximum allowed size in bytes (default: 64KB)
 * @returns {T | null} The parsed object of type T, or null if parsing fails or size limit is exceeded
 */
export function safeParse<T = any>(raw: string | Buffer, maxSizeBytes = 64 * 1024): T | null {
  try {
    let buffer: Buffer;

    if (typeof raw === 'string') {
      buffer = Buffer.from(raw, 'utf8');
    } else {
      buffer = raw;
    }

    if (buffer.length > maxSizeBytes) return null;

    return JSON.parse(buffer.toString('utf8')) as T;
  } catch {
    return null;
  }
}
