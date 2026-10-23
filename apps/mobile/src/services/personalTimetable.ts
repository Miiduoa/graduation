import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
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
  MEETUP_DURATION_MINUTES,
  MAX_PERIOD_SLOTS,
  cleanCourses,
  cleanMeta,
  courseOfferingId,
  meetupDocId,
  periodAt,
  timetableIndex,
  type PersonalCourse,
  type PersonalImportRecord,
  type TimetableMeta,
} from '@campus/shared';
import { getDb, getFunctionsInstance } from '../firebase';

const KEY = 'campus-one-personal-timetable';

export type StoredTimetable = {
  courses: PersonalCourse[];
  meta: TimetableMeta;
  shareWithFriends: boolean;
  updatedAt: string;
  schoolId: string;
};

function empty(schoolId: string): StoredTimetable {
  return {
    courses: [],
    meta: cleanMeta({}),
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId,
  };
}

async function readLocalTimetable(owner: string, schoolId: string, allowLegacy: boolean) {
  const scoped = await AsyncStorage.getItem(`${KEY}:${owner}:${schoolId}`);
  const raw = scoped !== null ? scoped : allowLegacy ? await AsyncStorage.getItem(`${KEY}:${owner}`) : null;
  if (raw === null) return empty(schoolId);
  const invalid = () => new Error('儲存的課表無法讀取，已保留原始資料。請稍後重試，或先備份再處理。');
  let parsed: StoredTimetable;
  try { parsed = JSON.parse(raw) as StoredTimetable; } catch { throw invalid(); }
  // Only an explicitly different-school legacy record may be ignored.
  if (scoped === null && typeof parsed?.schoolId === 'string' && parsed.schoolId !== schoolId) return empty(schoolId);
  if (!parsed || parsed.schoolId !== schoolId || !Array.isArray(parsed.courses) ||
    !parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta) ||
    typeof parsed.meta.year !== 'string' || typeof parsed.meta.semester !== 'string' ||
    typeof parsed.shareWithFriends !== 'boolean' ||
    parsed.courses.some((course) => !course || typeof course.id !== 'string' ||
      typeof course.name !== 'string' || !Number.isInteger(course.day) || course.day < 0 || course.day > 5 ||
      !Number.isInteger(course.start) || !Number.isInteger(course.end) ||
      (course.day === 0 ? course.start !== 0 || course.end !== 0 : course.start < 1 || course.end < course.start || course.end > MAX_PERIOD_SLOTS))) {
    throw invalid();
  }
  return { ...parsed, courses: cleanCourses(parsed.courses), meta: cleanMeta(parsed.meta) };
}

export async function loadPersonalTimetable(
  uid: string | null,
  schoolId: string,
  localOwner?: string,
): Promise<StoredTimetable> {
  const owner = localOwner || uid || 'local';
  const fallback = await readLocalTimetable(owner, schoolId, !localOwner);
  if (!uid || localOwner) return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
  try {
    const snap = await getDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'));
    if (!snap.exists())
      return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
    const data = snap.data() as StoredTimetable;
    if (data.schoolId !== schoolId) return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
    return {
      ...empty(schoolId),
      ...data,
      courses: cleanCourses(data.courses),
      meta: cleanMeta(data.meta),
    };
  } catch {
    return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
  }
}

export async function savePersonalTimetable(uid: string | null, timetable: StoredTimetable, localOwner?: string) {
  // A failed read must not be replaced by a newly created empty timetable.
  await readLocalTimetable(localOwner || uid || 'local', timetable.schoolId, !localOwner);
  const next = {
    ...timetable,
    courses: cleanCourses(timetable.courses),
    meta: cleanMeta(timetable.meta),
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(`${KEY}:${localOwner || uid || 'local'}:${timetable.schoolId}`, JSON.stringify(next));
  if (!uid || localOwner) return { stored: 'local' as const };
  await setDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'), {
    ...next,
    // 送申訴時規則用這兩個清單確認課在自己的課表裡
    ...timetableIndex(next.courses),
    updatedAt: serverTimestamp(),
  });
  return { stored: 'cloud' as const };
}

/** Projection only: the user's saved courses remain in their original storage. */
export function personalTimetableRecords(timetable: StoredTimetable): PersonalImportRecord[] {
  return timetable.courses.map((course) => ({
    id: `manual:${course.id}`, batchId: 'manual-timetable', importedAt: timetable.updatedAt,
    kind: 'timetable', schoolId: timetable.schoolId,
    academicYear: timetable.meta.year || '未填', semester: timetable.meta.semester || '未填',
    title: course.name, teacher: course.teacher, location: course.room,
    dayOfWeek: course.day, startPeriod: course.start, endPeriod: course.end,
    source: { type: 'paste', line: 1, rawText: '' },
  }));
}

export async function loadFriendTimetable(friendUid: string) {
  const snap = await getDoc(doc(getDb(), 'users', friendUid, 'personalTimetable', 'current'));
  if (!snap.exists() || snap.data()?.shareWithFriends === false) return null;
  const data = snap.data() as StoredTimetable;
  return { ...data, courses: cleanCourses(data.courses) };
}

/** 同一個時間、同一件事只會有一筆（文件編號固定），連按也不會多送。 */
export async function createMeetup(input: {
  schoolId: string;
  creatorUid: string;
  inviteeUid: string;
  kind: 'meal' | 'study';
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
      startPeriod: periodAt(input.startMinute),
      endPeriod: periodAt(input.startMinute + MEETUP_DURATION_MINUTES - 1),
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    return 'sent';
  } catch (error) {
    const again = await getDoc(ref).catch(() => null);
    if (again?.exists()) return 'already';
    throw error;
  }
}

export type MeetupRow = {
  id: string;
  creatorUid: string;
  inviteeUid: string;
  kind: 'meal' | 'study';
  day: number;
  startMinute?: number;
  durationMinutes?: number;
  startPeriod?: number;
  endPeriod?: number;
  status: 'pending' | 'accepted' | 'declined';
};

/** 別人約我、還沒回覆的邀約。 */
export async function listIncomingMeetups(schoolId: string, uid: string): Promise<MeetupRow[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), 'meetups'),
      where('schoolId', '==', schoolId),
      where('inviteeUid', '==', uid),
      where('status', '==', 'pending'),
    ),
  );
  return snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<MeetupRow, 'id'>) }));
}

export async function respondMeetup(id: string, status: 'accepted' | 'declined') {
  await updateDoc(doc(getDb(), 'meetups', id), { status });
}

export async function createServerShare(schoolId: string, name: string) {
  const call = httpsCallable(getFunctionsInstance(), 'createTimetableShare');
  const { data } = await call({ schoolId, name });
  return data as { token: string; path: string; expiresAt: string };
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
async function ensureTimetableIndex(
  uid: string,
  schoolId: string,
  localCourses?: PersonalCourse[],
) {
  const ref = doc(getDb(), 'users', uid, 'personalTimetable', 'current');
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
  const data = snap.data() as { courses?: unknown; courseIds?: unknown };
  if (Array.isArray(data.courseIds)) return;
  await setDoc(ref, timetableIndex(cleanCourses(data.courses)), { merge: true });
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
}

export async function withdrawCourseAppeal(id: string) {
  await updateDoc(doc(getDb(), 'courseAppeals', id), {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
  });
}
