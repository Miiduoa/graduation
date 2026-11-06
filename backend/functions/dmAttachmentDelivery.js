const { randomUUID } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');

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

function segment(value) {
  return typeof value === 'string' && /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,120}$/.test(value);
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

async function authorize(db, uid, conversationId) {
  const conversation = await db.collection('conversations').doc(conversationId).get();
  const thread = conversation.data();
  if (!conversation.exists || thread?.type !== 'dm' || !segment(thread?.schoolId) ||
      !Array.isArray(thread.memberIds) || thread.memberIds.length !== 2 ||
      new Set(thread.memberIds).size !== 2 || !thread.memberIds.includes(uid)) {
    throw forbidden();
  }
  const schoolId = thread.schoolId;
  // These reads are deliberately in Admin SDK, NOT Storage Rules. All three
  // must be authoritative on EACH request, including after school transfers.
  const [profileSnapshot, memberSnapshot] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('schools').doc(schoolId).collection('members').doc(uid).get(),
  ]);
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || !memberSnapshot.exists ||
      profile?.schoolId !== schoolId || profile?.status === 'deleted' ||
      profile?.accountDeletionInProgress === true ||
      memberSnapshot.data()?.status !== 'active') {
    throw forbidden();
  }
  return schoolId;
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
    const expires = now() + MINUTE_MS;
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires });
    // Never return firebaseStorageDownloadTokens or getDownloadURL() here.
    return { url, expiresAt: new Date(expires).toISOString() };
  };
}

module.exports = { authorize, attachmentPath, createDmAttachmentDelivery, uploadLimit, MINUTE_MS };
