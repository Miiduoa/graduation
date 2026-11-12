import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getAuthInstance, getDb, isFirebaseMockMode } from '../firebase';
import { postNuniWebFn } from './nuniWebFn';
import { deriveDmConversationId } from '../utils/conversationAccess';
import { isDemoUid } from './demoSession';

export type DmPeer = { viewerUid: string; schoolId: string; peerUid: string };
export type DmPeerThread = DmPeer & { conversationId: string };
type PreparedDm = { conversationId: string; peerUid: string; exists: boolean };
type DmText = DmPeerThread & { messageId: string; content: string };
const segment = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,1500}$/;

function checkPeer(input: DmPeer, signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error('對話已切換。'), { code: 'cancelled' });
  if (
    isFirebaseMockMode() || isDemoUid(input.viewerUid) ||
    getAuthInstance().currentUser?.uid !== input.viewerUid ||
    ![input.viewerUid, input.schoolId, input.peerUid].every((value) => typeof value === 'string' && segment.test(value)) ||
    input.viewerUid === input.peerUid
  ) throw Object.assign(new Error('無法確認這段對話。'), { code: 'permission-denied' });
  return deriveDmConversationId(input.schoolId, input.viewerUid, input.peerUid);
}

export async function prepareDmConversation(input: DmPeer, signal: AbortSignal): Promise<PreparedDm> {
  const conversationId = checkPeer(input, signal);
  const data = await postNuniWebFn<DmPeer, PreparedDm>('prepareDmConversation', input, input.viewerUid, signal);
  checkPeer(input, signal);
  if (
    data?.conversationId !== conversationId || data.peerUid !== input.peerUid ||
    typeof data.exists !== 'boolean'
  ) throw new Error('尚未確認對話，請再試一次。');
  return data;
}

export async function sendDmText(input: DmText, signal: AbortSignal) {
  const conversationId = checkPeer(input, signal);
  const content = input.content.trim();
  if (
    input.conversationId !== conversationId ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(input.messageId) ||
    !content || content.length > 4000
  ) throw Object.assign(new Error('請確認訊息內容。'), { code: 'invalid-argument' });
  let data: { conversationId: string; messageId: string };
  try {
    data = await postNuniWebFn<DmText, { conversationId: string; messageId: string }>(
      'sendDmText', { ...input, content }, input.viewerUid, signal,
    );
  } catch (error: any) {
    if (typeof error?.code === 'string' && error.code.startsWith('functions/')) {
      throw Object.assign(new Error('訊息尚未送出，請再試一次。'), { code: error.code.slice(10) });
    }
    throw error;
  }
  checkPeer(input, signal);
  if (data?.conversationId !== conversationId || data.messageId !== input.messageId) {
    throw new Error('尚未確認訊息送達，請再試一次。');
  }
  return data;
}

// A missing document cannot be read directly. Watch only the sender's authorized inbox
// until the other participant creates the canonical conversation.
export function watchNewDm(
  input: DmPeerThread,
  receive: () => void,
  fail: (error: unknown) => void,
) {
  if (checkPeer(input) !== input.conversationId) throw new Error('對話對象不符。');
  let active = true;
  const stop = onSnapshot(
    query(
      collection(getDb(), 'conversations'),
      where('type', '==', 'dm'),
      where('schoolId', '==', input.schoolId),
      where('memberIds', 'array-contains', input.viewerUid),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!active) return;
      try {
        checkPeer(input);
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const found = snapshot.docs.find((entry) => entry.id === input.conversationId);
        if (!found) return;
        const row = found.data();
        if (
          row.type !== 'dm' || row.schoolId !== input.schoolId ||
          !Array.isArray(row.memberIds) || row.memberIds.length !== 2 ||
          !row.memberIds.includes(input.viewerUid) || !row.memberIds.includes(input.peerUid)
        ) throw Object.assign(new Error('目前無法開啟這段對話。'), { code: 'permission-denied' });
        active = false;
        receive();
      } catch (error) {
        active = false;
        fail(error);
      }
    },
    (error) => {
      if (!active) return;
      active = false;
      fail(error);
    },
  );
  return () => { active = false; stop(); };
}
