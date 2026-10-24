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

async function loadTeacherAppealAccess(db, schoolId, uid) {
  const [member, account] = await Promise.all([
    db.doc(`schools/${schoolId}/members/${uid}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  if (!member.exists || member.data().status !== 'active') {
    throw new HttpsError('permission-denied', '不是這間學校的有效成員。');
  }
  const profile = account.exists ? account.data() : {};
  if (profile.accountDeletionInProgress === true || profile.status === 'deleted') {
    throw new HttpsError('failed-precondition', '帳號正在刪除或已停用。');
  }
  if (member.data().role === 'admin') return { isAdmin: true, offeringIds: [] };
  const assigned = await db
    .collection(`schools/${schoolId}/courseTeachers`)
    .where('teacherUids', 'array-contains', uid)
    .get();
  if (assigned.docs.length === 0) {
    throw new HttpsError('permission-denied', '你尚未被指派處理這間學校的課程申訴。');
  }
  return { isAdmin: false, offeringIds: assigned.docs.map((item) => item.id) };
}

function createListTeacherAppealsHandler({ db }) {
  return async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
    const schoolId = String((request.data && request.data.schoolId) || '').trim();
    if (!schoolId || schoolId.includes('/') || schoolId.length > 80) {
      throw new HttpsError('invalid-argument', '缺少學校。');
    }
    const access = await loadTeacherAppealAccess(db, schoolId, uid);

    let courses = null;
    let docs = [];
    if (access.isAdmin) {
      const snap = await db.collection('courseAppeals').where('schoolId', '==', schoolId).get();
      docs = snap.docs;
    } else {
      // 文件編號是開課代號（課名｜老師），同名但不同老師的課分得開
      const offeringIds = access.offeringIds;
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

    // Membership, account availability or the trusted teaching assignment can
    // be revoked while the student profiles are loading. Do not return old scope.
    const current = await loadTeacherAppealAccess(db, schoolId, uid);
    if (
      (access.isAdmin && !current.isAdmin) ||
      (!current.isAdmin && access.offeringIds.some((id) => !current.offeringIds.includes(id)))
    ) {
      throw new HttpsError('permission-denied', '課程申訴權限已變更，請重新讀取。');
    }

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

/**
 * 學生端：自己課表裡的課有沒有對應老師。只回 true/false，不回老師是誰；
 * 只查得到自己課表（offeringIds）裡、或自己申訴過的開課，其他代號一律當作沒有。
 */
function createAppealTeacherStatusHandler({ db }) {
  return async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '請先登入。');
    const schoolId = String((request.data && request.data.schoolId) || '').trim();
    if (!schoolId || schoolId.includes('/') || schoolId.length > 80) {
      throw new HttpsError('invalid-argument', '缺少學校。');
    }
    const asked = Array.isArray(request.data && request.data.offeringIds) ? request.data.offeringIds : [];
    const member = await db.doc(`schools/${schoolId}/members/${uid}`).get();
    if (!member.exists || (member.data().status || 'active') !== 'active') {
      throw new HttpsError('permission-denied', '不是這間學校的成員。');
    }
    const timetable = await db.doc(`users/${uid}/personalTimetable/current`).get();
    const own = new Set((timetable.exists && timetable.data().offeringIds) || []);
    // 自己送過的申訴（課後來從課表拿掉了）也查得到
    const mine = await db
      .collection('courseAppeals')
      .where('schoolId', '==', schoolId)
      .where('studentUid', '==', uid)
      .get();
    for (const item of mine.docs) if (item.data().offeringId) own.add(item.data().offeringId);
    const ids = [...new Set(asked.map((id) => String(id || '')))]
      .filter((id) => id && !id.includes('/') && id.length <= 200 && own.has(id))
      .slice(0, 80);
    const assigned = {};
    await Promise.all(
      ids.map(async (id) => {
        const snap = await db.doc(`schools/${schoolId}/courseTeachers/${id}`).get();
        const teachers = snap.exists ? snap.data().teacherUids : null;
        assigned[id] = Array.isArray(teachers) && teachers.length > 0;
      }),
    );
    return { assigned };
  };
}

module.exports = { createListTeacherAppealsHandler, createAppealTeacherStatusHandler, studentNumberOf };
