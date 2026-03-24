/**
 * Client-side API safety utilities.
 *
 * These are defense-in-depth measures that complement
 * server-side rate-limiting and validation.
 */

const requestTimestamps = new Map<string, number[]>();
const MAX_WINDOW_MS = 60_000; // 1 minute

/**
 * Simple client-side rate-limit check.
 * Returns true if the request should be allowed.
 */
export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(key) ?? [];

  // Remove entries outside the window
  const recent = timestamps.filter((t) => now - t < MAX_WINDOW_MS);

  if (recent.length >= maxPerMinute) {
    return false;
  }

  recent.push(now);
  requestTimestamps.set(key, recent);
  return true;
}

/**
 * Sanitise user input before sending to backend.
 * Strips potential injection patterns while preserving
 * legitimate Unicode text (important for CJK input).
 */
export function sanitizeInput(input: string, maxLength = 5000): string {
  return input
    .slice(0, maxLength)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/**
 * Validate that a URL is safe to navigate to.
 * Blocks javascript:, data:, and other dangerous schemes.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedSchemes = ['https:', 'http:', 'mailto:', 'tel:'];
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}
