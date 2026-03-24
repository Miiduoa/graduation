import { buildUserSchoolCollectionPath } from '@campus/shared/src';
import type { CreditCategory } from '@campus/shared/src/creditAudit';
import { deleteDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

import { collectionFromSegments, docFromSegments } from '../../data/firestorePath';
import { getDb } from '../../firebase';
import { loadPersistedValue, savePersistedValue } from '../../services/persistedStorage';
import { getScopedStorageKey } from '../../services/scopedStorage';

const LEGACY_STORAGE_KEY = '@credit_audit_courses';

export type StoredEnrollment = {
  id: string;
  courseId: string;
  courseName: string;
  credits: number;
  category: CreditCategory;
  passed: boolean;
  status: 'completed' | 'in_progress' | 'dropped';
  createdAt?: unknown;
};

export type SavedCourse = {
  id: string;
  name: string;
  credits: number;
  category: CreditCategory;
  passed: boolean;
  grade?: string;
  semester?: string;
  createdAt: string;
  syncedToCloud: boolean;
};

export function getCreditAuditStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey('credit-audit-courses', { uid: userId, schoolId });
}

export async function loadCreditAuditSavedCourses(storageKey: string): Promise<SavedCourse[]> {
  return loadPersistedValue<SavedCourse[]>({
    storageKey,
    legacyKeys: [LEGACY_STORAGE_KEY],
    fallback: [],
    deserialize: (raw) => JSON.parse(raw) as SavedCourse[],
  });
}

export async function saveCreditAuditSavedCourses(storageKey: string, courses: SavedCourse[]): Promise<void> {
  await savePersistedValue(storageKey, courses);
}

export async function listStoredEnrollments(uid: string, schoolId: string): Promise<StoredEnrollment[]> {
  const db = getDb();
  const canonicalSnapshot = await getDocs(
    collectionFromSegments(db, buildUserSchoolCollectionPath(uid, schoolId, 'enrollments'))
  ).catch(() => null);

  if (canonicalSnapshot && !canonicalSnapshot.empty) {
    return canonicalSnapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<StoredEnrollment, 'id'>),
    }));
  }

  const legacySnapshot = await getDocs(collectionFromSegments(db, ['users', uid, 'enrollments']));
  return legacySnapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<StoredEnrollment, 'id'>),
  }));
}

export async function upsertCreditAuditEnrollment(params: {
  uid: string;
  schoolId: string;
  course: {
    id: string;
    name: string;
    credits: number;
    category: CreditCategory;
    passed: boolean;
    grade?: string;
    semester?: string;
  };
}): Promise<void> {
  const db = getDb();
  await setDoc(
    docFromSegments(db, buildUserSchoolCollectionPath(params.uid, params.schoolId, 'enrollments', params.course.id)),
    {
      courseId: params.course.id,
      courseName: params.course.name,
      credits: params.course.credits,
      category: params.course.category,
      schoolId: params.schoolId,
      passed: params.course.passed,
      grade: params.course.grade ?? null,
      semester: params.course.semester ?? null,
      status: 'completed',
      source: 'credit-audit-input',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );
}

export async function deleteCreditAuditEnrollment(params: {
  uid: string;
  schoolId: string;
  enrollmentId: string;
}): Promise<void> {
  const db = getDb();
  await deleteDoc(
    docFromSegments(db, buildUserSchoolCollectionPath(params.uid, params.schoolId, 'enrollments', params.enrollmentId))
  );
}

export async function syncCreditAuditCoursesToCloud(params: {
  uid: string;
  schoolId: string;
  courses: SavedCourse[];
}): Promise<void> {
  const db = getDb();
  const batch = writeBatch(db);

  params.courses.forEach((course) => {
    batch.set(
      docFromSegments(db, buildUserSchoolCollectionPath(params.uid, params.schoolId, 'enrollments', course.id)),
      {
        courseId: course.id,
        courseName: course.name,
        credits: course.credits,
        category: course.category,
        schoolId: params.schoolId,
        passed: course.passed,
        grade: course.grade ?? null,
        semester: course.semester ?? null,
        status: 'completed',
        source: 'credit-audit-input',
        localCreatedAt: course.createdAt,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
}
