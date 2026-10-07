import { httpsCallable } from 'firebase/functions';
import { getAuth, getFunctionsInstance, isFirebaseConfigured } from './firebase';
import {
  normalizeCourseRecords,
  normalizeGradeRecords,
  type AcademicCourseResponse,
  type AcademicGradeResponse,
} from './academicRecords';

export type AcademicKind = 'courses' | 'grades';
export type AcademicData = { courses: AcademicCourseResponse; grades: AcademicGradeResponse };
export type AcademicSnapshot<K extends AcademicKind> = {
  ownerUid: string;
  schoolId: 'pu';
  fetchedAt: string;
  records: AcademicData[K];
};
export class AcademicConnectionError extends Error {
  constructor(public readonly reason: 'reconnect' | 'unavailable' | 'permission') {
    super(reason);
  }
}

export async function loadAcademicRecords<K extends AcademicKind>(
  kind: K,
  uid: string,
): Promise<AcademicSnapshot<K>> {
  if (!uid || !isFirebaseConfigured() || getAuth()?.currentUser?.uid !== uid) {
    throw new AcademicConnectionError('unavailable');
  }
  try {
    const call = httpsCallable<{ dataType: AcademicKind }, unknown>(
      getFunctionsInstance(),
      'getMyAcademicRecords',
    );
    const { data } = await call({ dataType: kind });
    if (!data || typeof data !== 'object') throw new Error('Invalid academic response');
    const row = data as Record<string, unknown>;
    if (
      row.success !== true ||
      row.ownerUid !== uid ||
      getAuth()?.currentUser?.uid !== uid ||
      row.schoolId !== 'pu' ||
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
      schoolId: 'pu',
      fetchedAt: row.fetchedAt,
      records,
    } as AcademicSnapshot<K>;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'functions/failed-precondition' || code === 'functions/unauthenticated') {
      throw new AcademicConnectionError('reconnect');
    }
    if (code === 'functions/permission-denied') throw new AcademicConnectionError('permission');
    throw new AcademicConnectionError('unavailable');
  }
}
