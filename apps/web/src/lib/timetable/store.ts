'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  assertClassExceptions,
  classExceptionsForStorage,
  assertTimetableStorageSize,
  MEETUP_DURATION_MINUTES,
  cleanCourses,
  cleanMeta,
  courseOfferingId,
  meetupDocId,
  periodAt,
  timetableIndex,
  type PersonalCourse,
  type TimetableMeta,
} from '@campus/shared';
import {
  getAuth,
  getCloudFunctionUrl,
  getDb,
  getFunctionsInstance,
  isFirebaseConfigured,
} from '@/lib/firebase';
import { areFunctionsConfigured, FunctionsUnconfiguredError } from '@/lib/functionsUrl';

const LOCAL_KEY = 'campus-one-personal-timetable';

export type StoredTimetable = {
  classExceptions?: import('@campus/shared').ClassException[];
  courses: PersonalCourse[];
  meta: TimetableMeta;
  shareWithFriends: boolean;
  updatedAt: string;
  schoolId: string;
};

function emptyTimetable(schoolId: string): StoredTimetable {
  return {
    courses: [],
    meta: cleanMeta({}),
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId,
  };
}

/** Corrupted on-device records are not an empty timetable. Never overwrite them silently. */
export class TimetableLocalReadError extends Error {
  constructor(readonly reason: 'corrupt' | 'unavailable') {
    super(
      reason === 'corrupt'
        ? '這台裝置的課表資料格式異常，原始資料仍保留。請勿清除瀏覽器資料。'
        : '目前無法讀取這台裝置的課表，請確認瀏覽器儲存權限。',
    );
    this.name = 'TimetableLocalReadError';
  }
}

type LocalTimetableRead = {
  timetable: StoredTimetable;
  // Only an actual current-school record may compete with a cloud copy.
  found: boolean;
  scoped: boolean;
  recordedAt: number;
};

function hasTimetableContent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Partial<StoredTimetable>;
  try { assertClassExceptions(data.classExceptions); } catch { return false; }
  return (
    Array.isArray(data.courses) &&
    data.courses.length <= 80 &&
    data.courses.every((row) => row && typeof row === 'object' && !Array.isArray(row)) &&
    (data.meta === undefined ||
      (!!data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)))
  );
}

function readLocalSnapshot(ownerKey: string, schoolId: string): LocalTimetableRead {
  let scopedRaw: string | null;
  let legacyRaw: string | null;
  try {
    scopedRaw = localStorage.getItem(`${LOCAL_KEY}:${ownerKey}:${schoolId}`);
    legacyRaw = scopedRaw === null ? localStorage.getItem(`${LOCAL_KEY}:${ownerKey}`) : null;
  } catch {
    throw new TimetableLocalReadError('unavailable');
  }
  const raw = scopedRaw ?? legacyRaw;
  if (raw === null)
    return { timetable: emptyTimetable(schoolId), found: false, scoped: false, recordedAt: 0 };
  let parsed: StoredTimetable;
  try {
    parsed = JSON.parse(raw) as StoredTimetable;
  } catch {
    throw new TimetableLocalReadError('corrupt');
  }
  if (!hasTimetableContent(parsed)) {
    throw new TimetableLocalReadError('corrupt');
  }
  // An unscoped legacy copy without an explicit school must never be claimed.
  // A mismatched scoped copy is potentially damaged and must remain untouched.
  if (parsed.schoolId !== schoolId) {
    if (scopedRaw !== null) throw new TimetableLocalReadError('corrupt');
    return { timetable: emptyTimetable(schoolId), found: false, scoped: false, recordedAt: 0 };
  }
  return {
    timetable: {
      ...emptyTimetable(schoolId),
      ...parsed,
      courses: cleanCourses(parsed.courses),
      meta: cleanMeta(parsed.meta),
      schoolId: parsed.schoolId || schoolId,
    },
    found: true,
    scoped: scopedRaw !== null,
    // Missing timestamps from old records must not inherit the fresh default date.
    recordedAt: savedAtMillis(parsed.updatedAt),
  };
}

function readLocal(ownerKey: string, schoolId: string): StoredTimetable {
  return readLocalSnapshot(ownerKey, schoolId).timetable;
}

export const CLOUD_NEEDS_SCHOOL_COPY = '登入學校帳號後才能存到雲端';
export const CLOUD_NOT_READY_COPY = '這個功能還沒接通，雲端備份先不用。';
export const TIMETABLE_DEVICE_ONLY_SUBMIT_COPY = '存在這台裝置';
export const TIMETABLE_DEVICE_ONLY_STORED_COPY = '已存在這台裝置，換手機或清除瀏覽器資料就會不見';

/** 本機那份已經寫好，只有雲端沒存成。 */
export class TimetableCloudSaveError extends Error {
  constructor(readonly reason: unknown) {
    super('timetable-cloud-save-failed');
    this.name = 'TimetableCloudSaveError';
  }
}

function hasLocal(ownerKey: string, schoolId: string): boolean {
  try {
    return (
      !!localStorage.getItem(`${LOCAL_KEY}:${ownerKey}:${schoolId}`) ||
      !!localStorage.getItem(`${LOCAL_KEY}:${ownerKey}`)
    );
  } catch {
    return false;
  }
}

function savedAtMillis(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function writeLocal(ownerKey: string, timetable: StoredTimetable) {
  localStorage.setItem(`${LOCAL_KEY}:${ownerKey}:${timetable.schoolId}`, JSON.stringify(timetable));
}

function personalTimetableDoc(uid: string, schoolId: string) {
  return doc(getDb(), 'users', uid, 'schools', schoolId, 'personalTimetable', 'current');
}

function legacyPersonalTimetableDoc(uid: string) {
  return doc(getDb(), 'users', uid, 'personalTimetable', 'current');
}

function cloudTimetableForSchool(
  data: StoredTimetable & { updatedAt?: unknown },
  schoolId: string,
): StoredTimetable | null {
  if (!hasTimetableContent(data) || typeof data.schoolId !== 'string') return null;
  // Exact school marker only — wrong or missing scope must not become this campus.
  if (data.schoolId !== schoolId) return null;
  return {
    ...emptyTimetable(schoolId),
    ...data,
    updatedAt: new Date(savedAtMillis(data.updatedAt) || Date.now()).toISOString(),
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta),
    schoolId,
  };
}

export async function loadPersonalTimetable(
  uid: string | null,
  schoolId: string,
  localOwner?: string,
): Promise<StoredTimetable> {
  const ownerKey = localOwner === 'guest' ? 'local' : localOwner || uid || 'local';
  // The school-account namespace replaces the older uid key. Only that exact
  // identity may read its old copy, and an existing new copy (even empty) wins.
  const readCurrentLocal = () => {
    const readOwnerKey =
      uid && localOwner === `school:${uid}` && !hasLocal(ownerKey, schoolId) ? uid : ownerKey;
    return readLocalSnapshot(readOwnerKey, schoolId);
  };
  const initial = readCurrentLocal();
  if (!uid || !isFirebaseConfigured() || (localOwner && localOwner !== `school:${uid}`)) {
    return initial.timetable;
  }
  // Scoped records are explicit device-only saves, not a cloud cache. A newer
  // legacy cloud timestamp must not replace edits or revive a deleted course.
  if (initial.scoped) return initial.timetable;
  let canonical;
  try {
    canonical = await getDoc(personalTimetableDoc(uid, schoolId));
  } catch (error) {
    const latest = readCurrentLocal();
    if (latest.found) return latest.timetable;
    throw error;
  }
  // Another tab can save while the request is pending. Re-read the exact owner
  // and school before using a response, including a confirmed missing record.
  const localSnapshot = readCurrentLocal();
  const local = localSnapshot.timetable;
  if (localSnapshot.scoped) return local;

  if (canonical.exists()) {
    const data = canonical.data() as (StoredTimetable & { updatedAt?: unknown }) | null | undefined;
    const parsed =
      data && typeof data === 'object' ? cloudTimetableForSchool(data, schoolId) : null;
    if (!parsed) {
      // Recoverable local copy still wins; otherwise wrong scope is empty and
      // missing/malformed provenance must not pretend the campus has no cloud doc.
      if (localSnapshot.found) return local;
      if (
        data &&
        typeof data === 'object' &&
        typeof data.schoolId === 'string' &&
        data.schoolId !== schoolId
      ) {
        return local;
      }
      throw new Error('雲端課表格式異常，無法確認課表內容。請保留本機資料並重新讀取。');
    }
    // Canonical document present (including empty courses) wins over legacy.
    if (localSnapshot.found && localSnapshot.recordedAt > savedAtMillis(data?.updatedAt)) {
      return local;
    }
    return parsed;
  }

  let legacy;
  try {
    legacy = await getDoc(legacyPersonalTimetableDoc(uid));
  } catch (error) {
    if (localSnapshot.found) return local;
    throw error;
  }
  if (!legacy.exists()) {
    if (localSnapshot.found || localOwner) return local;
    // Compatibility for old callers: adopt a guest copy only after the account
    // is confirmed empty. Scoped platform and school accounts stay isolated.
    return readLocal('local', schoolId);
  }
  const legacyData = legacy.data() as StoredTimetable & { updatedAt?: unknown };
  const fromLegacy = cloudTimetableForSchool(legacyData, schoolId);
  // Read-only legacy fallback only when schoolId matches exactly.
  if (!fromLegacy) {
    // Legacy wrong/missing school: no adoption. Malformed payload still throws.
    if (localSnapshot.found) return local;
    if (
      !hasTimetableContent(legacyData) ||
      (legacyData.schoolId !== undefined && typeof legacyData.schoolId !== 'string')
    ) {
      throw new Error('雲端課表格式異常，無法確認課表內容。請保留本機資料並重新讀取。');
    }
    return local;
  }
  if (localSnapshot.found && localSnapshot.recordedAt > savedAtMillis(legacyData.updatedAt)) {
    return local;
  }
  return fromLegacy;
}

export async function savePersonalTimetable(
  uid: string | null,
  timetable: StoredTimetable,
  localOwner?: string,
): Promise<{ stored: 'cloud' | 'local' }> {
  const next = {
    ...timetable,
    courses: cleanCourses(timetable.courses),
    meta: cleanMeta(timetable.meta),
    updatedAt: new Date().toISOString(),
  };
  const ownerKey = localOwner === 'guest' ? 'local' : localOwner || uid || 'local';
  // A failed read, damaged JSON or cross-school scoped record must not be overwritten.
  const previous = readLocal(ownerKey, timetable.schoolId);
  if (next.classExceptions === undefined && previous.classExceptions !== undefined) next.classExceptions = previous.classExceptions;
  if (next.classExceptions !== undefined) next.classExceptions = classExceptionsForStorage(next.classExceptions);
  assertTimetableStorageSize(next);
  writeLocal(ownerKey, next);
  // 課表匯入與本機整理目前只留在這台裝置，不送到雲端。
  return { stored: 'local' };
}

export async function loadFriendTimetable(
  friendUid: string,
  schoolId: string,
): Promise<StoredTimetable | null> {
  if (!friendUid || !schoolId || !isFirebaseConfigured()) return null;
  const readShared = (snap: { exists(): boolean; data(): unknown }) => {
    if (!snap.exists()) return null;
    const data = snap.data() as StoredTimetable | undefined;
    if (!data) return null;
    if (data.shareWithFriends === false) return null;
    return cloudTimetableForSchool(data, schoolId);
  };
  const canonical = await getDoc(personalTimetableDoc(friendUid, schoolId));
  const fromCanonical = readShared(canonical);
  if (fromCanonical) return fromCanonical;
  if (canonical.exists()) return null;
  const legacy = await getDoc(legacyPersonalTimetableDoc(friendUid));
  return readShared(legacy);
}

async function callTimetableShare(
  name: 'createTimetableShare' | 'revokeTimetableShare',
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const user = getAuth()?.currentUser;
  if (!isFirebaseConfigured() || !user) {
    throw new Error('need-login');
  }
  const idToken = await user.getIdToken();
  const response = await fetch(getCloudFunctionUrl(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: input }),
    cache: 'no-store',
  });
  const payload = (await response.json()) as {
    error?: { message?: unknown };
    result?: unknown;
    data?: unknown;
  };
  const errorMessage =
    payload?.error && typeof payload.error === 'object' ? String(payload.error.message || '') : '';
  if (response.status === 503 || /尚未啟用/.test(errorMessage)) {
    throw new FunctionsUnconfiguredError('課表分享尚未啟用');
  }
  if (!response.ok || payload.error) {
    throw new Error(errorMessage || 'share-failed');
  }
  const result = payload.result ?? payload.data;
  if (!result || typeof result !== 'object') {
    throw new Error('share-failed');
  }
  return result as Record<string, unknown>;
}

export async function createServerShare(
  schoolId: string,
  name: string,
  snapshot?: { courses: PersonalCourse[]; meta: TimetableMeta },
) {
  const result = await callTimetableShare('createTimetableShare', {
    schoolId,
    name,
    ...(snapshot ? { courses: snapshot.courses, meta: snapshot.meta } : {}),
  });
  const token = typeof result.token === 'string' ? result.token : '';
  const path = typeof result.path === 'string' ? result.path : '';
  const expiresAt = typeof result.expiresAt === 'string' ? result.expiresAt : '';
  if (!token || !path || !expiresAt) throw new Error('share-failed');
  return { token, path, expiresAt };
}

export async function revokeServerShare(token: string) {
  const result = await callTimetableShare('revokeTimetableShare', { token });
  if (result.ok !== true) throw new Error('share-failed');
  return { ok: true as const };
}

export async function loadSharedTimetable(token: string) {
  if (!isFirebaseConfigured()) throw new Error('unconfigured');
  const snap = await getDoc(doc(getDb(), 'timetableShares', token));
  if (!snap.exists()) throw new Error('missing');
  const data = snap.data();
  if (data?.revoked) throw new Error('revoked');
  const expires = data?.expiresAt?.toDate?.() as Date | undefined;
  if (!expires || expires.getTime() <= Date.now()) throw new Error('expired');
  return {
    name: String(data.name || '課表'),
    schoolId: typeof data.schoolId === 'string' ? data.schoolId : null,
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta || {}),
    expiresAt: expires.toISOString(),
  };
}

export type MeetupKind = 'meal' | 'study';

/**
 * 同一個時間、同一件事只會有一筆（文件編號固定），連按也不會多送。
 * 回傳 'sent'（這次送出）或 'already'（之前就送過了）。
 */
export async function createMeetup(input: {
  schoolId: string;
  creatorUid: string;
  inviteeUid: string;
  kind: MeetupKind;
  day: number;
  startMinute: number;
  note: string;
}): Promise<'sent' | 'already'> {
  const ref = doc(
    getDb(),
    'meetups',
    meetupDocId(input.creatorUid, input.inviteeUid, input.day, input.startMinute, input.kind),
  );
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) return 'already';
  try {
    await setDoc(ref, {
      ...input,
      durationMinutes: MEETUP_DURATION_MINUTES,
      // 舊版畫面只看節次
      startPeriod: periodAt(input.startMinute),
      endPeriod: periodAt(input.startMinute + MEETUP_DURATION_MINUTES - 1),
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    return 'sent';
  } catch (error) {
    // 兩次幾乎同時送出：第一次已經寫進去，第二次會被擋，當作已經送過
    const again = await getDoc(ref).catch(() => null);
    if (again?.exists()) return 'already';
    throw error;
  }
}

export async function listMyMeetups(schoolId: string, uid: string) {
  const col = collection(getDb(), 'meetups');
  const [a, b] = await Promise.all([
    getDocs(query(col, where('schoolId', '==', schoolId), where('creatorUid', '==', uid))),
    getDocs(query(col, where('schoolId', '==', schoolId), where('inviteeUid', '==', uid))),
  ]);
  const map = new Map<string, Record<string, unknown>>();
  [...a.docs, ...b.docs].forEach((item) => map.set(item.id, { id: item.id, ...item.data() }));
  return [...map.values()];
}

export async function respondMeetup(id: string, status: 'accepted' | 'declined') {
  await updateDoc(doc(getDb(), 'meetups', id), { status });
}

export async function listCourseAppeals(schoolId: string, uid: string) {
  const snap = await getDocs(
    query(
      collection(getDb(), 'courseAppeals'),
      where('schoolId', '==', schoolId),
      where('studentUid', '==', uid),
    ),
  );
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

/** 舊的課表文件沒有索引時，用課表裡實際的課補上（只補，不會多加課）。 */
export async function ensureTimetableIndex(
  uid: string,
  schoolId: string,
  localCourses?: PersonalCourse[],
) {
  // Appeal workflow only — writes the canonical per-school path, never another campus.
  const ref = personalTimetableDoc(uid, schoolId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // 課表只存在這台裝置上：先存上去，申訴才對得到課
    if (localCourses?.length) {
      const courses = cleanCourses(localCourses);
      await setDoc(
        ref,
        { schoolId, courses, ...timetableIndex(courses), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    return;
  }
  const data = snap.data() as { courses?: unknown; courseIds?: unknown; schoolId?: unknown };
  if (data.schoolId !== schoolId) return;
  if (Array.isArray(data.courseIds)) return;
  await setDoc(ref, { schoolId, ...timetableIndex(cleanCourses(data.courses)) }, { merge: true });
}

/** 課表裡這門課的開課代號（課名｜老師），老師工作台用它找到對的老師。 */
export function appealOfferingId(course: PersonalCourse) {
  return courseOfferingId(course);
}

/**
 * 自己課表裡的課有沒有對應老師（只拿到 true/false）。伺服器還沒提供或讀不到時，一律當作還沒對應，
 * 畫面就照實說「暫時只有學校看得到」，不會說成老師會看。
 */
export async function loadAppealTeacherStatus(
  schoolId: string,
  offeringIds: string[],
): Promise<Record<string, boolean>> {
  if (!offeringIds.length) return {};
  if (!areFunctionsConfigured()) return {};
  try {
    const call = httpsCallable<
      { schoolId: string; offeringIds: string[] },
      { assigned: Record<string, boolean> }
    >(getFunctionsInstance(), 'appealTeacherStatus');
    const { data } = await call({ schoolId, offeringIds });
    return data?.assigned || {};
  } catch {
    return {};
  }
}

export async function createCourseAppeal(
  input: {
    schoolId: string;
    studentUid: string;
    courseId: string;
    courseName: string;
    offeringId: string;
    title: string;
    body: string;
  },
  requestId?: string,
  localCourses?: PersonalCourse[],
) {
  await ensureTimetableIndex(input.studentUid, input.schoolId, localCourses);
  // 同一次填寫用同一個編號，連按送出也只會有一筆
  const ref = requestId
    ? doc(getDb(), 'courseAppeals', requestId)
    : doc(collection(getDb(), 'courseAppeals'));
  try {
    await setDoc(ref, {
      ...input,
      teacherNote: '',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // 連按時第一下其實已經送到了：同一個編號的申訴已經在，就當作送出成功
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists() && existing.data()?.studentUid === input.studentUid) return ref.id;
    throw error;
  }
  return ref.id;
}

export type TeacherAppealRow = {
  id: string;
  courseName: string;
  title: string;
  body: string;
  status: string;
  teacherNote: string;
  createdAt: string | null;
  updatedAt: string | null;
  studentName: string;
  studentNumber: string;
};

/**
 * 老師工作台的申訴：由伺服器整理（學生名字和學號只有伺服器讀得到）。
 * 學校管理者看全校；老師只看自己有教的課（schools/{schoolId}/courseTeachers）。
 * courses 為 null 代表是管理者、看的是全校。
 */
export async function listTeacherAppeals(schoolId: string) {
  const call = httpsCallable<
    { schoolId: string },
    { courses: string[] | null; rows: TeacherAppealRow[] }
  >(getFunctionsInstance(), 'listTeacherAppeals');
  const { data } = await call({ schoolId });
  return data;
}

export async function decideCourseAppeal(
  id: string,
  status: 'approved' | 'rejected',
  teacherNote: string,
) {
  await updateDoc(doc(getDb(), 'courseAppeals', id), {
    status,
    teacherNote: teacherNote.trim().slice(0, 500),
    updatedAt: serverTimestamp(),
  });
}

export async function withdrawCourseAppeal(id: string) {
  await updateDoc(doc(getDb(), 'courseAppeals', id), {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMeetup(id: string) {
  await deleteDoc(doc(getDb(), 'meetups', id));
}
