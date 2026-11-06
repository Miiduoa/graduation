'use strict';

const nodeCrypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { MAX_PERIOD_SLOTS } = require('./generated/shared/timetable/schoolPeriods');

const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COURSES = 80;

function text(value, maximum, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return value.trim();
}

function optionalText(value, maximum) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new HttpsError('invalid-argument', 'Invalid text');
  }
  return value.trim();
}

/** Explicit school segment only: lowercase letters/numbers/hyphen/underscore, 1–80 chars. */
function requireSchoolId(value) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', '請先選擇學校，再分享課表。');
  }
  const schoolId = value.trim();
  if (!schoolId || schoolId.length > 80 || !/^[a-z0-9_-]+$/.test(schoolId)) {
    throw new HttpsError('invalid-argument', '請先選擇學校，再分享課表。');
  }
  return schoolId;
}

async function loadShareableTimetable(db, uid, schoolId) {
  const userRef = db.collection('users').doc(uid);
  const scopedRef = userRef
    .collection('schools')
    .doc(schoolId)
    .collection('personalTimetable')
    .doc('current');
  const scopedSnap = await scopedRef.get();
  if (scopedSnap.exists) {
    const record = scopedSnap.data() || {};
    if (record.schoolId !== schoolId) {
      throw new HttpsError('failed-precondition', '無法確認這份課表所屬的學校，請重新載入後再分享。');
    }
    return record;
  }

  const legacyRef = userRef.collection('personalTimetable').doc('current');
  const legacySnap = await legacyRef.get();
  if (!legacySnap.exists) {
    throw new HttpsError('not-found', '還沒有可分享的課表。');
  }
  const legacy = legacySnap.data() || {};
  // Read-only fallback: exact schoolId match only; missing/mismatched provenance is rejected.
  if (legacy.schoolId !== schoolId) {
    throw new HttpsError('failed-precondition', '無法確認這份課表所屬的學校，請重新載入後再分享。');
  }
  return legacy;
}

function cleanCourse(input = {}) {
  let day = Number(input.day);
  let start = Number(input.start);
  let end = Number(input.end);
  if (!Number.isInteger(day) || day < 0 || day > 5) day = 0;
  if (day === 0) {
    start = 0;
    end = 0;
  } else {
    if (!Number.isInteger(start) || start < 1 || start > MAX_PERIOD_SLOTS) start = 1;
    if (!Number.isInteger(end) || end < start || end > MAX_PERIOD_SLOTS) end = start;
  }
  return {
    id: optionalText(input.id, 120).slice(0, 120) || nodeCrypto.randomUUID(),
    name: optionalText(input.name, 100) || '未命名課程',
    day,
    start,
    end,
    teacher: optionalText(input.teacher, 80),
    room: optionalText(input.room, 80),
    color: ['violet', 'blue', 'mint', 'orange', 'pink', 'lime', 'gray'].includes(input.color)
      ? input.color
      : 'gray',
  };
}

function publicMeta(input) {
  const meta = {};
  const textLimits = { school: 80, year: 12, semester: 12, className: 80, title: 80 };
  for (const [key, limit] of Object.entries(textLimits)) {
    if (typeof input?.[key] === 'string') meta[key] = input[key].trim().slice(0, limit);
  }
  if (Number.isFinite(input?.credits)) meta.credits = Math.max(0, Math.min(60, input.credits));
  return meta;
}

function publicCourses(courses) {
  return Array.isArray(courses)
    ? courses.slice(0, MAX_COURSES).map((course) => cleanCourse({ ...course, teacher: '' }))
    : [];
}

async function readPublicTimetableShare(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(token)) {
    return { status: 400, body: { code: 'invalid', error: '分享碼不正確。' } };
  }
  const snapshot = await db.collection('timetableShares').doc(token).get();
  if (!snapshot.exists) {
    return { status: 404, body: { code: 'missing', error: '這份分享不存在或已撤回。' } };
  }
  const data = snapshot.data();
  if (data.revoked !== false) {
    return { status: 410, body: { code: 'revoked', error: '這份分享已撤回。' } };
  }
  const expires = data.expiresAt?.toMillis?.();
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return { status: 410, body: { code: 'expired', error: '這份分享已過期。' } };
  }
  return {
    status: 200,
    body: {
      schoolId: typeof data.schoolId === 'string' ? data.schoolId : null,
      name: typeof data.name === 'string' ? data.name : '課表',
      courses: publicCourses(data.courses),
      meta: publicMeta(data.meta),
      expiresAt: new Date(expires).toISOString(),
    },
  };
}

function createCreateTimetableShareHandler({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入再建立分享連結。');
    const schoolId = requireSchoolId(request.data?.schoolId);
    const record = await loadShareableTimetable(db, uid, schoolId);
    // 分享出去的資料不帶老師姓名
    const courses = publicCourses(record.courses);
    if (!courses.length) throw new HttpsError('failed-precondition', '課表是空的，沒有可分享的內容。');
    const token = nodeCrypto.randomBytes(16).toString('base64url');
    const expiresAt = Timestamp.fromMillis(Date.now() + SHARE_TTL_MS);
    // 擁有者另外存在只有伺服器讀得到的地方，拿到分享碼的人看不到帳號
    await db.collection('timetableShareOwners').doc(token).set({
      ownerUid: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    await db.collection('timetableShares').doc(token).set({
      schoolId,
      name: optionalText(record.meta?.title || request.data?.name, 40) || '課表',
      courses,
      meta: publicMeta(record.meta),
      publicSchemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      revoked: false,
    });
    return { token, expiresAt: expiresAt.toDate().toISOString(), path: `/timetable/s/${token}` };
  };
}

function createRevokeTimetableShareHandler({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
    const token = text(request.data?.token, 80, 'token');
    const ref = db.collection('timetableShares').doc(token);
    const [snapshot, owner] = await Promise.all([
      ref.get(),
      db.collection('timetableShareOwners').doc(token).get(),
    ]);
    const ownerUid = owner.exists ? owner.data()?.ownerUid : snapshot.data()?.ownerUid;
    if (!snapshot.exists || ownerUid !== uid) {
      throw new HttpsError('not-found', '找不到這份分享連結。');
    }
    await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  };
}

function createGetTimetableShareHandler({ db }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: '請用 GET 讀取分享課表。' });
      return;
    }
    const token = String(req.query?.token || req.body?.token || '').trim();
    const { status, body } = await readPublicTimetableShare(db, token);
    res.status(status).json(body);
  };
}

module.exports = {
  cleanCourse,
  readPublicTimetableShare,
  createCreateTimetableShareHandler,
  createRevokeTimetableShareHandler,
  createGetTimetableShareHandler,
};
