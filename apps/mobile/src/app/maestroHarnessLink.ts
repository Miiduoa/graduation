/** Isolated emulator-login URI used only by the Maestro test entrypoint. */
export const MAESTRO_LOGIN_LINK = 'campus://maestro/sign-in';

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/**
 * True only for the dedicated emulator-login URI. Extra query, hash, credentials,
 * or a different host/path must not open the harness or steal public navigation.
 */
export function isReservedMaestroHarnessUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url || url.trim() !== url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol.toLowerCase() !== 'campus:') return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const host = parsed.hostname.toLowerCase();
    const segments = pathSegments(parsed.pathname);
    if (host === 'maestro') return segments.length === 1 && segments[0] === 'sign-in';
    return !host && segments.length === 2 && segments[0] === 'maestro' && segments[1] === 'sign-in';
  } catch {
    return url.replace(/\/+$/, '') === MAESTRO_LOGIN_LINK;
  }
}
