import { notifyTimetableChanged } from '../widgets/timetableChanges';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  doc,
  deleteField,
  getDoc,
  getDocs,
  query,
  runTransaction,
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
  withClassExceptions,
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
import { isProvidenceSchoolId, toPublicSchoolId } from '../data/schoolIds';

const KEY = 'campus-one-personal-timetable';

export type StoredTimetable = {
  classExceptionsRevision?: number;
  classExceptions?: import('@campus/shared').ClassException[];
  courses: PersonalCourse[];
  meta: TimetableMeta;
  shareWithFriends: boolean;
  updatedAt: string;
  schoolId: string;
};

function canonicalSchoolId(schoolId: string): string {
  return toPublicSchoolId(schoolId) ?? schoolId;
}

function sameSchool(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return canonicalSchoolId(a) === canonicalSchoolId(b);
}

/** Prefer canonical key, then historical alias keys; never delete older keys. */
function localSchoolKeySuffixes(schoolId: string): string[] {
  const canonical = canonicalSchoolId(schoolId);
  if (isProvidenceSchoolId(schoolId)) {
    return [...new Set([canonical, 'tw-pu', schoolId])];
  }
  return [...new Set([canonical, schoolId])];
}

function cloudScopedRef(uid: string, schoolId: string) {
  return doc(
    getDb(),
    'users',
    uid,
    'schools',
    canonicalSchoolId(schoolId),
    'personalTimetable',
    'current',
  );
}

function cloudExceptionsRef(uid: string, schoolId: string) {
  return doc(getDb(), 'users', uid, 'schools', canonicalSchoolId(schoolId), 'personalTimetable', 'exceptions');
}

function cloudLegacyRef(uid: string) {
  return doc(getDb(), 'users', uid, 'personalTimetable', 'current');
}

function empty(schoolId: string): StoredTimetable {
  return {
    courses: [],
    meta: cleanMeta({}),
    shareWithFriends: true,
    updatedAt: new Date().toISOString(),
    schoolId: canonicalSchoolId(schoolId),
  };
}

function asStored(data: StoredTimetable, schoolId: string): StoredTimetable {
  assertClassExceptions(data.classExceptions);
  const canonical = canonicalSchoolId(schoolId);
  return {
    ...empty(canonical),
    ...data,
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta),
    schoolId: canonical,
  };
}

async function readLocalTimetable(owner: string, schoolId: string, allowLegacy: boolean) {
  const canonical = canonicalSchoolId(schoolId);
  let scoped: string | null = null;
  for (const suffix of localSchoolKeySuffixes(schoolId)) {
    const raw = await AsyncStorage.getItem(`${KEY}:${owner}:${suffix}`);
    if (raw !== null) {
      scoped = raw;
      break;
    }
  }
  const raw = scoped !== null ? scoped : allowLegacy ? await AsyncStorage.getItem(`${KEY}:${owner}`) : null;
  if (raw === null) return empty(canonical);
  const invalid = () => new Error('儲存的課表無法讀取，已保留原始資料。請稍後重試，或先備份再處理。');
  let parsed: StoredTimetable;
  try { parsed = JSON.parse(raw) as StoredTimetable; } catch { throw invalid(); }
  assertClassExceptions(parsed?.classExceptions);
  // Only an explicitly different-school legacy record may be ignored.
  if (scoped === null && typeof parsed?.schoolId === 'string' && !sameSchool(parsed.schoolId, schoolId)) {
    return empty(canonical);
  }
  if (!parsed || !sameSchool(parsed.schoolId, schoolId) || !Array.isArray(parsed.courses) ||
    !parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta) ||
    typeof parsed.meta.year !== 'string' || typeof parsed.meta.semester !== 'string' ||
    typeof parsed.shareWithFriends !== 'boolean' ||
    parsed.courses.some((course) => !course || typeof course.id !== 'string' ||
      typeof course.name !== 'string' || !Number.isInteger(course.day) || course.day < 0 || course.day > 5 ||
      !Number.isInteger(course.start) || !Number.isInteger(course.end) ||
      (course.day === 0 ? course.start !== 0 || course.end !== 0 : course.start < 1 || course.end < course.start || course.end > MAX_PERIOD_SLOTS))) {
    throw invalid();
  }
  return {
    ...parsed,
    schoolId: canonical,
    courses: cleanCourses(parsed.courses),
    meta: cleanMeta(parsed.meta),
  };
}

function withLocalFallback(schoolId: string, fallback: StoredTimetable): StoredTimetable {
  const canonical = canonicalSchoolId(schoolId);
  return {
    ...empty(canonical),
    ...fallback,
    courses: cleanCourses(fallback.courses),
    schoolId: canonical,
  };
}

/**
 * Read only an already saved timetable for this exact user + campus. No Firestore read,
 * shared-device legacy key, or demo-data fallback is allowed in offline AI context.
 */
export async function loadOfflinePersonalTimetable(
  uid: string,
  schoolId: string,
): Promise<StoredTimetable | null> {
  if (!uid?.trim() || !schoolId?.trim()) return null;
  let hasScopedCopy = false;
  for (const suffix of localSchoolKeySuffixes(schoolId)) {
    if ((await AsyncStorage.getItem(`${KEY}:${uid}:${suffix}`)) !== null) {
      hasScopedCopy = true;
      break;
    }
  }
  return hasScopedCopy ? readLocalTimetable(uid, schoolId, false) : null;
}

export async function loadPersonalTimetableDraft(uid: string, schoolId: string): Promise<StoredTimetable | null> {
  const raw = await AsyncStorage.getItem(`${KEY}:${uid}:${canonicalSchoolId(schoolId)}:draft`);
  if (!raw) return null;
  const draft = JSON.parse(raw) as StoredTimetable;
  if (!sameSchool(draft.schoolId, schoolId)) return null;
  return asStored(draft, schoolId);
}

export async function loadPersonalTimetable(
  uid: string | null,
  schoolId: string,
  localOwner?: string,
): Promise<StoredTimetable> {
  const owner = localOwner || uid || 'local';
  const canonical = canonicalSchoolId(schoolId);
  const fallback = await readLocalTimetable(owner, schoolId, !localOwner);
  if (!uid || localOwner) return withLocalFallback(canonical, fallback);
  let scopedSnap;
  let arrangements: Partial<StoredTimetable> = {};
  try {
    const exceptionSnap = await getDoc(cloudExceptionsRef(uid, canonical));
    if (exceptionSnap.exists()) arrangements = exceptionSnap.data() as Partial<StoredTimetable>;
    scopedSnap = await getDoc(cloudScopedRef(uid, canonical));
  } catch {
    // Failed scoped read must not trigger legacy fallback.
    return withLocalFallback(canonical, fallback);
  }
  if (scopedSnap.exists()) {
    const data = scopedSnap.data() as StoredTimetable;
    if (!sameSchool(data.schoolId, canonical)) return withLocalFallback(canonical, fallback);
    const latest = asStored({ ...data, ...arrangements }, canonical);
    await AsyncStorage.setItem(`${KEY}:${owner}:${canonical}`, JSON.stringify(latest));
    return latest;
  }
  try {
    const legacySnap = await getDoc(cloudLegacyRef(uid));
    if (!legacySnap.exists()) return withLocalFallback(canonical, { ...fallback, ...arrangements });
    const data = legacySnap.data() as StoredTimetable;
    if (!sameSchool(data.schoolId, canonical)) return withLocalFallback(canonical, fallback);
    const latest = asStored({ ...data, ...arrangements }, canonical);
    await AsyncStorage.setItem(`${KEY}:${owner}:${canonical}`, JSON.stringify(latest));
    return latest;
  } catch {
    return withLocalFallback(canonical, fallback);
  }
}

export async function savePersonalTimetable(uid: string | null, timetable: StoredTimetable, localOwner?: string, editExceptions?: boolean) {
  const canonical = canonicalSchoolId(timetable.schoolId);
  // A failed read must not be replaced by a newly created empty timetable.
  const previous = await readLocalTimetable(localOwner || uid || 'local', timetable.schoolId, !localOwner);
  const next = {
    ...timetable,
    schoolId: canonical,
    courses: cleanCourses(timetable.courses),
    meta: cleanMeta(timetable.meta),
    updatedAt: new Date().toISOString(),
  };
  if (next.classExceptions === undefined && previous.classExceptions !== undefined) next.classExceptions = previous.classExceptions;
  if (next.classExceptions !== undefined) next.classExceptions = classExceptionsForStorage(next.classExceptions);
  assertTimetableStorageSize(next);
  const editingExceptions = timetable.classExceptions !== undefined && (editExceptions ??
    JSON.stringify(next.classExceptions) !== JSON.stringify(previous.classExceptions));
  const store = async (value: StoredTimetable) => {
    await AsyncStorage.setItem(`${KEY}:${localOwner || uid || 'local'}:${canonical}`, JSON.stringify(value));
    notifyTimetableChanged();
  };
  if (!uid || localOwner) {
    await store(next);
    return { stored: 'local' as const };
  }
  let conflict = false;
  try {
    const ref = cloudScopedRef(uid, canonical);
    const saved = await runTransaction(getDb(), async (transaction) => {
      const snap = await transaction.get(ref);
      const remote = snap.exists() ? snap.data() as StoredTimetable : undefined;
      const exceptionRef = cloudExceptionsRef(uid, canonical);
      const exceptionSnap = await transaction.get(exceptionRef);
      const legacySnap = await transaction.get(cloudLegacyRef(uid));
      const legacy = legacySnap.exists() ? legacySnap.data() as StoredTimetable : undefined;
      const embedded = remote?.classExceptions !== undefined ? remote :
        (legacy && sameSchool(legacy.schoolId, canonical) ? legacy : undefined);
      const remoteExceptions = exceptionSnap.exists() ? exceptionSnap.data() as StoredTimetable : embedded;
      const remoteRevision = remoteExceptions?.classExceptionsRevision ?? 0;
      const payload = { ...next };
      if (editingExceptions) {
        if ((timetable.classExceptionsRevision ?? 0) !== remoteRevision) {
          conflict = true;
          throw new Error('課表已在其他裝置更新，請重新載入後再調整。');
        }
        payload.classExceptionsRevision = remoteRevision + 1;
      } else {
        payload.classExceptions = classExceptionsForStorage(remoteExceptions?.classExceptions ?? []);
        payload.classExceptionsRevision = remoteRevision + (
          remoteExceptions?.classExceptions !== undefined &&
          JSON.stringify(payload.classExceptions) !== JSON.stringify(remoteExceptions.classExceptions) ? 1 : 0
        );
      }
      if (legacySnap.exists() && sameSchool((legacySnap.data() as StoredTimetable).schoolId, canonical) && legacySnap.data().classExceptions !== undefined) {
        transaction.set(cloudLegacyRef(uid), { classExceptions: deleteField(), classExceptionsRevision: deleteField() }, { merge: true });
      }
      transaction.set(exceptionRef, {
        schoolId: canonical,
        classExceptions: payload.classExceptions ?? [],
        classExceptionsRevision: payload.classExceptionsRevision ?? remoteRevision,
      });
      assertTimetableStorageSize(payload);
      const base = { ...payload };
      delete base.classExceptions;
      delete base.classExceptionsRevision;
      transaction.set(ref, {
        ...base,
        ...(remote?.classExceptions !== undefined ? { classExceptions: deleteField(), classExceptionsRevision: deleteField() } : {}),
        ...timetableIndex(payload.courses),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return payload;
    });
    await store(saved);
    if (editingExceptions) await AsyncStorage.removeItem(`${KEY}:${uid}:${canonical}:draft`);
    return { stored: 'cloud' as const, timetable: saved };
  } catch (error) {
    const draftKey = `${KEY}:${uid}:${canonical}:draft`;
    if (editingExceptions || !(await AsyncStorage.getItem(draftKey))) {
      await AsyncStorage.setItem(draftKey, JSON.stringify(next));
    }
    if (conflict) throw error;
    await store(next);
    return { stored: 'local' as const, cloudPending: true };
  }
}

/** Projection only: the user's saved courses remain in their original storage. */
export function personalTimetableRecords(timetable: StoredTimetable, imported: PersonalImportRecord[] = []): PersonalImportRecord[] {
  const manual: PersonalImportRecord[] = timetable.courses.map((course) => ({
    id: `manual:${course.id}`, batchId: 'manual-timetable', importedAt: timetable.updatedAt,
    kind: 'timetable', schoolId: timetable.schoolId,
    academicYear: timetable.meta.year || '未填', semester: timetable.meta.semester || '未填',
    title: course.name, teacher: course.teacher, location: course.room,
    dayOfWeek: course.day, startPeriod: course.start, endPeriod: course.end,
    source: { type: 'paste', line: 1, rawText: '' },
  }));
  return withClassExceptions([...manual, ...imported], timetable.classExceptions);
}

export async function loadFriendTimetable(friendUid: string, schoolId: string) {
  if (!schoolId?.trim()) {
    throw new Error('schoolId is required');
  }
  const canonical = canonicalSchoolId(schoolId);
  let scopedSnap;
  try {
    scopedSnap = await getDoc(cloudScopedRef(friendUid, canonical));
  } catch {
    // Failed scoped read must not trigger legacy fallback.
    return null;
  }
  if (scopedSnap.exists()) {
    const data = scopedSnap.data() as StoredTimetable;
    if (data.shareWithFriends !== true) return null;
    if (!sameSchool(data.schoolId, canonical)) return null;
    const exceptionSnap = await getDoc(cloudExceptionsRef(friendUid, canonical));
    return asStored({ ...data, ...(exceptionSnap.exists() ? exceptionSnap.data() : {}) }, canonical);
  }
  try {
    const legacySnap = await getDoc(cloudLegacyRef(friendUid));
    if (!legacySnap.exists()) return null;
    const data = legacySnap.data() as StoredTimetable;
    if (data.shareWithFriends !== true) return null;
    if (!sameSchool(data.schoolId, canonical)) return null;
    const exceptionSnap = await getDoc(cloudExceptionsRef(friendUid, canonical));
    return asStored({ ...data, ...(exceptionSnap.exists() ? exceptionSnap.data() : {}) }, canonical);
  } catch {
    return null;
  }
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
  const canonical = canonicalSchoolId(schoolId);
  const scopedRef = cloudScopedRef(uid, canonical);
  const scopedSnap = await getDoc(scopedRef);
  if (scopedSnap.exists()) {
    const data = scopedSnap.data() as { schoolId?: string; courses?: unknown; courseIds?: unknown };
    if (!sameSchool(data.schoolId, canonical)) throw new Error('課表與目前學校不符，請重新讀取。');
    if (Array.isArray(data.courseIds)) return;
    await setDoc(scopedRef, {
      schoolId: canonical,
      ...timetableIndex(cleanCourses(data.courses)),
    }, { merge: true });
    return;
  }

  let seedCourses: PersonalCourse[] | null = null;
  let seedMeta = cleanMeta({});
  // Creating an appeal index does not grant friends access to a private timetable.
  let shareWithFriends = false;
  const legacySnap = await getDoc(cloudLegacyRef(uid));
  if (legacySnap.exists()) {
    const data = legacySnap.data() as StoredTimetable;
    if (sameSchool(data.schoolId, canonical)) {
      seedMeta = cleanMeta(data.meta || {});
      shareWithFriends = data.shareWithFriends === true;
      if (Array.isArray(data.courses) && data.courses.length) {
        seedCourses = cleanCourses(data.courses);
      }
    }
  }
  if (localCourses?.length) seedCourses = cleanCourses(localCourses);
  if (!seedCourses?.length) return;
  await setDoc(
    scopedRef,
    {
      schoolId: canonical,
      courses: seedCourses,
      meta: seedMeta,
      shareWithFriends,
      ...timetableIndex(seedCourses),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
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
