import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc,
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
  cleanCourses,
  cleanMeta,
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

export async function loadPersonalTimetable(uid: string | null, schoolId: string): Promise<StoredTimetable> {
  const local = await AsyncStorage.getItem(`${KEY}:${uid || 'local'}`);
  const fallback = local ? JSON.parse(local) : empty(schoolId);
  if (!uid) return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
  try {
    const snap = await getDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'));
    if (!snap.exists()) return { ...empty(schoolId), ...fallback, courses: cleanCourses(fallback.courses) };
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

export async function createMeetup(input: {
  schoolId: string;
  creatorUid: string;
  inviteeUid: string;
  kind: 'meal' | 'study';
  day: number;
  startPeriod: number;
  endPeriod: number;
  note: string;
}) {
  await addDoc(collection(getDb(), 'meetups'), {
    ...input,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function createServerShare(schoolId: string, name: string) {
  const call = httpsCallable(getFunctionsInstance(), 'createTimetableShare');
  const { data } = await call({ schoolId, name });
  return data as { token: string; path: string };
}

export async function listCourseAppeals(schoolId: string, uid: string) {
  const snap = await getDocs(
    query(collection(getDb(), 'courseAppeals'), where('schoolId', '==', schoolId), where('studentUid', '==', uid)),
  );
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function createCourseAppeal(input: {
  schoolId: string;
  studentUid: string;
  courseId: string;
  courseName: string;
  title: string;
  body: string;
}) {
  await addDoc(collection(getDb(), 'courseAppeals'), {
    ...input,
    teacherNote: '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function withdrawCourseAppeal(id: string) {
  await updateDoc(doc(getDb(), 'courseAppeals', id), { status: 'withdrawn', updatedAt: serverTimestamp() });
}
