import { doc, getDocFromServer } from 'firebase/firestore';
import { getAuthInstance, getDb, isFirebaseMockMode } from '../firebase';

import { isDormAnnouncementData, type DormAnnouncementTap } from '../utils/dormAnnouncementPush';

export function isDormTapAccountCurrent(uid: string) {
  return !isFirebaseMockMode() && getAuthInstance().currentUser?.uid === uid;
}

export async function ownsDormAnnouncementTap(
  uid: string,
  tap: DormAnnouncementTap,
): Promise<boolean> {
  if (!tap.schoolId || !tap.dormAnnouncementId || !tap.inboxNotificationId || !tap.deliveryKey)
    return false;
  if (!isDormTapAccountCurrent(uid)) throw new Error('登入帳號已變更');
  const ref = doc(getDb(), 'users', uid, 'notifications', tap.inboxNotificationId);
  const snapshot = await getDocFromServer(ref);
  if (!isDormTapAccountCurrent(uid)) throw new Error('登入帳號已變更');
  const row = snapshot.data();
  return (
    row?.type === 'announcement' &&
    row.schoolId === tap.schoolId &&
    isDormAnnouncementData(row.data) &&
    row.data.schoolId === tap.schoolId &&
    row.data.dormAnnouncementId === tap.dormAnnouncementId &&
    row.data.inboxNotificationId === tap.inboxNotificationId &&
    row.data.deliveryKey === tap.deliveryKey
  );
}
