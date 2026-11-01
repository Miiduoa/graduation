import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
} from 'firebase/firestore';
import { getAuth, getCloudFunctionUrl, getDb } from '@/lib/firebase';

export const clubEnabled = () => process.env.NEXT_PUBLIC_CLUB_ADMIN_ENABLED === 'true';
export type ClubView = {
  success: true;
  rosterOnly?: boolean;
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

// 後台讀取失敗時僅恢復名單；寫入與活動資料仍須由後端確認。
export async function loadClubView(
  uid: string,
  schoolId: string,
  groupId: string,
): Promise<ClubView> {
  const user = getAuth()?.currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  try {
    return await callClub<ClubView>(uid, schoolId, groupId);
  } catch {
    if (getAuth()?.currentUser !== user) throw new Error('帳號已變更');
    const db = getDb();
    const [group, mine] = await Promise.all([
      getDocFromServer(doc(db, 'groups', groupId)),
      getDocFromServer(doc(db, 'groups', groupId, 'members', uid)),
    ]);
    if (
      group.data()?.type !== 'club' ||
      group.data()?.schoolId !== schoolId ||
      mine.data()?.status !== 'active'
    )
      throw new Error('社團身分失效');
    const snapshot = await getDocsFromServer(
      query(collection(db, 'groups', groupId, 'members'), where('status', '==', 'active')),
    );
    const members = await Promise.all(
      snapshot.docs.map(async (member, index) => {
        const data = member.data();
        const profile = await getDocFromServer(
          doc(db, 'schools', schoolId, 'directory', member.id),
        ).catch(() => null);
        return {
          id: `public-${index}`,
          name: profile?.data()?.displayName || data.displayName || '未提供姓名',
          role: typeof data.role === 'string' ? data.role : 'member',
        };
      }),
    );
    if (getAuth()?.currentUser !== user) throw new Error('帳號已變更');
    return { success: true, rosterOnly: true, role: 'member', members, events: [] };
  }
}
