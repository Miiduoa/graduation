import { isProvidenceSchoolId } from '../data/schoolIds';

/** The legacy transport hub uses fixed Providence and Taichung stations. */
export function supportsLegacyTransportHub(schoolId?: string | null): boolean {
  return isProvidenceSchoolId(schoolId);
}
