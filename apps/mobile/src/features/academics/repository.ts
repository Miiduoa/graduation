import { buildUserSchoolCollectionPath } from '@campus/shared/src';
import type { CreditCategory } from '@campus/shared/src/creditAudit';
import { deleteDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

import { collectionFromSegments, docFromSegments } from '../../data/firestorePath';
import { getDb } from '../../firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { savePersistedValue } from '../../services/persistedStorage';
import { getScopedStorageKey } from '../../services/scopedStorage';

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
  /** Detailed category key (maps to DetailedCreditCategory.key) */
  detailedCatKey?: string;
  /** Detailed sub-category key (maps to CreditSubCategory.key) */
  detailedSubKey?: string;
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
  // 只讀這個帳號加校區的鍵。若退回沒有範圍的舊資料，共用裝置上可能把甲生的成績顯示在乙生帳號下。
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return [];

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 2_000) {
    throw new Error('個人課程資料格式錯誤');
  }
  for (const item of parsed) {
    if (
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.id !== 'string' || !item.id ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 ||
      typeof item.credits !== 'number' || !Number.isFinite(item.credits) ||
      item.credits < 0 || item.credits > 30 ||
      typeof item.passed !== 'boolean' ||
      !['required', 'elective', 'general', 'english', 'other'].includes(item.category)
    ) {
      throw new Error('個人課程內容無法驗證');
    }
  }
  return parsed as SavedCourse[];
}

export function getCreditChecklistStorageKey(
  uid: string | null,
  schoolId: string,
  templateId: string,
): string {
  return getScopedStorageKey(`credit-audit-checklist:${templateId}`, { uid, schoolId });
}

export async function loadCreditChecklistStatus(storageKey: string): Promise<Record<string, boolean>> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('檢核清單格式錯誤');
  }
  const rows = Object.entries(value);
  if (rows.length > 50 || rows.some(([key, done]) => !/^[A-Za-z0-9_-]{1,80}$/.test(key) || typeof done !== 'boolean')) {
    throw new Error('檢核清單內容無法驗證');
  }
  return value as Record<string, boolean>;
}

export async function saveCreditChecklistStatus(
  storageKey: string,
  status: Record<string, boolean>,
): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(status));
}

export async function saveCreditAuditSavedCourses(
  storageKey: string,
  courses: SavedCourse[],
): Promise<void> {
  await savePersistedValue(storageKey, courses);
}

export async function listStoredEnrollments(
  uid: string,
  schoolId: string,
): Promise<StoredEnrollment[]> {
  const db = getDb();
  const canonicalSnapshot = await getDocs(
    collectionFromSegments(db, buildUserSchoolCollectionPath(uid, schoolId, 'enrollments')),
  ).catch(() => null);

  if (canonicalSnapshot && !canonicalSnapshot.empty) {
    return canonicalSnapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<StoredEnrollment, 'id'>),
    }));
  }

  const legacySnapshot = await getDocs(collectionFromSegments(db, ['users', uid, 'enrollments']));
  // 舊的全域修課紀錄可能含其他校區的列。只收明確帶有這個校區 ID 的列；沒有校區 ID 的舊列維持隱藏。
  return legacySnapshot.docs.flatMap((docSnap) => {
    const data = docSnap.data() as Omit<StoredEnrollment, 'id'> & { schoolId?: string };
    return data.schoolId === schoolId ? [{ ...data, id: docSnap.id }] : [];
  });
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
    docFromSegments(
      db,
      buildUserSchoolCollectionPath(params.uid, params.schoolId, 'enrollments', params.course.id),
    ),
    {
      courseId: params.course.id,
      courseName: params.course.name,
      credits: params.course.credits,
      category: params.course.category,
      schoolId: params.schoolId,
      passed: params.course.passed,
      grade: params.course.grade ?? null,
      semester: params.course.semester ?? null,
      status: params.course.passed ? 'completed' : 'in_progress',
      source: 'credit-audit-input',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
}

export async function deleteCreditAuditEnrollment(params: {
  uid: string;
  schoolId: string;
  enrollmentId: string;
}): Promise<void> {
  const db = getDb();
  await deleteDoc(
    docFromSegments(
      db,
      buildUserSchoolCollectionPath(
        params.uid,
        params.schoolId,
        'enrollments',
        params.enrollmentId,
      ),
    ),
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
      docFromSegments(
        db,
        buildUserSchoolCollectionPath(params.uid, params.schoolId, 'enrollments', course.id),
      ),
      {
        courseId: course.id,
        courseName: course.name,
        credits: course.credits,
        category: course.category,
        schoolId: params.schoolId,
        passed: course.passed,
        grade: course.grade ?? null,
        semester: course.semester ?? null,
        status: course.passed ? 'completed' : 'in_progress',
        source: 'credit-audit-input',
        localCreatedAt: course.createdAt,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

  await batch.commit();
}
