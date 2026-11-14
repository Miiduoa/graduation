import { getAuthInstance } from '../firebase';
import type { ClubPortalView } from '@campus/shared/src/clubPortal';
export async function callClubPortal(
  uid: string,
  schoolId: string,
  input: Record<string, unknown> = {},
): Promise<ClubPortalView> {
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  const token = await user.getIdToken();
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://nuni.tw/api/fn/clubPortal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { ...input, schoolId } }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
    if (!response.ok || payload.error)
      throw new Error(payload.error?.message || '伺服器尚未確認，請重試');
    if (payload.result?.success !== true) throw new Error('伺服器尚未確認，請重試');
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}
