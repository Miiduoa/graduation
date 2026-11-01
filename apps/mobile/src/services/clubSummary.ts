import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance } from '../firebase';
export const clubSummaryEnabled = () => process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED === 'true';
export type ClubSummaryData = {
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
  const result = await httpsCallable<Record<string, string>, ClubSummaryData>(
    getFunctionsInstance(),
    'clubAdmin',
  )({ groupId, schoolId, action: 'read' });
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  return result.data;
}
