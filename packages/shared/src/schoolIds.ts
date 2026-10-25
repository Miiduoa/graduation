import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from './puAuth';

/** Internal adapter / demo alias for Providence University. */
export const PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID = 'tw-pu';

export function isProvidenceSchoolId(schoolId?: string | null): boolean {
  return (
    schoolId === PROVIDENCE_UNIVERSITY_SCHOOL_ID ||
    schoolId === PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID
  );
}

/** Canonical public id for capability lookups (`pu` for Providence aliases). */
export function toPublicSchoolId(schoolId?: string | null): string | null {
  if (!schoolId) return null;
  return isProvidenceSchoolId(schoolId) ? PROVIDENCE_UNIVERSITY_SCHOOL_ID : schoolId;
}

export function toInternalSchoolId(schoolId?: string | null): string | null {
  if (!schoolId) return null;
  return isProvidenceSchoolId(schoolId) ? PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID : schoolId;
}
