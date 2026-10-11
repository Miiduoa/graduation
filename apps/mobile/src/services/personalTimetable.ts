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
  cleanCourses,
  cleanMeta,
  courseOfferingId,
  meetupDocId,
  periodAt,
  timetableIndex,
  type PersonalCourse,
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

export async function loadPersonalTimetable(
  uid: string | null,
  schoolId: string,
): Promise<StoredTimetable> {
  const local = await AsyncStorage.getItem(`${KEY}:${uid || 'local'}`);
  const fallback = local ? JSON.parse(local) : empty(schoolId);
  if (!uid) return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
  try {
    const snap = await getDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'));
    if (!snap.exists())
      return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
    const data = snap.data() as StoredTimetable;
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

export async function savePersonalTimetable(uid: string | null, timetable: StoredTimetable) {
  const next = {
    ...timetable,
    courses: cleanCourses(timetable.courses),
    meta: cleanMeta(timetable.meta),
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(`${KEY}:${uid || 'local'}`, JSON.stringify(next));
  if (!uid) return { stored: 'local' as const };
  await setDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'), {
    ...next,
    // 送申訴時規則用這兩個清單確認課在自己的課表裡
    ...timetableIndex(next.courses),
    updatedAt: serverTimestamp(),
  });
  return { stored: 'cloud' as const };
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
