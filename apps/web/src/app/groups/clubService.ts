import { getAuth, getCloudFunctionUrl } from '@/lib/firebase';

export const clubEnabled = () => process.env.NEXT_PUBLIC_CLUB_ADMIN_ENABLED === 'true';
export type ClubView = {
  success: true;
  role: string;
  members: { id: string; name: string; role: string; studentId?: string; phone?: string }[];
  events: {
    id: string;
    title: string;
    location: string;
    startsAt: number;
    endsAt: number;
    registered: number;
    checkedIn: number;
    mine: boolean;
    myCheckIn: boolean;
    registrations?: { uid: string; checkedIn: boolean }[];
  }[];
};
export async function callClub<T>(
  uid: string,
  schoolId: string,
  groupId: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  if (!clubEnabled()) throw new Error('社團後台尚未啟用');
  const user = getAuth()?.currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  const token = await user.getIdToken();
  if (getAuth()?.currentUser !== user) throw new Error('帳號已變更');
  const response = await fetch(getCloudFunctionUrl('clubAdmin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { ...input, schoolId, groupId } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json();
  if (getAuth()?.currentUser !== user) throw new Error('帳號已變更');
  if (!response.ok || payload.error)
    throw new Error(payload.error?.message || '伺服器尚未確認，請重新整理');
  const result = payload.result ?? payload.data;
  if (!result || result.success !== true) throw new Error('伺服器尚未確認，請重新整理');
  return result as T;
}
