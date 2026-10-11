import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import { getReleaseConfig, getSchoolIntegrationStatus } from './release';

/** School authentication is optional and only opens for an accepted integration. */
export function isStudentIdLoginAvailable(schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID): boolean {
  if (schoolId !== PROVIDENCE_UNIVERSITY_SCHOOL_ID) return false;
  const status = getSchoolIntegrationStatus(schoolId);
  return getReleaseConfig().features.enabled && status.enabled && status.sso;
}
