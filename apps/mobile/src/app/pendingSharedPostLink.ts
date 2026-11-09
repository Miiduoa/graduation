import { rewriteLegacyShopsPath, socialPostHttpsPrefixes } from './legacyShopsPath';

/** A signed-out HTTPS share is an intent, not permission to read a post.
 * In-memory only: no content, profile, credentials, persistent storage or cursor.
 * The authenticated PostDetail flow must still check campus and server access.
 */
const RETENTION_MS = 10 * 60 * 1000;
let pending: { url: string; capturedAt: number } | null = null;

export function stagePendingSharedPostLink(
  incoming: string,
  releaseHost: unknown,
  now = Date.now(),
): boolean {
  const [origin] = socialPostHttpsPrefixes(releaseHost);
  if (!origin || typeof incoming !== 'string' || !Number.isFinite(now)) return false;
  let parsed: URL;
  try {
    parsed = new URL(incoming);
  } catch {
    return false;
  }
  // Never accept redirects, unverified origins or an ambiguous URL fragment.
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) return false;
  if (!parsed.pathname.startsWith('/community/post/')) return false;

  // Reuse the same postId/schoolId validation as the authenticated native router.
  const canonical = rewriteLegacyShopsPath(parsed.pathname + parsed.search);
  const match = canonical.match(/^\/post\/([A-Za-z0-9_-]{1,256})\?schoolId=([A-Za-z0-9_-]{1,64})$/);
  if (!match) return false;

  // Tracking query parameters are discarded, and no Firestore data is cached.
  pending = {
    url: `${origin}/community/post/${encodeURIComponent(match[1])}?schoolId=${encodeURIComponent(match[2])}`,
    capturedAt: now,
  };
  return true;
}

/** Consume at most once when the private school navigation becomes available. */
export function takePendingSharedPostLink(now = Date.now()): string | null {
  const entry = pending;
  pending = null;
  if (!entry || !Number.isFinite(now)) return null;
  if (now < entry.capturedAt || now - entry.capturedAt > RETENTION_MS) return null;
  return entry.url;
}

export function clearPendingSharedPostLink(): void {
  pending = null;
}
