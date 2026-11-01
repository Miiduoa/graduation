import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance } from '../firebase';
import { clubSummaryEnabled, type ClubSummaryData } from './clubSummary';

export const watchClubAccount = (changed: (uid: string | null) => void) =>
  onAuthStateChanged(getAuthInstance(), (user) => changed(user?.uid ?? null));

export async function callClubRegistration(
  uid: string,
  schoolId: string,
  groupId: string,
  action: 'read' | 'register' | 'cancel',
  eventId?: string,
): Promise<ClubSummaryData & { success: true }> {
  if (!clubSummaryEnabled()) throw new Error('社團功能尚未啟用');
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  const result = await httpsCallable<Record<string, string>, ClubSummaryData & { success: true }>(
    getFunctionsInstance(),
    'clubAdmin',
    { timeout: 20000 },
  )({ schoolId, groupId, action, ...(eventId ? { eventId } : {}) });
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  if (result.data?.success !== true) throw new Error('伺服器尚未確認');
  return result.data;
}
