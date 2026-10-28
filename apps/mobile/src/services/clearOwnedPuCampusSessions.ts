import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import { canUseHostedSchoolFallback, getCloudFunctionUrl } from './cloudFunctions';

const HOSTED_CLEAR_SESSIONS = 'https://nuni.tw/api/fn/clearPuCampusSessions';

/** 登出或解除學校連線前，請伺服器刪除本人 _puSessions（含 cookies / mypuCookies）。 */
export async function clearOwnedPuCampusSessions(): Promise<void> {
  if (!hasUsableFirebaseConfig()) return;
  const user = getAuthInstance()?.currentUser;
  if (!user || typeof user.getIdToken !== 'function') return;
  const token = await user.getIdToken();
  const options: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: {} }),
  };
  const primaryUrl = getCloudFunctionUrl('clearPuCampusSessions');
  let response = await fetch(primaryUrl, options);
  if (
    response.status === 404 &&
    canUseHostedSchoolFallback(primaryUrl) &&
    primaryUrl !== HOSTED_CLEAR_SESSIONS
  ) {
    response = await fetch(HOSTED_CLEAR_SESSIONS, options);
  }
  await response.json().catch(() => null);
}
