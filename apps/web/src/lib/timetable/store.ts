'use client';

import {
  addDoc,
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
  cleanCourses,
  cleanMeta,
  type PersonalCourse,
  type TimetableMeta,
} from '@campus/shared';
import { getAuth, getDb, getFunctionsInstance, isFirebaseConfigured } from '@/lib/firebase';

const LOCAL_KEY = 'campus-one-personal-timetable';

export type StoredTimetable = {
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

function readLocal(ownerKey: string, schoolId: string): StoredTimetable {
  try {
    const raw = localStorage.getItem(`${LOCAL_KEY}:${ownerKey}`);
    if (!raw) return emptyTimetable(schoolId);
    const parsed = JSON.parse(raw) as StoredTimetable;
    return {
      ...emptyTimetable(schoolId),
      ...parsed,
      courses: cleanCourses(parsed.courses),
      meta: cleanMeta(parsed.meta),
      schoolId: parsed.schoolId || schoolId,
    };
  } catch {
    return emptyTimetable(schoolId);
  }
}

function writeLocal(ownerKey: string, timetable: StoredTimetable) {
  localStorage.setItem(`${LOCAL_KEY}:${ownerKey}`, JSON.stringify(timetable));
}

export async function loadPersonalTimetable(uid: string | null, schoolId: string): Promise<StoredTimetable> {
  const ownerKey = uid || 'local';
  if (!uid || !isFirebaseConfigured()) return readLocal(ownerKey, schoolId);
  const snap = await getDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'));
  if (!snap.exists()) return readLocal(ownerKey, schoolId);
  const data = snap.data() as StoredTimetable;
  return {
    ...emptyTimetable(schoolId),
    ...data,
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta),
    schoolId: data.schoolId || schoolId,
  };
}

export async function savePersonalTimetable(
  uid: string | null,
  timetable: StoredTimetable,
): Promise<{ stored: 'cloud' | 'local' }> {
  const next = {
    ...timetable,
    courses: cleanCourses(timetable.courses),
    meta: cleanMeta(timetable.meta),
    updatedAt: new Date().toISOString(),
  };
  const ownerKey = uid || 'local';
  writeLocal(ownerKey, next);
  if (!uid || !isFirebaseConfigured() || getAuth()?.currentUser?.uid !== uid) {
    return { stored: 'local' };
  }
  await setDoc(doc(getDb(), 'users', uid, 'personalTimetable', 'current'), {
    ...next,
    updatedAt: serverTimestamp(),
  });
  return { stored: 'cloud' };
}

export async function loadFriendTimetable(friendUid: string): Promise<StoredTimetable | null> {
  if (!isFirebaseConfigured()) return null;
  const snap = await getDoc(doc(getDb(), 'users', friendUid, 'personalTimetable', 'current'));
  if (!snap.exists()) return null;
  const data = snap.data() as StoredTimetable;
  if (data.shareWithFriends === false) return null;
  return {
    ...emptyTimetable(data.schoolId || 'pu'),
    ...data,
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta),
  };
}

export async function createServerShare(schoolId: string, name: string) {
  if (!isFirebaseConfigured() || !getAuth()?.currentUser) {
    throw new Error('need-login');
  }
  const call = httpsCallable<{ schoolId: string; name: string }, { token: string; path: string; expiresAt: string }>(
    getFunctionsInstance(),
    'createTimetableShare',
  );
  const { data } = await call({ schoolId, name });
  return data;
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
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta || {}),
    expiresAt: expires.toISOString(),
  };
}

export type MeetupKind = 'meal' | 'study';

export async function createMeetup(input: {
  schoolId: string;
  creatorUid: string;
  inviteeUid: string;
  kind: MeetupKind;
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
  await updateDoc(doc(getDb(), 'courseAppeals', id), {
    status: 'withdrawn',
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMeetup(id: string) {
  await deleteDoc(doc(getDb(), 'meetups', id));
}
