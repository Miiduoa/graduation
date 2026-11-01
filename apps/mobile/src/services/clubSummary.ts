import { httpsCallable } from 'firebase/functions';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
} from 'firebase/firestore';
import { getAuthInstance, getFunctionsInstance, getDb } from '../firebase';
export const clubSummaryEnabled = () => process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED === 'true';
export type ClubSummaryData = {
  rosterOnly?: boolean;
  members: { id: string; name: string; role: string }[];
  events: { id: string; title: string; startsAt: number; registered: number; checkedIn: number }[];
};
export async function loadClubSummary(
  uid: string,
  schoolId: string,
  groupId: string,
): Promise<ClubSummaryData> {
  if (!clubSummaryEnabled()) throw new Error('社團後台尚未啟用');
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  try {
    const result = await httpsCallable<Record<string, string>, ClubSummaryData>(
      getFunctionsInstance(),
      'clubAdmin',
    )({ groupId, schoolId, action: 'read' });
    if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
    return result.data;
  } catch {
    if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
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
    if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
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
    if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
    return { rosterOnly: true, members, events: [] };
  }
}

export const clubRoleLabel = (role: string) =>
  ({ owner: '會長', admin: '幹部', member: '社員', instructor: '指導老師', moderator: '協管員' })[
    role
  ] ?? (['會長', '幹部', '社員', '指導老師', '協管員'].includes(role) ? role : '社員');
