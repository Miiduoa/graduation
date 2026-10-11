'use strict';

const { HttpsError } = require('firebase-functions/v2/https');

/**
 * 老師工作台的申訴清單。學生的名字和學號只有伺服器讀得到，所以由這裡補上再回傳；
 * 規則不用放寬讓老師讀學生的個人資料。
 * 學校管理者看全校；老師只看 schools/{schoolId}/courseTeachers（以開課代號「課名｜老師」為編號）裡有自己的課。
 */

function isoOf(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** 學號：個人資料有就用；靜宜登入的帳號是 pu-s1234567；測試帳號用 email 的帳號名。 */
function studentNumberOf(uid, profile) {
  const explicit = profile && (profile.studentId || profile.studentNumber);
  if (explicit) return String(explicit).toUpperCase();
  const fromUid = /^pu-([a-z]\d{6,})$/i.exec(uid || '');
  if (fromUid) return fromUid[1].toUpperCase();
  const local = String((profile && profile.email) || '').split('@')[0];
  if (/^[a-z]\d{6,}$/i.test(local)) return local.toUpperCase();
  return '';
}

function createListTeacherAppealsHandler({ db }) {
  return async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
    const schoolId = String((request.data && request.data.schoolId) || '').trim();
    if (!schoolId || schoolId.includes('/') || schoolId.length > 80) {
      throw new HttpsError('invalid-argument', '缺少學校。');
    }
    const member = await db.doc(`schools/${schoolId}/members/${uid}`).get();
    const role = member.exists ? member.data().role : null;
    const active = member.exists && (member.data().status || 'active') === 'active';
    const isEditor = active && (role === 'admin' || role === 'editor');
    if (!active || (!isEditor && role !== 'teacher')) {
      throw new HttpsError('permission-denied', '這頁給老師用。');
    }

    let courses = null;
    let docs = [];
    if (isEditor) {
      const snap = await db.collection('courseAppeals').where('schoolId', '==', schoolId).get();
      docs = snap.docs;
    } else {
      const mine = await db
        .collection(`schools/${schoolId}/courseTeachers`)
        .where('teacherUids', 'array-contains', uid)
        .get();
      // 文件編號是開課代號（課名｜老師），同名但不同老師的課分得開
      const offeringIds = mine.docs.map((item) => item.id);
      courses = offeringIds.map((id) => {
        const [name, teacher] = id.split('｜');
        return teacher ? `${name}（${teacher}）` : name;
      });
      for (const offeringId of offeringIds) {
        const snap = await db
          .collection('courseAppeals')
          .where('schoolId', '==', schoolId)
          .where('offeringId', '==', offeringId)
          .get();
        docs.push(...snap.docs);
      }
    }

    const studentUids = [...new Set(docs.map((item) => item.data().studentUid).filter(Boolean))];
    const profiles = new Map();
    await Promise.all(
      studentUids.map(async (studentUid) => {
        const snap = await db.doc(`users/${studentUid}`).get();
        profiles.set(studentUid, snap.exists ? snap.data() : null);
      }),
    );

    const rows = docs.map((item) => {
      const data = item.data();
      const profile = profiles.get(data.studentUid) || null;
      return {
        id: item.id,
        courseName: data.courseName || '',
        title: data.title || '',
        body: data.body || '',
        status: data.status || 'pending',
        teacherNote: data.teacherNote || '',
        createdAt: isoOf(data.createdAt),
        updatedAt: isoOf(data.updatedAt),
        studentName: (profile && profile.displayName) || '同學',
        studentNumber: studentNumberOf(data.studentUid, profile),
      };
    });
    return { courses, rows };
  };
}

module.exports = { createListTeacherAppealsHandler, studentNumberOf };
