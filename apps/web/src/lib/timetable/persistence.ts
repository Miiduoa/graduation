'use client';

import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { cleanCourses, cleanMeta, timetableIndex, type PersonalCourse, type TimetableMeta } from '@campus/shared';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';
import {
  acknowledgeTimetableCache,
  preferLocalTimetable,
  readTimetableCache,
  TimetableLocalReadError,
  writeTimetableCache,
  type TimetableCache,
} from './localCache';
import { setTimetableSyncStatus, type TimetableSyncStatus } from './syncStatus';

export type StoredTimetable = {
  courses: PersonalCourse[];
  meta: TimetableMeta;
  shareWithFriends: boolean;
  updatedAt: string;
  schoolId: string;
};

export const CLOUD_NEEDS_SCHOOL_COPY = '登入學校帳號後才能存到雲端';

export class TimetableCloudSaveError extends Error {
  constructor(readonly reason: unknown) {
    super('timetable-cloud-save-failed');
    this.name = 'TimetableCloudSaveError';
  }
}

class TimetableSchoolConflictError extends Error {}

export function emptyTimetable(schoolId: string): StoredTimetable {
  return { courses: [], meta: cleanMeta({}), shareWithFriends: true, updatedAt: new Date().toISOString(), schoolId };
}

function savedAtMillis(value: unknown): number {
  try {
    const millis = typeof value === 'string' ? Date.parse(value) :
      value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis() : 0;
    return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15 ? millis : 0;
  } catch {
    return 0;
  }
}

function normalize(value: unknown, schoolId: string): StoredTimetable {
  const data = value as Partial<StoredTimetable>;
  return {
    courses: cleanCourses(data.courses),
    meta: cleanMeta(data.meta),
    shareWithFriends: data.shareWithFriends !== false,
    updatedAt: new Date(savedAtMillis(data.updatedAt)).toISOString(),
    schoolId,
  };
}

function readLocal(uid: string | null, schoolId: string): TimetableCache | null {
  try {
    return readTimetableCache(localStorage, uid, schoolId);
  } catch (error) {
    setTimetableSyncStatus(uid, schoolId, {
      kind: 'error',
      detail: error instanceof TimetableLocalReadError && error.reason === 'invalid' ? 'local-data' : 'local-unavailable',
    });
    throw error;
  }
}

function showLocal(uid: string | null, schoolId: string, copy: TimetableCache | null, kind?: TimetableSyncStatus['kind']): StoredTimetable {
  setTimetableSyncStatus(uid, schoolId, {
    kind: kind || (uid && copy?.pending ? 'pending' : 'local'),
    ...(copy ? { savedAt: copy.value.updatedAt } : {}),
  });
  return copy ? normalize(copy.value, schoolId) : emptyTimetable(schoolId);
}

export async function loadPersonalTimetable(uid: string | null, schoolId: string): Promise<StoredTimetable> {
  setTimetableSyncStatus(uid, schoolId, { kind: 'loading' });
  const initial = readLocal(uid, schoolId);
  if (!uid || !isFirebaseConfigured()) return showLocal(uid, schoolId, initial);
  let snap;
  try {
    snap = await getDocFromServer(doc(getDb(), 'users', uid, 'personalTimetable', 'current'));
  } catch (error) {
    const latest = readLocal(uid, schoolId);
    if (latest) return showLocal(uid, schoolId, latest, latest.pending ? 'pending' : 'offline');
    // 沒確認雲端是否有資料前，不把訪客課表當成登入帳號的課表。
    setTimetableSyncStatus(uid, schoolId, { kind: 'error', detail: 'read-failed' });
    throw error;
  }
  const local = readLocal(uid, schoolId);
  if (!snap.exists()) {
    // 只有確定帳號沒有雲端課表，才接回同校園的訪客草稿。
    return showLocal(uid, schoolId, local || readLocal(null, schoolId), local ? undefined : 'local');
  }
  const data = snap.data();
  if (data.schoolId !== schoolId) return showLocal(uid, schoolId, local, 'conflict');
  if (!Array.isArray(data.courses)) {
    if (local) return showLocal(uid, schoolId, local, local.pending ? 'pending' : 'offline');
    setTimetableSyncStatus(uid, schoolId, { kind: 'error', detail: 'read-failed' });
    throw new Error('invalid-cloud-timetable');
  }
  // 包含刪掉最後一門課的待同步版本；不依課程數量決定是否保留。
  // 讀取途中有新的本機修改時，也不讓晚回來的雲端結果蓋掉它。
  if (preferLocalTimetable(local, savedAtMillis(data.updatedAt)) ||
    (local && local.revision !== initial?.revision)) {
    return showLocal(uid, schoolId, local, 'pending');
  }
  const next = normalize(data, schoolId);
  try {
    writeTimetableCache(localStorage, uid, { version: 2, revision: crypto.randomUUID(), pending: false, value: next });
    setTimetableSyncStatus(uid, schoolId, { kind: 'synced', savedAt: next.updatedAt });
  } catch {
    setTimetableSyncStatus(uid, schoolId, { kind: 'synced', savedAt: next.updatedAt, detail: 'cache-unavailable' });
  }
  return next;
}

const writes = new Map<string, Promise<void>>();

function enqueue<T>(uid: string, work: () => Promise<T>): Promise<T> {
  const result = (writes.get(uid) || Promise.resolve()).then(work, work);
  const settled = result.then(() => undefined, () => undefined);
  writes.set(uid, settled);
  void settled.then(() => { if (writes.get(uid) === settled) writes.delete(uid); });
  return result;
}

function publishIfCurrent(uid: string, copy: TimetableCache, status: TimetableSyncStatus): void {
  try {
    if (readTimetableCache(localStorage, uid, copy.value.schoolId)?.revision === copy.revision) {
      setTimetableSyncStatus(uid, copy.value.schoolId, status);
    }
  } catch {
    // 儲存結果不因狀態列無法更新而被改寫。
  }
}

export async function savePersonalTimetable(uid: string | null, timetable: StoredTimetable): Promise<{ stored: 'cloud' | 'local' }> {
  const schoolId = timetable.schoolId;
  if (!schoolId.trim()) throw new Error('missing-timetable-school');
  // 既有資料無法解讀時，不直接用新資料覆蓋。
  readLocal(uid, schoolId);
  const next = { ...normalize(timetable, schoolId), updatedAt: new Date().toISOString() };
  const copy: TimetableCache<StoredTimetable> = { version: 2, revision: crypto.randomUUID(), pending: true, value: next };
  try {
    writeTimetableCache(localStorage, uid, copy);
  } catch (error) {
    setTimetableSyncStatus(uid, schoolId, { kind: 'error', detail: 'local-unavailable' });
    throw error;
  }
  if (!uid || !isFirebaseConfigured() || getAuth()?.currentUser?.uid !== uid) {
    showLocal(uid, schoolId, copy, 'local');
    return { stored: 'local' };
  }
  setTimetableSyncStatus(uid, schoolId, { kind: 'syncing', savedAt: next.updatedAt });
  return enqueue(uid, async () => {
    if (getAuth()?.currentUser?.uid !== uid) {
      publishIfCurrent(uid, copy, { kind: 'local', savedAt: next.updatedAt });
      return { stored: 'local' as const };
    }
    try {
      const ref = doc(getDb(), 'users', uid, 'personalTimetable', 'current');
      await runTransaction(getDb(), async (transaction) => {
        const current = await transaction.get(ref);
        if (getAuth()?.currentUser?.uid !== uid) throw new Error('timetable-account-changed');
        // current 仍是舊客戶端與分享功能使用的文件，先保護它，不做不完整的多校遷移。
        if (current.exists() && current.data().schoolId !== schoolId) throw new TimetableSchoolConflictError();
        transaction.set(ref, { ...next, ...timetableIndex(next.courses), updatedAt: serverTimestamp() });
      });
    } catch (error) {
      publishIfCurrent(uid, copy, {
        kind: error instanceof TimetableSchoolConflictError ? 'conflict' : 'pending',
        savedAt: next.updatedAt,
      });
      throw new TimetableCloudSaveError(error);
    }
    try {
      if (acknowledgeTimetableCache(localStorage, uid, schoolId, copy.revision)) {
        setTimetableSyncStatus(uid, schoolId, { kind: 'synced', savedAt: next.updatedAt });
      }
    } catch {
      setTimetableSyncStatus(uid, schoolId, { kind: 'error', detail: 'local-unavailable' });
    }
    return { stored: 'cloud' as const };
  });
}

export async function retryPersonalTimetableSync(uid: string, schoolId: string): Promise<void> {
  const local = readLocal(uid, schoolId);
  if (!local) return;
  await savePersonalTimetable(uid, normalize(local.value, schoolId));
}
