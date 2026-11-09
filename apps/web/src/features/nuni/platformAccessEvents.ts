/**
 * Broadcast only an opaque UI refresh hint. Service rules always live on the server.
 * Never store a platform account id, session handle or access state here.
 */
export const PLATFORM_ACCESS_CHANGED_KEY = 'nuni.platform.service-access-changed';
export type PlatformArea = 'social' | 'cloudAi';

export function signalPlatformAccessChange(area: PlatformArea): void {
  try {
    window.localStorage.setItem(
      PLATFORM_ACCESS_CHANGED_KEY,
      `${area}:${crypto.randomUUID()}`,
    );
  } catch {
    // Blocking browser storage does not weaken server-side access checks.
  }
}

export function isPlatformAccessChange(key: string | null, value: string | null, area?: PlatformArea) {
  if (key !== PLATFORM_ACCESS_CHANGED_KEY || !value) return false;
  return area
    ? value.startsWith(`${area}:`)
    : value.startsWith('social:') || value.startsWith('cloudAi:');
}
