import { doc, onSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';

/** 伺服器寫入的助理回覆固定放在 comments/assistant。寫好就回呼一次內容。 */
export function subscribeAssistantReply(
  groupId: string,
  postId: string,
  onReply: (body: string) => void,
  onError: () => void,
): () => void {
  return onSnapshot(
    doc(getDb(), 'groups', groupId, 'posts', postId, 'comments', 'assistant'),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as { body?: string; authorId?: string; generatedBy?: string };
      // 只認伺服器寫的那一則
      if (data.body && data.authorId === 'campus-assistant' && data.generatedBy === 'server') onReply(data.body);
    },
    () => onError(),
  );
}
