import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from '@campus/shared/src';
import { isPuEcampusDataFetchEnabled } from '@campus/shared/src/puEcampusDataPolicy';
import {
  SCHOOL_LOGIN_BIND_HINT,
  hasUsableSchoolLoginProvider,
} from '@campus/shared/src/schoolLogin';
import { getRawAppEnv, getReleaseConfig, getSchoolIntegrationStatus } from './release';

export { SCHOOL_LOGIN_BIND_HINT, hasUsableSchoolLoginProvider };

type ProviderCache = { kinds: string[] };
export type SchoolLoginAvailabilityState =
  | 'unknown'
  | 'loading'
  | 'available'
  | 'unavailable'
  | 'error';

const providerCache = new Map<string, ProviderCache>();
const pendingRequests = new Map<string, Promise<string[]>>();
const failedRequests = new Set<string>();

function currentProviderKinds(schoolId: string): string[] {
  return [...(providerCache.get(schoolId)?.kinds ?? [])];
}

export function setSchoolLoginProviderKinds(
  kinds: string[] | undefined,
  schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID,
) {
  pendingRequests.delete(schoolId);
  failedRequests.delete(schoolId);
  if (kinds) providerCache.set(schoolId, { kinds: [...kinds] });
  else providerCache.delete(schoolId);
}

export function resetSchoolLoginProviderCache() {
  providerCache.clear();
  pendingRequests.clear();
  failedRequests.clear();
}

/** School authentication is optional and only opens for an accepted integration. */
export function isStudentIdLoginAvailable(schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID): boolean {
  if (schoolId !== PROVIDENCE_UNIVERSITY_SCHOOL_ID) return false;
  const status = getSchoolIntegrationStatus(schoolId);
  return getReleaseConfig().features.enabled && status.enabled && status.sso;
}

export function isSchoolLoginEntryAvailable(schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID): boolean {
  return getSchoolLoginAvailabilityState(schoolId) === 'available';
}

function schoolLoginPolicyAllowsCheck(schoolId: string): boolean {
  // Keep the existing PU pause authoritative, including over cached capabilities.
  // Only a development build may still offer the local fixture sign-in.
  const developmentEntry = typeof __DEV__ !== 'undefined' && __DEV__ && getRawAppEnv() === 'development';
  return (isPuEcampusDataFetchEnabled() || developmentEntry) && isStudentIdLoginAvailable(schoolId);
}

export function getSchoolLoginAvailabilityState(
  schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID,
): SchoolLoginAvailabilityState {
  if (!schoolLoginPolicyAllowsCheck(schoolId)) return 'unavailable';
  const cached = providerCache.get(schoolId);
  if (cached) return hasUsableSchoolLoginProvider(cached.kinds) ? 'available' : 'unavailable';
  if (pendingRequests.has(schoolId)) return 'loading';
  return failedRequests.has(schoolId) ? 'error' : 'unknown';
}

async function requestSchoolSignInOptions(schoolId: string): Promise<unknown> {
  // The platform provider list describes Google/Apple, not school integrations.
  // Request only school capability so Google provider discovery cannot delay it.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('school-login-options-timeout'));
    }, 12_000);
  });
  const request = (async () => {
    const response = await fetch(
      `https://nuni.tw/api/nuni/sign-in-options?scope=school&schoolId=${encodeURIComponent(schoolId)}`,
      {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      },
    );
    if (!response.ok || response.redirected) throw new Error('school-login-options-unavailable');
    const body = await response.text();
    if (body.length > 8192) throw new Error('invalid-school-login-options');
    return JSON.parse(body) as unknown;
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSchoolLoginProviderKinds(
  schoolId = PROVIDENCE_UNIVERSITY_SCHOOL_ID,
): Promise<string[]> {
  // The server capability can restrict an accepted integration, never open one.
  if (!schoolLoginPolicyAllowsCheck(schoolId)) return [];
  if (providerCache.has(schoolId)) return currentProviderKinds(schoolId);
  const existing = pendingRequests.get(schoolId);
  if (existing) return [...await existing];
  failedRequests.delete(schoolId);
  const pending = requestSchoolSignInOptions(schoolId)
    .then((value) => {
      if (pendingRequests.get(schoolId) !== pending) return currentProviderKinds(schoolId);
      if (!schoolLoginPolicyAllowsCheck(schoolId)) return [];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid-school-login-options');
      }
      const options = value as { studentId?: unknown };
      if (typeof options.studentId !== 'boolean') {
        throw new Error('invalid-school-login-options');
      }
      const kinds = options.studentId ? ['student-id'] : [];
      providerCache.set(schoolId, { kinds });
      return [...kinds];
    })
    .catch(() => {
      if (pendingRequests.get(schoolId) === pending && schoolLoginPolicyAllowsCheck(schoolId)) {
        failedRequests.add(schoolId);
      }
      // Fail closed without turning a temporary outage into a cached closure.
      return currentProviderKinds(schoolId);
    })
    .finally(() => {
      if (pendingRequests.get(schoolId) === pending) pendingRequests.delete(schoolId);
    });
  pendingRequests.set(schoolId, pending);
  return [...await pending];
}
