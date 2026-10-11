'use strict';

const nodeCrypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

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

function cleanCourse(input = {}) {
  let day = Number(input.day);
  let start = Number(input.start);
  let end = Number(input.end);
  if (!Number.isInteger(day) || day < 0 || day > 5) day = 0;
  if (day === 0) {
    start = 0;
    end = 0;
  } else {
    if (!Number.isInteger(start) || start < 1 || start > 13) start = 1;
    if (!Number.isInteger(end) || end < start || end > 13) end = start;
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

function publicShare(data) {
  return {
    name: data.name || '課表',
    courses: Array.isArray(data.courses) ? data.courses : [],
    meta: data.meta || {},
    expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null,
  };
}

function createCreateTimetableShareHandler({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入再建立分享連結。');
    const schoolId = text(request.data?.schoolId || 'personal', 80, 'schoolId');
    const timetableRef = db.collection('users').doc(uid).collection('personalTimetable').doc('current');
    const snapshot = await timetableRef.get();
    if (!snapshot.exists) throw new HttpsError('not-found', '還沒有可分享的課表。');
    const record = snapshot.data() || {};
    // 分享出去的資料不帶老師姓名
    const courses = Array.isArray(record.courses)
      ? record.courses.slice(0, MAX_COURSES).map((course) => ({ ...cleanCourse(course), teacher: '' }))
      : [];
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
      meta: record.meta || {},
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
    if (!token || token.length > 80 || token.includes('/')) {
      res.status(400).json({ error: '分享碼不正確。' });
      return;
    }
    const snapshot = await db.collection('timetableShares').doc(token).get();
    if (!snapshot.exists) {
      res.status(404).json({ error: '這份分享不存在或已撤回。' });
      return;
    }
    const data = snapshot.data();
    if (data.revoked === true) {
      res.status(410).json({ error: '這份分享已撤回。' });
      return;
    }
    const expires = data.expiresAt?.toMillis?.() || 0;
    if (!expires || expires <= Date.now()) {
      res.status(410).json({ error: '這份分享已過期。' });
      return;
    }
    res.status(200).json(publicShare(data));
  };
}

module.exports = {
  cleanCourse,
  createCreateTimetableShareHandler,
  createRevokeTimetableShareHandler,
  createGetTimetableShareHandler,
};
