const { createHash } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { isAccountUnavailable } = require('./accountLifecycle');

function unavailable() {
  return new HttpsError('permission-denied', '目前無法回覆這則限時動態。');
}

function validId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/')
  );
}

function availableProfile(snapshot) {
  const profile = snapshot.data();
  return Boolean(profile) && !isAccountUnavailable(profile);
}

function affiliatedWithSchool(profile, schoolId) {
  const school = typeof profile?.schoolId === 'string' ? profile.schoolId : '';
  const primary = typeof profile?.primarySchoolId === 'string' ? profile.primarySchoolId : '';
  return school === schoolId || primary === schoolId;
}

function canReadCampusStory(profileSnap, memberSnap, schoolId) {
  // Matches campusStories get: live account, active school membership, and
  // schoolId or primarySchoolId bound to that campus.
  return (
    availableProfile(profileSnap) &&
    memberSnap.data()?.status === 'active' &&
    affiliatedWithSchool(profileSnap.data(), schoolId)
  );
}

function createReplyToCampusStory({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入再回覆。');
    const { schoolId, storyId, authorUid, viewerUid, replyId, content } = request.data || {};
    if (viewerUid !== uid || authorUid === uid) throw unavailable();
    const body = typeof content === 'string' ? content.trim() : '';
    if (
      ![uid, schoolId, storyId, authorUid].every(validId) ||
      typeof replyId !== 'string' ||
      !/^[A-Za-z0-9_-]{20,64}$/.test(replyId) ||
      !body ||
      body.length > 500
    ) {
      throw new HttpsError('invalid-argument', '請確認限動及回覆內容（最多 500 字）。');
    }

    const memberIds = [uid, authorUid].sort();
    // Matches deriveDmConversationId on both clients. Verify the stored members before writing.
    const conversationId = `dm_${schoolId}_${memberIds.join('_')}`;
    const messageId =
      'story-' +
      createHash('sha256')
        .update(JSON.stringify([uid, replyId]))
        .digest('hex');
    const conversation = db.collection('conversations').doc(conversationId);
    const message = conversation.collection('messages').doc(messageId);
    const sender = db.collection('users').doc(uid);
    const author = db.collection('users').doc(authorUid);
    const senderMember = db.collection('schools').doc(schoolId).collection('members').doc(uid);
    const friendBlocks = db.collection('friendBlocks');

    return db.runTransaction(async (tx) => {
      const [
        senderProfile,
        ,
        senderMembership,
        story,
        thread,
        existing,
        ...blocks
      ] = await tx.getAll(
        sender,
        author,
        senderMember,
        db.collection('campusStories').doc(storyId),
        conversation,
        message,
        sender.collection('blockedUsers').doc(authorUid),
        author.collection('blockedUsers').doc(uid),
        friendBlocks.doc(`${uid}_${authorUid}`),
        friendBlocks.doc(`${authorUid}_${uid}`),
      );
      if (
        (senderProfile.exists && isAccountUnavailable(senderProfile.data())) ||
        blocks.some((block) => block.exists)
      ) {
        throw unavailable();
      }
      if (thread.exists) {
        const current = thread.data();
        if (
          current.type !== 'dm' ||
          current.schoolId !== schoolId ||
          !Array.isArray(current.memberIds) ||
          current.memberIds.length !== 2 ||
          !memberIds.every((id) => current.memberIds.includes(id))
        ) {
          throw unavailable();
        }
      }
      if (existing.exists) {
        const prior = existing.data();
        if (
          !thread.exists ||
          prior.senderId !== uid ||
          prior.content !== body ||
          prior.storyReplyTo?.storyId !== storyId ||
          prior.storyReplyTo?.authorUid !== authorUid
        ) {
          throw new HttpsError('already-exists', '此回覆編號已被使用。');
        }
        // A response may have been lost just before expiry. A replay must never republish the preview.
        return { conversationId, messageId };
      }
      if (!canReadCampusStory(senderProfile, senderMembership, schoolId)) {
        throw unavailable();
      }
      const source = story.data();
      if (
        source?.schoolId !== schoolId ||
        source.authorUid !== authorUid ||
        source.allowReplies === false ||
        !Number.isFinite(source.expiresAt) ||
        source.expiresAt <= Date.now()
      ) {
        throw unavailable();
      }

      const stamp = FieldValue.serverTimestamp();
      const row = {
        conversationId,
        senderId: uid,
        content: body,
        type: 'text',
        readBy: [uid],
        createdAt: stamp,
        storyReplyTo: { storyId, authorUid },
      };
      const preview = {
        lastMessage: { id: messageId, ...row },
        lastMessageText: body.slice(0, 50),
        lastMessageAt: stamp,
        lastMessageSenderId: uid,
        updatedAt: stamp,
      };
      if (thread.exists) tx.update(conversation, preview);
      else
        tx.create(conversation, { type: 'dm', schoolId, memberIds, createdAt: stamp, ...preview });
      tx.create(message, row);
      return { conversationId, messageId };
    });
  };
}

module.exports = { createReplyToCampusStory };
