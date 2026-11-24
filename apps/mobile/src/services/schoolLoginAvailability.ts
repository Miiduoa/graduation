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
let providerCacheGeneration = 0;

export function setSchoolLoginProviderKinds(kinds: string[] | undefined) {
  providerCacheGeneration += 1;
  providerCache = kinds ? { kinds: [...kinds] } : undefined;
}

export function resetSchoolLoginProviderCache() {
  providerCacheGeneration += 1;
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
  if (providerCache) return [...providerCache.kinds];
  const generation = providerCacheGeneration;
  try {
    const value = await nuniPlatformRequest('providers');
    if (generation !== providerCacheGeneration) return [...(providerCache?.kinds ?? [])];
    if (!value || typeof value !== 'object' || !Array.isArray((value as { kinds?: unknown }).kinds)) {
      return []; // Malformed is unknown, not a confirmed closed integration.
    }
    const kinds = (value as { kinds: unknown[] }).kinds;
    if (!kinds.every((kind): kind is string => typeof kind === 'string')) return [];
    // Cache confirmed responses, including an explicitly empty provider list.
    providerCache = { kinds: [...kinds] };
    return [...kinds];
  } catch {
    // Keep unavailable fail-closed, but let the next entry retry a transient outage.
    return [...(providerCache?.kinds ?? [])];
  }
}
