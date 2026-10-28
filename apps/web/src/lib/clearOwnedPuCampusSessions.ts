import { getCloudFunctionUrl } from './cloudFunctions';

/** 登出或解除學校連線前，請伺服器刪除本人 _puSessions（含 cookies / mypuCookies）。 */
export async function clearOwnedPuCampusSessions(
  user: { getIdToken: () => Promise<string> } | null | undefined,
): Promise<void> {
  if (!user || typeof user.getIdToken !== 'function') return;
  try {
    const token = await user.getIdToken();
    const response = await fetch(getCloudFunctionUrl('clearPuCampusSessions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: {} }),
      cache: 'no-store',
    });
    await response.json().catch(() => null);
  } catch (error) {
    console.warn('Could not clear campus sessions', error);
  }
}
