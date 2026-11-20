import type { GroupFirestore } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import { FieldValue } from 'firebase-admin/firestore';

// Keep these predicates aligned with backend/functions/accountLifecycle.js and dmAttachmentDelivery.js.
export function isAccountUnavailable(data: any) {
  return !data || data.accountDeletionInProgress === true ||
    ['deleted', 'disabled', 'suspended', 'inactive'].includes(data.status);
}
function segment(value: any): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1500 &&
    value !== '.' && value !== '..' && /^[A-Za-z0-9._-]+$/.test(value);
}

// Transaction behavior mirrors backend/functions/dmConversations.js.
const denied = () => new HttpsError('permission-denied', '目前無法存取這段私訊。');
const invalid = () => new HttpsError('invalid-argument', '請確認私訊對象與訊息資料。');

function dmIdentity(request: any) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
  const { viewerUid, schoolId, peerUid } = request.data || {};
  if (viewerUid !== uid || peerUid === uid) throw denied();
  if (![uid, schoolId].every(segment) || (peerUid !== undefined && !segment(peerUid)))
    throw invalid();
  return { uid, schoolId, peerUid };
}

function canonicalConversationId({ uid, schoolId, peerUid }: any) {
  if (!segment(peerUid)) throw invalid();
  const conversationId = `dm_${schoolId}_${[uid, peerUid].sort().join('_')}`;
  if (!segment(conversationId)) throw invalid();
  return conversationId;
}

function dmMessageSession(request: any) {
  const identity = dmIdentity(request);
  const { conversationId, messageId } = request.data || {};
  if (
    !segment(conversationId) ||
    typeof messageId !== 'string' ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(messageId)
  )
    throw invalid();
  if (identity.peerUid !== undefined && conversationId !== canonicalConversationId(identity))
    throw denied();
  return { ...identity, conversationId, messageId };
}

// Every send, receipt replay and media grant rechecks the caller in the same transaction.
function callerUnavailable(snapshot: any, requireCanonicalProfile: boolean) {
  if (!snapshot.exists) return requireCanonicalProfile;
  return isAccountUnavailable(snapshot.data());
}

function inDmConversation(db: GroupFirestore, session: any, action: (context: any) => any, { allowMissing = false, requireCanonicalProfile = false } = {}) {
  const { uid, conversationId, schoolId, peerUid, messageId } = session;
  const thread = db.collection('conversations').doc(conversationId);
  const message = messageId ? thread.collection('messages').doc(messageId) : null;
  return db.runTransaction(async (tx) => {
    const [threadSnap, messageSnap] = await tx.getAll(thread, ...(message ? [message] : []));
    let memberIds;
    if (threadSnap.exists) {
      const row = threadSnap.data();
      memberIds = row?.memberIds;
      if (
        row?.type !== 'dm' ||
        row.schoolId !== schoolId ||
        !Array.isArray(memberIds) ||
        memberIds.length !== 2 ||
        memberIds[0] === memberIds[1] ||
        !memberIds.every(segment) ||
        !memberIds.includes(uid) ||
        (peerUid !== undefined && !memberIds.includes(peerUid))
      )
        throw denied();
    } else {
      if (!allowMissing || !peerUid || messageSnap?.exists) throw denied();
      if (conversationId !== canonicalConversationId(session)) throw denied();
      memberIds = [uid, peerUid].sort();
    }
    const caller = db.collection('users').doc(uid);
    if (threadSnap.exists) {
      // Text matches Firestore isSignedIn. Photos match Storage conversationMember.
      const callerSnap = await tx.get(caller);
      if (callerUnavailable(callerSnap, requireCanonicalProfile)) throw denied();
    } else {
      // New DMs match main conversation create: caller school membership.
      const senderMember = db.collection('schools').doc(schoolId).collection('members').doc(uid);
      const [callerSnap, senderMembership] = await tx.getAll(caller, senderMember);
      if (
        callerUnavailable(callerSnap, requireCanonicalProfile) ||
        senderMembership.data()?.status !== 'active'
      )
        throw denied();
    }
    return action({
      tx,
      thread,
      message,
      memberIds,
      exists: threadSnap.exists,
      existing: messageSnap?.exists ? messageSnap.data() : undefined,
    });
  });
}

function writeDmMessage(context: any, session: any, fields: any) {
  const { tx, thread, message, exists, memberIds } = context;
  const { uid, schoolId, conversationId, messageId } = session;
  const stamp = FieldValue.serverTimestamp();
  const row = { conversationId, senderId: uid, ...fields, readBy: [uid], createdAt: stamp };
  const preview = {
    lastMessage: { id: messageId, ...row },
    lastMessageText: row.content.slice(0, 50),
    lastMessageSenderId: uid,
    lastMessageAt: stamp,
    updatedAt: stamp,
  };
  tx.create(message, row);
  if (exists) tx.update(thread, preview);
  else tx.create(thread, { type: 'dm', schoolId, memberIds, createdAt: stamp, ...preview });
}

export function createDmConversations({ db }: { db: GroupFirestore }) {
  async function prepare(request: any) {
    const identity = dmIdentity(request);
    const conversationId = canonicalConversationId(identity);
    return inDmConversation(
      db,
      { ...identity, conversationId },
      ({ exists }) => ({ conversationId, peerUid: identity.peerUid, exists }),
      { allowMissing: true },
    );
  }

  async function sendText(request: any) {
    const session = dmMessageSession(request);
    if (session.conversationId !== canonicalConversationId(session)) throw denied();
    const content = typeof request.data.content === 'string' ? request.data.content.trim() : '';
    if (!content || content.length > 4000)
      throw new HttpsError('invalid-argument', '請輸入 1 至 4000 字的私訊。');
    const { uid, conversationId, messageId } = session;
    const receipt = { conversationId, messageId };
    return inDmConversation(
      db,
      session,
      (context) => {
        const { existing } = context;
        if (existing) {
          if (
            existing.conversationId !== conversationId ||
            existing.senderId !== uid ||
            existing.type !== 'text' ||
            existing.content !== content
          )
            throw new HttpsError('already-exists', '這個訊息編號已使用。');
          return receipt;
        }
        writeDmMessage(context, session, { type: 'text', content });
        return receipt;
      },
      { allowMissing: true },
    );
  }
  return { prepare, sendText };
}

