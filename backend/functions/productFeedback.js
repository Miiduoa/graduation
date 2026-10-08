const { createHash } = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const FEEDBACK_TYPES = new Set(['bug', 'feature', 'improvement', 'other']);
const INPUT_FIELDS = new Set([
  'requestId',
  'schoolId',
  'kind',
  'feedbackType',
  'title',
  'description',
  'rating',
  'contactEmail',
]);
const digest = (value) => createHash('sha256').update(value).digest('hex');

function requiredText(value, maximum, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return value.trim();
}

function createSubmitProductFeedback({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入再送出回饋。');
    const input = request.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpsError('invalid-argument', 'Invalid feedback');
    }
    if (Object.keys(input).some((key) => !INPUT_FIELDS.has(key))) {
      throw new HttpsError('invalid-argument', 'Unexpected feedback field');
    }
    const requestId = requiredText(input.requestId, 128, 'requestId');
    const schoolId = requiredText(input.schoolId, 120, 'schoolId');
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId) || !/^[a-zA-Z0-9_-]+$/.test(schoolId)) {
      throw new HttpsError('invalid-argument', 'Invalid feedback identifiers');
    }
    if (input.kind !== 'general' || !FEEDBACK_TYPES.has(input.feedbackType)) {
      throw new HttpsError('invalid-argument', 'Invalid feedback type');
    }
    const rating = input.rating ?? 0;
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      throw new HttpsError('invalid-argument', 'Invalid rating');
    }
    let contactEmail = null;
    if (input.contactEmail != null && input.contactEmail !== '') {
      contactEmail = requiredText(input.contactEmail, 320, 'contactEmail');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        throw new HttpsError('invalid-argument', 'Invalid contactEmail');
      }
    }
    const content = {
      kind: 'general',
      type: input.feedbackType,
      title: requiredText(input.title, 160, 'title'),
      description: requiredText(input.description, 8000, 'description'),
      rating,
      contactEmail,
      schoolId,
    };
    const payloadDigest = digest(JSON.stringify(content));
    const feedbackId = `feedback-${digest(`${uid}\0${requestId}`)}`;
    const feedbackRef = db.collection('feedback').doc(feedbackId);
    const membershipRef = db.collection('schools').doc(schoolId).collection('members').doc(uid);
    return db.runTransaction(async (transaction) => {
      const [membership, existing] = await transaction.getAll(membershipRef, feedbackRef);
      if (!membership.exists || membership.data()?.status !== 'active') {
        throw new HttpsError('permission-denied', '請確認目前學校的登入狀態後再送出。');
      }
      if (existing.exists) {
        const previous = existing.data();
        if (previous.submittedBy !== uid || previous.payloadDigest !== payloadDigest) {
          throw new HttpsError('already-exists', '這個送出編號已用於另一則回饋。');
        }
        return { ok: true, feedbackId, reused: true };
      }
      transaction.create(feedbackRef, {
        ...content,
        submittedBy: uid,
        payloadDigest,
        status: 'new',
        createdAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, feedbackId, reused: false };
    });
  };
}

module.exports = { createSubmitProductFeedback };
