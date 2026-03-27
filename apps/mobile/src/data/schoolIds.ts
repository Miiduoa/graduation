import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from "@campus/shared/src";

export const PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID = "tw-pu";

export function isProvidenceSchoolId(schoolId?: string | null): boolean {
  return (
    schoolId === PROVIDENCE_UNIVERSITY_SCHOOL_ID ||
    schoolId === PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID
  );
}

export function toInternalSchoolId(schoolId?: string | null): string | null {
  if (!schoolId) return null;
  return isProvidenceSchoolId(schoolId)
    ? PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID
    : schoolId;
}

export function toPublicSchoolId(schoolId?: string | null): string | null {
  if (!schoolId) return null;
  return isProvidenceSchoolId(schoolId)
    ? PROVIDENCE_UNIVERSITY_SCHOOL_ID
    : schoolId;
}
