/**
 * Normalize join code by removing whitespace, dashes, and converting to uppercase.
 * Also strips confusing characters (I/1/O/0) for better UX.
 */
export function normalizeJoinCode(x: string): string {
  return x
    .replace(/[\s\-]/g, "")
    .replace(/[IO01]/gi, (char) => {
      const replacements: Record<string, string> = { 'I': '', 'O': '', '0': '', '1': '' };
      return replacements[char.toUpperCase()] ?? char;
    })
    .toUpperCase()
    .slice(0, 8);
}

/**
 * Format join code for display (XXXX-XXXX format).
 */
export function formatJoinCode(code: string): string {
  const normalized = normalizeJoinCode(code);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/**
 * Validate join code format.
 */
export function isValidJoinCode(code: string): boolean {
  const normalized = normalizeJoinCode(code);
  return normalized.length === 8 && /^[A-Z2-9]+$/.test(normalized);
}

const ALPHANUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars (I/1/O/0)

export function generateJoinCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
  }
  return out;
}
