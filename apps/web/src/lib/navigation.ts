import { sanitizeLoginReturnPath } from '@campus/shared/src/signedInSocialReads';
import { findSchoolById } from '@campus/shared/src/schools';

export type SchoolContext = {
  code: string;
  id: string;
};

function toUrl(path: string): URL {
  return new URL(path, 'https://campus.local');
}

export function sanitizeInternalPath(value?: string | null, fallback: string = '/'): string {
  return sanitizeLoginReturnPath(value, fallback);
}

export function readLoginReturnParam(params: { get(name: string): string | null }): string | null {
  return params.get('returnUrl') || params.get('returnTo') || params.get('redirect');
}

export function loginHref(returnPath: string): string {
  return `/login?returnUrl=${encodeURIComponent(sanitizeInternalPath(returnPath))}`;
}

export function extractSchoolContextFromPath(path?: string | null): {
  school?: string;
  schoolId?: string;
} {
  const safePath = sanitizeInternalPath(path);
  const url = toUrl(safePath);

  return {
    school: url.searchParams.get('school') || undefined,
    schoolId: url.searchParams.get('schoolId') || undefined,
  };
}

/** Preserve the browsing campus when moving between public service pages. */
export function browsingSchoolSearch(
  params: { get(name: string): string | null } | null | undefined,
  selectedSchoolId: string | null,
): string {
  const campus = params?.get('campus');
  if (campus === 'all') return '?campus=all';

  const schoolId = campus || params?.get('schoolId') || selectedSchoolId;
  if (!schoolId || !/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(schoolId)) return '';

  const school = findSchoolById(schoolId);
  const search = school ? buildSchoolSearch({ code: school.code, id: school.id })
    : `?schoolId=${encodeURIComponent(schoolId)}`;
  return `${search}&campus=${encodeURIComponent(schoolId)}`;
}

export function buildSchoolSearch(context: SchoolContext): string {
  const search = new URLSearchParams({
    school: context.code,
    schoolId: context.id,
  });

  return `?${search.toString()}`;
}

export function appendSchoolContext(path: string, context: SchoolContext): string {
  const safePath = sanitizeInternalPath(path);
  const url = toUrl(safePath);

  url.searchParams.set('school', context.code);
  url.searchParams.set('schoolId', context.id);

  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildSsoCallbackPath(
  context: SchoolContext,
  provider: 'oidc' | 'cas' | 'saml',
  returnUrl?: string | null,
  extraParams?: Record<string, string | null | undefined>,
): string {
  const url = toUrl('/sso-callback');
  url.searchParams.set('school', context.code);
  url.searchParams.set('schoolId', context.id);
  url.searchParams.set('provider', provider);

  const safeReturnUrl = sanitizeInternalPath(returnUrl);
  if (safeReturnUrl !== '/') {
    url.searchParams.set('returnUrl', safeReturnUrl);
  }

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (typeof value === 'string' && value) {
      url.searchParams.set(key, value);
    }
  }

  return `${url.pathname}${url.search}`;
}
