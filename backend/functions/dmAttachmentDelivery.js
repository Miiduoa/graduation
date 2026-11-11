const { randomUUID } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { isAccountUnavailable } = require('./accountLifecycle');

// Cloud Storage Rules allow at most two different Firestore documents per request.
// Do NOT reproduce the conversation + profile + membership gate in Storage Rules:
// authorize server-side, then issue a short-lived Cloud Storage capability instead.
const MINUTE_MS = 60_000;
const MiB = 1024 * 1024;
const DOCUMENT_TYPES = new Set([
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// Firestore document IDs accept up to 1500 bytes. Canonical DMs are
// dm_{schoolId}_{uid}_{uid}; a 120-character cap rejects IDs that already exist.
// Do not take a second argument: Array#every passes the index.
function segment(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1500 &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function uploadLimit(contentType) {
  if (typeof contentType !== 'string') return 0;
  if (/^image\/[a-z0-9.+-]+$/.test(contentType)) return 10 * MiB - 1;
  if (/^video\/[a-z0-9.+-]+$/.test(contentType)) return 100 * MiB - 1;
  if (/^audio\/[a-z0-9.+-]+$/.test(contentType)) return 20 * MiB - 1;
  if (DOCUMENT_TYPES.has(contentType)) return 50 * MiB - 1;
  return 0;
}

function forbidden() {
  return new HttpsError('permission-denied', '無法存取這份私訊附件。');
}

function conversationMembers(thread) {
  const memberIds = thread?.memberIds;
  return Array.isArray(memberIds) && memberIds.length > 0 && memberIds.every(segment)
    ? memberIds
    : null;
}

function availableAccount(snapshot) {
  return snapshot.exists && !isAccountUnavailable(snapshot.data());
}

async function authorize(db, uid, conversationId) {
  const conversation = await db.collection('conversations').doc(conversationId).get();
  const thread = conversation.data();
  const memberIds = conversationMembers(thread);
  // Existing members of any conversation type, including groups, keep media
  // access. School matching and active school membership must not revoke it.
  if (!conversation.exists || !memberIds || !memberIds.includes(uid)) {
    throw forbidden();
  }
  const uniqueMembers = [...new Set(memberIds)];
  const isDirect = thread.type === 'dm' && uniqueMembers.length === 2 && memberIds.length === 2;
  if (thread.type === 'dm' && !isDirect) throw forbidden();
  const peerUid = isDirect ? uniqueMembers.find((id) => id !== uid) : null;
  const reads = [db.collection('users').doc(uid).get()];
  if (peerUid) {
    reads.push(
      db.collection('users').doc(peerUid).get(),
      db.collection('users').doc(uid).collection('blockedUsers').doc(peerUid).get(),
      db.collection('users').doc(peerUid).collection('blockedUsers').doc(uid).get(),
      db.collection('friendBlocks').doc(`${uid}_${peerUid}`).get(),
      db.collection('friendBlocks').doc(`${peerUid}_${uid}`).get(),
    );
  }
  const [profileSnapshot, peerProfile, ...blocks] = await Promise.all(reads);
  if (!availableAccount(profileSnapshot)) throw forbidden();
  if (peerUid && (!availableAccount(peerProfile) || blocks.some((block) => block.exists))) {
    throw forbidden();
  }
}

function attachmentPath(conversationId, folder, mediaId, fileName) {
  if (!segment(conversationId) || !segment(mediaId) || !segment(fileName) ||
      !['media', 'messages'].includes(folder)) {
    throw new HttpsError('invalid-argument', '附件路徑不正確。');
  }
  return `conversations/${conversationId}/${folder}/${mediaId}/${fileName}`;
}

function createDmAttachmentDelivery({ db, getBucket, now = Date.now, newId = randomUUID }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!segment(uid)) throw new HttpsError('unauthenticated', '請先登入。');
    const { action, conversationId, mediaId, fileName, folder = 'media', contentType, size } = request.data || {};
    if (!segment(conversationId) || !segment(fileName) ||
        !['read', 'upload'].includes(action)) {
      throw new HttpsError('invalid-argument', '請確認附件資料。');
    }
    // Reject before asking the signing service to do any work.
    if (action === 'read' && (!segment(mediaId) || !['media', 'messages'].includes(folder))) {
      throw new HttpsError('invalid-argument', '附件路徑不正確。');
    }
    if (action === 'upload' && (!Number.isSafeInteger(size) || size < 1 ||
        size > uploadLimit(contentType))) {
      throw new HttpsError('invalid-argument', '附件類型或檔案大小不符合限制。');
    }
    await authorize(db, uid, conversationId);
    const bucket = getBucket();

    if (action === 'upload') {
      // Generated names prevent clients from overwriting historical attachments.
      const generatedId = newId();
      const path = attachmentPath(conversationId, 'media', generatedId, fileName);
      const expires = now() + MINUTE_MS;
      // The V4 POST policy enforces size and MIME at GCS, instead of trusting
      // the client-side size estimate. The policy is itself a 60s bearer grant.
      const [policy] = await bucket.file(path).generateSignedPostPolicyV4({
        expires,
        fields: {
          'Content-Type': contentType,
          'x-goog-meta-uploader': uid,
        },
        conditions: [
          ['content-length-range', 1, uploadLimit(contentType)],
          ['eq', '$Content-Type', contentType],
          ['eq', '$x-goog-meta-uploader', uid],
        ],
      });
      return {
        method: 'POST', url: policy.url, fields: policy.fields,
        path, mediaId: generatedId, expiresAt: new Date(expires).toISOString(),
      };
    }

    const path = attachmentPath(conversationId, folder, mediaId, fileName);
    const file = bucket.file(path);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (error) {
      if (error?.code === 404) throw forbidden();
      throw error;
    }
    // Do not issue capabilities for empty or disallowed objects. Uploaded
    // objects are checked on delivery as well as on upload.
    const limit = uploadLimit(metadata.contentType);
    if (!limit || Number(metadata.size) < 1 || Number(metadata.size) > limit) throw forbidden();
    // Preserve legacy download tokens: revocation is a separate manual migration.
    const expires = now() + MINUTE_MS;
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires });
    // Never return firebaseStorageDownloadTokens or getDownloadURL() here.
    return { url, expiresAt: new Date(expires).toISOString() };
  };
}

module.exports = { authorize, attachmentPath, createDmAttachmentDelivery, uploadLimit, MINUTE_MS, segment };
