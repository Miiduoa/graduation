import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from './httpsError';
import type { CallableRequest } from './groupInviteHandlers';

const LEAVE_KINDS = new Set([
  'sick', 'personal', 'family', 'official', 'menstrual', 'mental', 'bereavement', 'other',
]);
const LEAVE_PERIODS = new Set(['all', 'morning', 'afternoon']);
const REVIEW_STATUSES = new Set(['approved', 'rejected']);
const SCHOOL_ID = /^[a-z0-9_-]{1,80}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{12,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type DocSnapshot = {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown>;
};

type QuerySnapshot = {
  docs: Array<{ id: string; data: () => Record<string, unknown> }>;
};

export type LeaveDocRef = {
  id: string;
  path?: string;
  get: () => Promise<DocSnapshot>;
};

export type LeaveQueryRef = {
  where: (field: string, op: string, value: unknown) => LeaveQueryRef;
  orderBy: (field: string, direction?: string) => LeaveQueryRef;
  limit: (count: number) => LeaveQueryRef;
  get: () => Promise<QuerySnapshot>;
};

type LeaveTransaction = {
  get: (ref: LeaveDocRef) => Promise<DocSnapshot>;
  create: (ref: LeaveDocRef, data: Record<string, unknown>) => void;
  update: (ref: LeaveDocRef, data: Record<string, unknown>) => void;
};

export type LeaveFirestore = {
  doc: (path: string) => LeaveDocRef;
  collection: (path: string) => LeaveQueryRef;
  runTransaction: <T>(fn: (transaction: LeaveTransaction) => Promise<T>) => Promise<T>;
};

type LeaveCourseRow = {
  courseId: string;
  courseName: string;
  offeringId: string;
  reviewStatus: string;
  reviewerNote: string;
  reviewedBy: string;
  reviewedAt: unknown;
};

function fail(code: ConstructorParameters<typeof HttpsError>[0], message: string): never {
  throw new HttpsError(code, message);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string'
    ? [...value].filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    }).join('').trim().slice(0, max)
    : '';
}

function schoolIdOf(value: unknown): string {
  const id = text(value, 80);
  if (!SCHOOL_ID.test(id)) fail('invalid-argument', '請先選擇有效的學校。');
  return id;
}

function requestIdOf(value: unknown): string {
  const id = text(value, 64);
  if (!REQUEST_ID.test(id)) fail('invalid-argument', '申請編號格式錯誤，請重新開啟表單。');
  return id;
}

function dateMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.getTime()
    : null;
}

export function normalizeDates(startDate: unknown, endDate: unknown): {
  startDate: string;
  endDate: string;
} {
  const start = dateMillis(startDate);
  const end = dateMillis(endDate);
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    start === null ||
    end === null ||
    end < start ||
    end - start > 30 * 86400000
  ) {
    fail('invalid-argument', '日期不正確；一次請假期間最多 31 天。');
  }
  return { startDate, endDate };
}

function offeringIdOf(course: { name?: unknown; teacher?: unknown }): string {
  const clean = (value: unknown) => String(value || '').trim().replace(/\//g, '／').replace(/\s+/g, ' ');
  return clean(course.name) + '｜' + (clean(course.teacher) || '老師未填');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function activeMember(member: DocSnapshot, account: DocSnapshot): Record<string, unknown> {
  if (!member.exists || member.data().status !== 'active') {
    fail('permission-denied', '請使用目前學校的有效學校帳號。');
  }
  const profile = account.exists ? account.data() : {};
  if (profile.accountDeletionInProgress === true || profile.status === 'deleted') {
    fail('failed-precondition', '帳號正在刪除或已停用。');
  }
  return member.data();
}

function uidOf(request: CallableRequest): string {
  const uid = request.auth && request.auth.uid;
  if (!uid) fail('unauthenticated', '請先登入學校帳號。');
  return uid;
}

function inputOf(data: unknown) {
  const record = asRecord(data);
  const schoolId = schoolIdOf(record.schoolId);
  const requestId = requestIdOf(record.requestId);
  const { startDate, endDate } = normalizeDates(record.startDate, record.endDate);
  const kind = text(record.kind, 30);
  const period = text(record.period, 30);
  const detail = text(record.detail, 500);
  const requestedCourses = Array.isArray(record.courseIds) ? record.courseIds : [];
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
  return {
    schoolId,
    requestId,
    startDate,
    endDate,
    kind,
    period,
    detail,
    requestedCourses: requestedCourses as string[],
  };
}

export function matchingCourses(
  timetable: { exists: boolean; data: () => Record<string, unknown> } | null | undefined,
  schoolId: string,
  courseIds: string[],
): LeaveCourseRow[] {
  const data = timetable?.exists ? timetable.data() : null;
  if (!data || data.schoolId !== schoolId || !Array.isArray(data.courses)) {
    fail('failed-precondition', '這所學校的課表還沒同步，請先儲存課表再送出。');
  }
  return courseIds.map((id) => {
    const row = (data.courses as unknown[]).find((course) => {
      const item = asRecord(course);
      return item && item.id === id;
    });
    const course = asRecord(row);
    if (!row || typeof course.name !== 'string' || !course.name.trim()) {
      fail('failed-precondition', '所選課程已不在這所學校的課表裡，請重新選擇。');
    }
    return {
      courseId: id,
      courseName: text(course.name, 100),
      offeringId: offeringIdOf(course),
      reviewStatus: 'pending',
      reviewerNote: '',
      reviewedBy: '',
      reviewedAt: null,
    };
  });
}

export function summarize(courses: Array<{ reviewStatus?: string }>): 'pending' | 'completed' | 'partial' {
  const reviewed = courses.filter((course) => course.reviewStatus !== 'pending').length;
  if (reviewed === 0) return 'pending';
  return reviewed === courses.length ? 'completed' : 'partial';
}

function event(action: string, actorUid: string, at: Date, courseId = '') {
  return { action, actorUid, at: at.toISOString(), courseId };
}

function courseRows(value: unknown): LeaveCourseRow[] {
  return Array.isArray(value) ? value.map((item) => {
    const row = asRecord(item);
    return {
      courseId: String(row.courseId || ''),
      courseName: String(row.courseName || ''),
      offeringId: String(row.offeringId || ''),
      reviewStatus: String(row.reviewStatus || ''),
      reviewerNote: String(row.reviewerNote || ''),
      reviewedBy: String(row.reviewedBy || ''),
      reviewedAt: row.reviewedAt ?? null,
    };
  }) : [];
}

function createSubmitLeaveHandler({ db, clock }: { db: LeaveFirestore; clock: () => Date }) {
  return async (request: CallableRequest) => {
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
          const savedCourses = courseRows(saved.courses);
          if (
            saved.startDate === input.startDate && saved.endDate === input.endDate &&
            saved.kind === input.kind && saved.period === input.period && saved.detail === input.detail &&
            JSON.stringify(savedCourses.map((course) => course.courseId)) === JSON.stringify(input.requestedCourses)
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

function createWithdrawLeaveHandler({ db, clock }: { db: LeaveFirestore; clock: () => Date }) {
  return async (request: CallableRequest) => {
    const uid = uidOf(request);
    const id = requestIdOf(asRecord(request.data).requestId);
    const ref = db.doc('leaveRequests/' + id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().uid !== uid) fail('not-found', '找不到這筆申請。');
      const data = snap.data();
      const [member, account] = await Promise.all([
        tx.get(db.doc('schools/' + String(data.schoolId) + '/members/' + uid)),
        tx.get(db.doc('users/' + uid)),
      ]);
      activeMember(member, account);
      if (data.source !== 'campus-one') {
        fail('failed-precondition', '此紀錄屬於其他請假系統，不能在 Campus One 撤回。');
      }
      if (data.status === 'withdrawn') return { id, status: 'withdrawn' };
      if (data.status !== 'pending') {
        fail('failed-precondition', '已有老師核閱，請聯絡處理人員修正。');
      }
      tx.update(ref, {
        status: 'withdrawn',
        events: [...(Array.isArray(data.events) ? data.events : []), event('withdrawn', uid, clock())].slice(-60),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: 'withdrawn' };
    });
  };
}

function createReviewLeaveHandler({ db, clock }: { db: LeaveFirestore; clock: () => Date }) {
  return async (request: CallableRequest) => {
    const uid = uidOf(request);
    const payload = asRecord(request.data);
    const id = requestIdOf(payload.requestId);
    const courseId = text(payload.courseId, 100);
    const decision = text(payload.decision, 20);
    const note = text(payload.note, 500);
    if (!courseId || !REVIEW_STATUSES.has(decision)) {
      fail('invalid-argument', '請選擇課程和審核結果。');
    }
    if (decision === 'rejected' && note.length < 2) {
      fail('invalid-argument', '不同意時，請提供至少兩個字的原因。');
    }
    const ref = db.doc('leaveRequests/' + id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', '找不到這筆申請。');
      const data = snap.data();
      if (data.source !== 'campus-one' || !Array.isArray(data.courses)) {
        fail('failed-precondition', '此紀錄不屬於 Campus One 站內請假流程。');
      }
      if (data.status === 'withdrawn') fail('failed-precondition', '這筆請假已撤回。');
      const course = data.courses.find((item) => asRecord(item).courseId === courseId);
      if (!course) fail('not-found', '這筆申請沒有該課程。');
      const courseRecord = asRecord(course);
      const [member, account] = await Promise.all([
        tx.get(db.doc('schools/' + String(data.schoolId) + '/members/' + uid)),
        tx.get(db.doc('users/' + uid)),
      ]);
      const schoolMember = activeMember(member, account);
      if (schoolMember.role !== 'admin') {
        const assignment = await tx.get(db.doc(
          'schools/' + String(data.schoolId) + '/courseTeachers/' + String(courseRecord.offeringId),
        ));
        const assigned = assignment.exists ? assignment.data() : {};
        if (
          !assignment.exists ||
          !Array.isArray(assigned.teacherUids) ||
          !assigned.teacherUids.includes(uid)
        ) {
          fail('permission-denied', '目前沒有這門課的審核權限。');
        }
      }
      if (courseRecord.reviewStatus !== 'pending') {
        fail('failed-precondition', '這門課已處理，請更新列表。');
      }
      const time = clock();
      const nextCourses = data.courses.map((item) => {
        const row = asRecord(item);
        return row.courseId === courseId
          ? { ...row, reviewStatus: decision, reviewerNote: note, reviewedBy: uid, reviewedAt: time }
          : item;
      });
      tx.update(ref, {
        courses: nextCourses,
        status: summarize(nextCourses.map((item) => asRecord(item))),
        events: [...(Array.isArray(data.events) ? data.events : []), event(decision, uid, time, courseId)].slice(-60),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { id, status: summarize(nextCourses.map((item) => asRecord(item))) };
    });
  };
}

async function reviewerAccess(db: LeaveFirestore, schoolId: string, uid: string) {
  const [member, account] = await Promise.all([
    db.doc('schools/' + schoolId + '/members/' + uid).get(),
    db.doc('users/' + uid).get(),
  ]);
  const schoolMember = activeMember(member, account);
  if (schoolMember.role === 'admin') return { admin: true, offerings: new Set<string>() };
  const snap = await db.collection('schools/' + schoolId + '/courseTeachers')
    .where('teacherUids', 'array-contains', uid).get();
  const offerings = new Set(snap.docs.map((row) => row.id));
  if (!offerings.size) fail('permission-denied', '這間學校尚未指派你審核課程請假。');
  return { admin: false, offerings };
}

function iso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function createListReviewLeavesHandler({ db }: { db: LeaveFirestore }) {
  return async (request: CallableRequest) => {
    const uid = uidOf(request);
    const schoolId = schoolIdOf(asRecord(request.data).schoolId);
    const access = await reviewerAccess(db, schoolId, uid);
    const snap = await db.collection('leaveRequests')
      .where('schoolId', '==', schoolId).where('source', '==', 'campus-one')
      .orderBy('createdAt', 'desc').limit(150).get();
    const permitted = snap.docs.map((row) => {
      const data = row.data();
      const courses = courseRows(data.courses);
      if (data.source !== 'campus-one' || !Array.isArray(data.courses)) return null;
      const visible = courses.filter(
        (course) => access.admin || access.offerings.has(course.offeringId),
      );
      if (!visible.length) return null;
      return { id: row.id, ...data, courses: visible };
    }).filter(Boolean) as Array<Record<string, unknown> & { id: string; courses: LeaveCourseRow[] }>;
    const students = new Map<string, string>();
    await Promise.all([...new Set(permitted.map((row) => String(row.uid || '')))].map(async (studentUid) => {
      if (!studentUid) return;
      const profile = await db.doc('users/' + studentUid).get();
      students.set(studentUid, profile.exists ? text(profile.data().displayName, 60) : '');
    }));

    const current = await reviewerAccess(db, schoolId, uid);
    if ((access.admin && !current.admin) ||
      (!current.admin && [...access.offerings].some((id) => !current.offerings.has(id)))) {
      fail('permission-denied', '審核權限已變更，請重新整理。');
    }
    return {
      rows: permitted.map((row) => ({
        id: row.id,
        studentName: students.get(String(row.uid)) || '同學',
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

export function createLeaveRequestHandlers({
  db,
  clock = () => new Date(),
}: {
  db: LeaveFirestore;
  clock?: () => Date;
}) {
  return {
    submitLeaveRequest: createSubmitLeaveHandler({ db, clock }),
    withdrawLeaveRequest: createWithdrawLeaveHandler({ db, clock }),
    reviewLeaveRequest: createReviewLeaveHandler({ db, clock }),
    listLeaveReviewQueue: createListReviewLeavesHandler({ db }),
  };
}
