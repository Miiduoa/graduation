'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

const LEAVE_KINDS = new Set([
  'sick', 'personal', 'family', 'official', 'menstrual', 'mental', 'bereavement', 'other',
]);
const LEAVE_PERIODS = new Set(['all', 'morning', 'afternoon']);
const REVIEW_STATUSES = new Set(['approved', 'rejected']);
const SCHOOL_ID = /^[a-z0-9_-]{1,80}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{12,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function fail(code, message) {
  throw new HttpsError(code, message);
}

function text(value, max) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
    : '';
}

function schoolIdOf(value) {
  const id = text(value, 80);
  if (!SCHOOL_ID.test(id)) fail('invalid-argument', '請先選擇有效的學校。');
  return id;
}

function requestIdOf(value) {
  const id = text(value, 64);
  if (!REQUEST_ID.test(id)) fail('invalid-argument', '申請編號格式錯誤，請重新開啟表單。');
  return id;
}

function dateMillis(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.getTime()
    : null;
}

function normalizeDates(startDate, endDate) {
  const start = dateMillis(startDate);
  const end = dateMillis(endDate);
  if (start === null || end === null || end < start || end - start > 30 * 86400000) {
    fail('invalid-argument', '日期不正確；一次請假期間最多 31 天。');
  }
  return { startDate, endDate };
}

function offeringIdOf(course) {
  const clean = (value) => String(value || '').trim().replace(/\//g, '／').replace(/\s+/g, ' ');
  return clean(course.name) + '｜' + (clean(course.teacher) || '老師未填');
}

function activeMember(member, account) {
  if (!member.exists || member.data().status !== 'active') {
    fail('permission-denied', '請使用目前學校的有效學校帳號。');
  }
  const profile = account.exists ? account.data() : {};
  if (profile.accountDeletionInProgress === true || profile.status === 'deleted') {
    fail('failed-precondition', '帳號正在刪除或已停用。');
  }
  return member.data();
}

function uidOf(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) fail('unauthenticated', '請先登入學校帳號。');
  return uid;
}

function inputOf(data) {
  const schoolId = schoolIdOf(data?.schoolId);
  const requestId = requestIdOf(data?.requestId);
  const { startDate, endDate } = normalizeDates(data?.startDate, data?.endDate);
  const kind = text(data?.kind, 30);
  const period = text(data?.period, 30);
  const detail = text(data?.detail, 500);
  const requestedCourses = Array.isArray(data?.courseIds) ? data.courseIds : [];
  if (!LEAVE_KINDS.has(kind) || !LEAVE_PERIODS.has(period)) {
    fail('invalid-argument', '請選擇假別與請假時段。');
  }
  if (
    !requestedCourses.length || requestedCourses.length > 20 ||
    requestedCourses.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(id)) ||
    new Set(requestedCourses).size !== requestedCourses.length
  ) {
    fail('invalid-argument', '請從本人課表選擇 1 至 20 門課。');
  }
  return { schoolId, requestId, startDate, endDate, kind, period, detail, requestedCourses };
}

function matchingCourses(timetable, schoolId, courseIds) {
  const data = timetable?.exists ? timetable.data() : null;
  if (!data || data.schoolId !== schoolId || !Array.isArray(data.courses)) {
    fail('failed-precondition', '這所學校的課表還沒同步，請先儲存課表再送出。');
  }
  return courseIds.map((id) => {
    const row = data.courses.find((course) => course && course.id === id);
    if (!row || typeof row.name !== 'string' || !row.name.trim()) {
      fail('failed-precondition', '所選課程已不在這所學校的課表裡，請重新選擇。');
    }
    return {
      courseId: id,
      courseName: text(row.name, 100),
      offeringId: offeringIdOf(row).slice(0, 210),
      reviewStatus: 'pending',
      reviewerNote: '',
      reviewedBy: '',
      reviewedAt: null,
    };
  });
}

function summarize(courses) {
  const reviewed = courses.filter((course) => course.reviewStatus !== 'pending').length;
  if (reviewed === 0) return 'pending';
  return reviewed === courses.length ? 'completed' : 'partial';
}

function event(action, actorUid, at, courseId = '') {
  return { action, actorUid, at: at.toISOString(), courseId };
}

function createSubmitLeaveHandler({ db, clock = () => new Date() }) {
  return async (request) => {
    const uid = uidOf(request);
    const input = inputOf(request.data);
    const base = 'users/' + uid + '/schools/' + input.schoolId + '/personalTimetable/current';
    const canonicalRef = db.doc(base);
    const legacyRef = db.doc('users/' + uid + '/personalTimetable/current');
    const memberRef = db.doc('schools/' + input.schoolId + '/members/' + uid);
    const accountRef = db.doc('users/' + uid);
    const ref = db.doc('leaveRequests/' + input.requestId);
    return db.runTransaction(async (tx) => {
      const [existing, member, account, canonical] = await Promise.all([
        tx.get(ref), tx.get(memberRef), tx.get(accountRef), tx.get(canonicalRef),
      ]);
      activeMember(member, account);
      if (existing.exists) {
        const saved = existing.data();
        if (saved.uid === uid && saved.schoolId === input.schoolId) {
          // The same submit attempt can be repeated after a network timeout.
          if (
            saved.startDate === input.startDate && saved.endDate === input.endDate &&
            saved.kind === input.kind && saved.period === input.period && saved.detail === input.detail &&
            JSON.stringify(saved.courses.map((course) => course.courseId)) === JSON.stringify(input.requestedCourses)
          ) return { id: ref.id, alreadySubmitted: true };
        }
        fail('already-exists', '這個申請編號已被使用，請重新填寫。');
      }
      const timetable = canonical.exists ? canonical : await tx.get(legacyRef);
      const courses = matchingCourses(timetable, input.schoolId, input.requestedCourses);
      const time = clock();
      tx.create(ref, {
        uid,
        schoolId: input.schoolId,
        kind: input.kind,
        period: input.period,
        startDate: input.startDate,
        endDate: input.endDate,
        detail: input.detail,
        courses,
        status: 'pending',
        source: 'campus-one',
        officialSubmitted: false,
        events: [event('submitted', uid, time)],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id: ref.id, alreadySubmitted: false };
    });
  };
}

function createWithdrawLeaveHandler({ db, clock = () => new Date() }) {
  return async (request) => {
    const uid = uidOf(request);
    const id = requestIdOf(request.data?.requestId);
    const ref = db.doc('leaveRequests/' + id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().uid !== uid) fail('not-found', '找不到這筆申請。');
      const data = snap.data();
      const [member, account] = await Promise.all([
        tx.get(db.doc('schools/' + data.schoolId + '/members/' + uid)),
        tx.get(db.doc('users/' + uid)),
      ]);
      activeMember(member, account);
      if (data.status === 'withdrawn') return { id, status: 'withdrawn' };
      if (data.status !== 'pending') {
        fail('failed-precondition', '已有老師核閱，請聯絡處理人員修正。');
      }
      tx.update(ref, {
        status: 'withdrawn',
        events: [...(data.events || []), event('withdrawn', uid, clock())].slice(-60),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: 'withdrawn' };
    });
  };
}

function createReviewLeaveHandler({ db, clock = () => new Date() }) {
  return async (request) => {
    const uid = uidOf(request);
    const id = requestIdOf(request.data?.requestId);
    const courseId = text(request.data?.courseId, 100);
    const decision = text(request.data?.decision, 20);
    const note = text(request.data?.note, 500);
    if (!courseId || !REVIEW_STATUSES.has(decision)) {
      fail('invalid-argument', '請選擇課程和審核結果。');
    }
    const ref = db.doc('leaveRequests/' + id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', '找不到這筆申請。');
      const data = snap.data();
      if (data.status === 'withdrawn') fail('failed-precondition', '這筆請假已撤回。');
      const course = data.courses?.find((item) => item.courseId === courseId);
      if (!course) fail('not-found', '這筆申請沒有該課程。');
      const [member, account] = await Promise.all([
        tx.get(db.doc('schools/' + data.schoolId + '/members/' + uid)),
        tx.get(db.doc('users/' + uid)),
      ]);
      const schoolMember = activeMember(member, account);
      if (schoolMember.role !== 'admin') {
        const assignment = await tx.get(db.doc(
          'schools/' + data.schoolId + '/courseTeachers/' + course.offeringId,
        ));
        if (!assignment.exists || !Array.isArray(assignment.data().teacherUids) ||
          !assignment.data().teacherUids.includes(uid)) {
          fail('permission-denied', '目前沒有這門課的審核權限。');
        }
      }
      if (course.reviewStatus !== 'pending') {
        fail('failed-precondition', '這門課已處理，請更新列表。');
      }
      const time = clock();
      const courses = data.courses.map((item) => item.courseId === courseId
        ? { ...item, reviewStatus: decision, reviewerNote: note, reviewedBy: uid, reviewedAt: time }
        : item);
      tx.update(ref, {
        courses,
        status: summarize(courses),
        events: [...(data.events || []), event(decision, uid, time, courseId)].slice(-60),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: summarize(courses) };
    });
  };
}

async function reviewerAccess(db, schoolId, uid) {
  const [member, account] = await Promise.all([
    db.doc('schools/' + schoolId + '/members/' + uid).get(),
    db.doc('users/' + uid).get(),
  ]);
  const schoolMember = activeMember(member, account);
  if (schoolMember.role === 'admin') return { admin: true, offerings: new Set() };
  const snap = await db.collection('schools/' + schoolId + '/courseTeachers')
    .where('teacherUids', 'array-contains', uid).get();
  const offerings = new Set(snap.docs.map((row) => row.id));
  if (!offerings.size) fail('permission-denied', '這間學校尚未指派你審核課程請假。');
  return { admin: false, offerings };
}

function iso(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function createListReviewLeavesHandler({ db }) {
  return async (request) => {
    const uid = uidOf(request);
    const schoolId = schoolIdOf(request.data?.schoolId);
    const access = await reviewerAccess(db, schoolId, uid);
    const snap = await db.collection('leaveRequests')
      .where('schoolId', '==', schoolId).orderBy('createdAt', 'desc').limit(150).get();
    const permitted = snap.docs.map((row) => {
      const data = row.data();
      const courses = (data.courses || []).filter(
        (course) => access.admin || access.offerings.has(course.offeringId),
      );
      if (!courses.length) return null;
      return { id: row.id, ...data, courses };
    }).filter(Boolean);
    // Re-check authorisation after reading private request data.
    const current = await reviewerAccess(db, schoolId, uid);
    if ((access.admin && !current.admin) ||
      (!current.admin && [...access.offerings].some((id) => !current.offerings.has(id)))) {
      fail('permission-denied', '審核權限已變更，請重新整理。');
    }
    const students = new Map();
    await Promise.all([...new Set(permitted.map((row) => row.uid))].map(async (studentUid) => {
      const profile = await db.doc('users/' + studentUid).get();
      students.set(studentUid, profile.exists ? text(profile.data().displayName, 60) : '');
    }));
    return {
      rows: permitted.map((row) => ({
        id: row.id,
        studentName: students.get(row.uid) || '同學',
        kind: row.kind,
        period: row.period,
        startDate: row.startDate,
        endDate: row.endDate,
        detail: row.detail,
        status: row.status,
        courses: row.courses.map((course) => ({
          courseId: course.courseId,
          courseName: course.courseName,
          offeringId: course.offeringId,
          reviewStatus: course.reviewStatus,
          reviewerNote: course.reviewerNote,
          reviewedAt: iso(course.reviewedAt),
        })),
        createdAt: iso(row.createdAt),
      })),
    };
  };
}

module.exports = {
  createSubmitLeaveHandler,
  createWithdrawLeaveHandler,
  createReviewLeaveHandler,
  createListReviewLeavesHandler,
  normalizeDates,
  matchingCourses,
  summarize,
};
