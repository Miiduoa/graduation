import { getAuth, getCloudFunctionUrl, isFirebaseConfigured } from './firebase';
import {
  normalizeCourseRecords,
  normalizeGradeRecords,
  type AcademicCourseResponse,
  type AcademicGradeResponse,
} from './academicRecords';
import { isOfficialAcademicSchool } from './academicOfficialSchool';
import { LMS_CONNECTING_CODE } from './schoolLoginTimeouts';
import { withSchoolDataDeadline } from './schoolDataRequest';

export type AcademicKind = 'courses' | 'grades';
export type AcademicData = { courses: AcademicCourseResponse; grades: AcademicGradeResponse };
export type AcademicSnapshot<K extends AcademicKind> = {
  ownerUid: string;
  schoolId: 'pu';
  fetchedAt: string;
  records: AcademicData[K];
};

export class AcademicConnectionError extends Error {
  constructor(
    public readonly reason: 'reconnect' | 'unavailable' | 'permission' | 'unconfigured' | 'connecting',
    cause?: unknown,
  ) {
    super(reason, cause === undefined ? undefined : { cause });
    this.name = 'AcademicConnectionError';
  }
}

function callableDetailCode(error: unknown): string {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return '';
  const details = (error as Record<string, unknown>).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return '';
  const code = (details as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
}

async function readAcademicResponse(kind: AcademicKind, uid: string): Promise<unknown> {
  const user = getAuth()?.currentUser;
  if (!user || user.uid !== uid) throw new AcademicConnectionError('reconnect');
  return withSchoolDataDeadline(async (signal) => {
    const token = await user.getIdToken();
    // 取得 token 期間可能切換帳號；舊讀取不能帶著新登入繼續送出。
    if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
    if (signal.aborted) throw new AcademicConnectionError('unavailable');
    const response = await fetch(getCloudFunctionUrl('getMyAcademicRecords'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { dataType: kind } }),
      cache: 'no-store',
      signal,
    });
    const payload: unknown = await response.json();
    if (getAuth()?.currentUser !== user) throw new AcademicConnectionError('reconnect');
    if (signal.aborted) throw new AcademicConnectionError('unavailable');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid academic response');
    }
    const envelope = payload as Record<string, unknown>;
    if (!response.ok || envelope.error) {
      const error = envelope.error;
      const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
      const status = typeof details.status === 'string' ? details.status : '';
      const message = typeof error === 'string' ? error
        : typeof details.message === 'string' ? details.message : '';
      const cause = new Error(message || '校務資料讀取失敗。');
      if (callableDetailCode(details) === LMS_CONNECTING_CODE) {
        throw new AcademicConnectionError('connecting', cause);
      }
      if (status === 'UNAUTHENTICATED' || status === 'FAILED_PRECONDITION' || response.status === 401) {
        throw new AcademicConnectionError('reconnect', cause);
      }
      if (status === 'PERMISSION_DENIED' || response.status === 403) {
        throw new AcademicConnectionError('permission', cause);
      }
      if (/尚未啟用|未設定/.test(message)) {
        throw new AcademicConnectionError('unconfigured', cause);
      }
      throw new AcademicConnectionError('unavailable', cause);
    }
    return envelope.result ?? envelope.data;
  });
}

/**
 * Loads official academic records for the signed-in account.
 * `expectedSchool` is a client gate only — the callable still receives `{ dataType }`.
 * Ownership remains server-authoritative (auth token / membership / provenance).
 */
export async function loadAcademicRecords<K extends AcademicKind>(
  kind: K,
  uid: string,
  expectedSchool: string = 'pu',
): Promise<AcademicSnapshot<K>> {
  if (!isOfficialAcademicSchool(expectedSchool)) {
    throw new AcademicConnectionError('unavailable');
  }
  if (!uid || !isFirebaseConfigured() || getAuth()?.currentUser?.uid !== uid) {
    throw new AcademicConnectionError('unavailable');
  }
  try {
    const data = await readAcademicResponse(kind, uid);
    if (!data || typeof data !== 'object') throw new Error('Invalid academic response');
    const row = data as Record<string, unknown>;
    if (
      row.success !== true ||
      row.ownerUid !== uid ||
      getAuth()?.currentUser?.uid !== uid ||
      row.schoolId !== expectedSchool ||
      row.source !== 'pu-campus' ||
      row.dataType !== kind ||
      typeof row.fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.fetchedAt))
    ) {
      throw new Error('Academic response does not match the current account');
    }
    const records =
      kind === 'courses' ? normalizeCourseRecords(row.result) : normalizeGradeRecords(row.result);
    return {
      ownerUid: uid,
      schoolId: expectedSchool,
      fetchedAt: row.fetchedAt,
      records,
    } as AcademicSnapshot<K>;
  } catch (error) {
    if (error instanceof AcademicConnectionError) throw error;
    const code = (error as { code?: string })?.code;
    if (code === 'functions/failed-precondition' || code === 'functions/unauthenticated') {
      throw new AcademicConnectionError('reconnect', error);
    }
    if (code === 'functions/permission-denied') {
      throw new AcademicConnectionError('permission', error);
    }
    throw new AcademicConnectionError('unavailable', error);
  }
}
