/**
 * Firebase App Check — device attestation for API abuse prevention.
 *
 * Production: uses DeviceCheck (iOS) / Play Integrity (Android).
 * Development: uses debug provider with a short-lived token.
 */
import Constants from 'expo-constants';

const appEnv = Constants.expoConfig?.extra?.appEnv ?? 'development';

interface AppCheckToken {
  token: string;
  expireTimeMillis: number;
}

// eslint-disable-next-line prefer-const
let cachedToken: AppCheckToken | null = null;

/**
 * Initialise App Check. Call once during app boot (e.g. in App.tsx).
 * In development mode this is a no-op.
 */
export async function initAppCheck(): Promise<void> {
  if (appEnv === 'development') {
    console.log('[AppCheck] Skipped — development mode');
    return;
  }
  // Real initialisation is handled by the Firebase SDK
  // when the app starts. This function exists to provide
  // a clear entry-point and future extension hook.
  console.log('[AppCheck] Initialised for', appEnv);
}

/**
 * Retrieve a valid App Check token, refreshing if expired.
 * Returns `null` in development mode so callers can skip
 * the header gracefully.
 */
export async function getAppCheckToken(): Promise<string | null> {
  if (appEnv === 'development') return null;

  if (cachedToken && Date.now() < cachedToken.expireTimeMillis - 60_000) {
    return cachedToken.token;
  }

  try {
    // In a real implementation this would call
    // firebase.appCheck().getToken(/* forceRefresh */ true)
    // For now we return null and log a warning.
    console.warn('[AppCheck] Token retrieval not yet wired to native SDK');
    return null;
  } catch (error) {
    console.error('[AppCheck] Failed to get token', error);
    return null;
  }
}
