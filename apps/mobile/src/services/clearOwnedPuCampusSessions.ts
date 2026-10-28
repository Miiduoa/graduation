import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import { canUseHostedSchoolFallback, getCloudFunctionUrl } from './cloudFunctions';

const HOSTED_CLEAR_SESSIONS = 'https://nuni.tw/api/fn/clearPuCampusSessions';
export const CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS = 5_000;

/** 登出或解除學校連線前，請伺服器刪除本人 _puSessions（含 cookies / mypuCookies）。 */
export async function clearOwnedPuCampusSessions(): Promise<void> {
  if (!hasUsableFirebaseConfig()) return;
  const user = getAuthInstance()?.currentUser;
  if (!user || typeof user.getIdToken !== 'function') return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, CLEAR_CAMPUS_SESSIONS_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      (async () => {
        try {
          const token = await user.getIdToken();
          if (controller.signal.aborted) return;
          const options: RequestInit = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ data: {} }),
            signal: controller.signal,
          };
          const primaryUrl = getCloudFunctionUrl('clearPuCampusSessions');
          let response = await fetch(primaryUrl, options);
          if (
            !controller.signal.aborted &&
            response.status === 404 &&
            canUseHostedSchoolFallback(primaryUrl) &&
            primaryUrl !== HOSTED_CLEAR_SESSIONS
          ) {
            response = await fetch(HOSTED_CLEAR_SESSIONS, options);
          }
          await response.json().catch(() => null);
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn('[auth] Failed to clear campus sessions', error);
        }
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
