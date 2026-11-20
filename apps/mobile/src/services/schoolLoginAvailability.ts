import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import {
  SCHOOL_LOGIN_BIND_HINT,
  hasUsableSchoolLoginProvider,
} from '@campus/shared/src/schoolLogin';
import { nuniPlatformRequest } from './nuniClient';
import { getReleaseConfig, getSchoolIntegrationStatus } from './release';

export { SCHOOL_LOGIN_BIND_HINT, hasUsableSchoolLoginProvider };

type ProviderCache = { kinds: string[] };
let providerCache: ProviderCache | undefined;

export function setSchoolLoginProviderKinds(kinds: string[] | undefined) {
  providerCache = kinds ? { kinds } : undefined;
}

export function resetSchoolLoginProviderCache() {
  providerCache = undefined;
}

/** School authentication is optional and only opens for an accepted integration. */
export function isStudentIdLoginAvailable(schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID): boolean {
  if (schoolId !== PROVIDENCE_UNIVERSITY_SCHOOL_ID) return false;
  const status = getSchoolIntegrationStatus(schoolId);
  return getReleaseConfig().features.enabled && status.enabled && status.sso;
}

export function isSchoolLoginEntryAvailable(schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID): boolean {
  return isStudentIdLoginAvailable(schoolId) && hasUsableSchoolLoginProvider(providerCache?.kinds);
}

export async function loadSchoolLoginProviderKinds(): Promise<string[]> {
  if (providerCache) return providerCache.kinds;
  try {
    const value = await nuniPlatformRequest('providers');
    const kinds =
      value && typeof value === 'object' && Array.isArray((value as { kinds?: unknown }).kinds)
        ? (value as { kinds: unknown[] }).kinds.filter((kind): kind is string => typeof kind === 'string')
        : [];
    providerCache = { kinds };
    return kinds;
  } catch {
    providerCache = { kinds: [] };
    return [];
  }
}
