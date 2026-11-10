import { rewriteLegacyShopsPath, socialPostHttpsPrefixes } from './legacyShopsPath';

/** A signed-out HTTPS share is an intent, not permission to read a post.
 * In-memory only: no content, profile, credentials, persistent storage or cursor.
 * The authenticated PostDetail flow must still check campus and server access.
 */
const RETENTION_MS = 10 * 60 * 1000;
let pending: { url: string; capturedAt: number } | null = null;

// The OS can return its original launch URL again after the public stack was
// replaced by the school stack. Keep only a non-reversible identifier of that
// already-handled URL in memory so an expired/canceled intent cannot revive.
let handledPublicInitialSignature: string | null = null;

function canonicalSharedPostURL(incoming: string, releaseHost: unknown): string | null {
  const [origin] = socialPostHttpsPrefixes(releaseHost);
  if (!origin || typeof incoming !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(incoming);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash) return null;
  if (!parsed.pathname.startsWith('/community/post/')) return null;

  const canonical = rewriteLegacyShopsPath(parsed.pathname + parsed.search);
  const match = canonical.match(/^\/post\/([A-Za-z0-9_-]{1,256})\?schoolId=([A-Za-z0-9_-]{1,64})$/);
  if (!match) return null;
  // Tracking query parameters are discarded, and no Firestore data is cached.
  return `${origin}/community/post/${encodeURIComponent(match[1])}?schoolId=${encodeURIComponent(match[2])}`;
}

function signatureOf(url: string): string {
  // Two independent 32-bit rolling hashes avoid retaining post/school IDs or
  // third-party tracking parameters beyond the 10-minute pending lifetime.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

function stageCanonical(url: string, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  pending = { url, capturedAt: now };
  return true;
}

export function stagePendingSharedPostLink(
  incoming: string,
  releaseHost: unknown,
  now = Date.now(),
): boolean {
  const canonical = canonicalSharedPostURL(incoming, releaseHost);
  return canonical ? stageCanonical(canonical, now) : false;
}

/** Called only for the public container's OS launch URL, not for hot-link events.
 * Repeating the same initial URL must not renew its TTL on a navigation remount.
 */
export function stagePublicInitialSharedPostLink(
  incoming: string,
  releaseHost: unknown,
  now = Date.now(),
): boolean {
  const canonical = canonicalSharedPostURL(incoming, releaseHost);
  if (!canonical) return false;
  const signature = signatureOf(canonical);
  if (handledPublicInitialSignature === signature) return true;
  if (!stageCanonical(canonical, now)) return false;
  handledPublicInitialSignature = signature;
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

/** Use the pending intent or an as-yet-unhandled OS URL. An old URL handled by
 * PublicNavigation may still be returned by Linking.getInitialURL(), even after
 * the 10-minute intent expired. Never re-open it as a fresh authenticated link.
 */
export function resolvePrivateInitialSharedPostURL(
  initialUrl: string | null,
  releaseHost: unknown,
  now = Date.now(),
): string | null {
  const staged = takePendingSharedPostLink(now);
  if (staged) return staged;
  if (initialUrl) {
    const canonical = canonicalSharedPostURL(initialUrl, releaseHost);
    if (canonical && signatureOf(canonical) === handledPublicInitialSignature) return null;
  }
  return initialUrl;
}

export function clearPendingSharedPostLink(): void {
  // Explicitly clearing an intent must not re-enable the already-handled OS
  // launch URL when a private navigation container mounts afterward.
  pending = null;
}
