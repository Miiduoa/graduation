import { normalizePuCreditOverview, type PuCreditOverviewSnapshot } from '@campus/shared/src/puCreditOverview';
import { AcademicConnectionError, readAcademicResponse } from './academicClient';
import { getAuth, isFirebaseConfigured } from './firebase';
import { isOfficialAcademicSchool } from './academicOfficialSchool';

export async function loadSchoolCreditOverview(uid: string, schoolId: string): Promise<PuCreditOverviewSnapshot> {
  const requester = getAuth()?.currentUser;
  if (!uid || !isOfficialAcademicSchool(schoolId) || !isFirebaseConfigured())
    throw new AcademicConnectionError('unavailable');
  if (requester?.uid !== uid) throw new AcademicConnectionError('reconnect');
  try {
    const value = await readAcademicResponse('creditOverview', uid);
    const row = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? row.result as Record<string, unknown> : {};
    const overview = normalizePuCreditOverview(result.creditOverview);
    if (getAuth()?.currentUser !== requester) throw new AcademicConnectionError('reconnect');
    if (row.success !== true || row.ownerUid !== uid ||
        row.schoolId !== 'pu' || row.source !== 'pu-campus' || row.dataType !== 'creditOverview' ||
        typeof row.fetchedAt !== 'string' || !Number.isFinite(Date.parse(row.fetchedAt)) ||
        result.success !== true || !overview) throw new AcademicConnectionError('unavailable');
    return { ownerUid: uid, schoolId: 'pu', fetchedAt: row.fetchedAt, overview };
  } catch (error) {
    if (error instanceof AcademicConnectionError) throw error;
    throw new AcademicConnectionError('unavailable', error);
  }
}
