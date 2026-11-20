import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance } from '../firebase';
export type PublicClubMember = {
  name: string;
  role: 'owner' | 'admin' | 'instructor' | 'moderator' | 'member';
};
export async function loadClubRoster(uid: string, schoolId: string, groupId: string) {
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  const result = await httpsCallable<Record<string, string>, { members: PublicClubMember[] }>(
    getFunctionsInstance(),
    'clubRoster',
  )({ schoolId, groupId });
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  return result.data.members;
}
