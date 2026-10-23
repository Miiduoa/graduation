import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import { findSchoolById } from '@campus/shared/src/schools';

export const DEFAULT_BROWSE_SCHOOL_ID = PROVIDENCE_UNIVERSITY_SCHOOL_ID;

export function defaultBrowseSchoolId(
  catalogIds: readonly string[],
  queryId: string | null | undefined,
  stored: boolean,
  savedSchoolId: string | null,
): string | null {
  if (queryId === 'all') return null;
  if (queryId) return queryId;
  if (stored) return savedSchoolId;
  return catalogIds.includes(DEFAULT_BROWSE_SCHOOL_ID) ? DEFAULT_BROWSE_SCHOOL_ID : null;
}

export function fallbackBusSchool(
  schoolId: string | null,
  schoolName: string,
  status: 'ready' | 'loading' | 'error' | 'unselected',
): { schoolId: string | null; schoolName: string } {
  if (status === 'loading' || status === 'error') return { schoolId, schoolName };
  if (schoolId) return { schoolId, schoolName };
  const school = findSchoolById(DEFAULT_BROWSE_SCHOOL_ID);
  return { schoolId: DEFAULT_BROWSE_SCHOOL_ID, schoolName: school?.name || '靜宜大學' };
}
