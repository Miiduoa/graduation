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
      const body = (snap.data() as { body?: string }).body;
      if (body) onReply(body);
    },
    () => onError(),
  );
}
