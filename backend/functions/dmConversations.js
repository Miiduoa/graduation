const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { segment } = require('./dmAttachmentDelivery');

const denied = () => new HttpsError('permission-denied', '目前無法存取這段私訊。');
const invalid = () => new HttpsError('invalid-argument', '請確認私訊對象與訊息資料。');

function dmIdentity(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
  const { viewerUid, schoolId, peerUid } = request.data || {};
  if (viewerUid !== uid || peerUid === uid) throw denied();
  if (![uid, schoolId].every(segment) || (peerUid !== undefined && !segment(peerUid)))
    throw invalid();
  return { uid, schoolId, peerUid };
}

function canonicalConversationId({ uid, schoolId, peerUid }) {
  if (!segment(peerUid)) throw invalid();
  const conversationId = `dm_${schoolId}_${[uid, peerUid].sort().join('_')}`;
  if (!segment(conversationId)) throw invalid();
  return conversationId;
}

function dmMessageSession(request) {
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

// Every send, receipt replay and media grant rechecks both students in the same transaction.
function inDmConversation(db, session, action, { allowMissing = false } = {}) {
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
    const [first, second] = memberIds.map((id) => db.collection('users').doc(id));
    const members = db.collection('schools').doc(schoolId).collection('members');
    const blocks = db.collection('friendBlocks');
    const [a, b, ma, mb, ...blocked] = await tx.getAll(
      first,
      second,
      members.doc(memberIds[0]),
      members.doc(memberIds[1]),
      first.collection('blockedUsers').doc(memberIds[1]),
      second.collection('blockedUsers').doc(memberIds[0]),
      blocks.doc(`${memberIds[0]}_${memberIds[1]}`),
      blocks.doc(`${memberIds[1]}_${memberIds[0]}`),
    );
    if (
      ![a, b].every(
        (snap) =>
          snap.data()?.schoolId === schoolId &&
          snap.data().status !== 'deleted' &&
          snap.data().accountDeletionInProgress !== true,
      ) ||
      ![ma, mb].every((snap) => snap.data()?.status === 'active') ||
      blocked.some((snap) => snap.exists)
    )
      throw denied();
    return action({
      tx,
      thread,
      message,
      memberIds,
      exists: threadSnap.exists,
      existing: messageSnap?.data(),
    });
  });
}

function writeDmMessage(context, session, fields) {
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

function createDmConversations({ db }) {
  async function prepare(request) {
    const identity = dmIdentity(request);
    const conversationId = canonicalConversationId(identity);
    return inDmConversation(
      db,
      { ...identity, conversationId },
      ({ exists }) => ({ conversationId, peerUid: identity.peerUid, exists }),
      { allowMissing: true },
    );
  }

  async function sendText(request) {
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

module.exports = { createDmConversations, dmMessageSession, inDmConversation, writeDmMessage };
