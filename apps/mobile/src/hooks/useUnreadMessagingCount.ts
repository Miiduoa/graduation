import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';

import { getDb, isFirebaseMockMode } from '../firebase';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { toDate } from '../utils/format';
import {
  isConversationMember,
  isConversationUnread,
} from '../utils/conversationAccess';

/**
 * 訂閱目前使用者在當前學校的「未讀私訊」總數。
 * 提供給 TabBar 顯示紅點／徽章用，邏輯共用 conversationAccess helper，
 * 與 MessagesHomeScreen 顯示的單一對話未讀判定保持一致。
 *
 * 設計考量：
 * 1. 必須使用即時 onSnapshot，這樣 demo 時對方一傳訊息馬上看得到角標跳動。
 * 2. 與 MessagesHomeScreen 一樣，掛 schoolId 過濾，避免跨校汙染。
 * 3. 最多監聽 30 條對話即可；DM 多於 30 條本來就需要進入「對話列表」分頁。
 */
export function useUnreadMessagingCount(): number {
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!auth.user || !school.id || isFirebaseMockMode()) {
      setCount(0);
      return;
    }
    const myUid = auth.user.uid;

    const ref = collection(db, 'conversations');
    const qy = query(
      ref,
      where('memberIds', 'array-contains', myUid),
      where('schoolId', '==', school.id),
      limit(30),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        let unreadConvos = 0;
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (!isConversationMember(myUid, data.memberIds)) return;
          const lastMessageSenderId =
            data.lastMessage?.senderId ?? data.lastMessageSenderId ?? undefined;
          const lastMessageAt = data.lastMessageAt
            ? toDate(data.lastMessageAt)
            : undefined;
          const lastReadAt = data.lastReadBy?.[myUid];
          if (
            isConversationUnread({
              uid: myUid,
              lastMessageAt,
              lastReadAt,
              lastMessageSenderId,
            })
          ) {
            unreadConvos += 1;
          }
        });
        setCount(unreadConvos);
      },
      () => {
        // permission-denied 等錯誤時不破壞 UI，直接歸 0
        setCount(0);
      },
    );

    return () => unsub();
  }, [auth.user?.uid, school.id, db]);

  return count;
}
