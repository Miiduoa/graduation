import { describe, expect, it } from 'vitest';

import {
  appendSchoolContext,
  buildSsoCallbackPath,
  extractSchoolContextFromPath,
  loginHref,
  readLoginReturnParam,
  sanitizeInternalPath,
} from './navigation';

const SCHOOL_CONTEXT = {
  code: 'DEMO',
  id: 'tw-demo-uni',
};

describe('navigation school context helpers', () => {
  it('sanitizes unsafe internal paths', () => {
    expect(sanitizeInternalPath('https://example.com')).toBe('/');
    expect(sanitizeInternalPath('//example.com')).toBe('/');
    expect(sanitizeInternalPath('/course/abc?tab=modules')).toBe('/course/abc?tab=modules');
  });

  it('appends school context without dropping existing search params', () => {
    const url = new URL(
      appendSchoolContext('/login?redirect=%2Fcourse%2Fabc', SCHOOL_CONTEXT),
      'https://campus.local',
    );

    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirect')).toBe('/course/abc');
    expect(url.searchParams.get('school')).toBe('DEMO');
    expect(url.searchParams.get('schoolId')).toBe('tw-demo-uni');
  });

  it('builds an SSO callback path with a safe returnUrl', () => {
    const url = new URL(
      buildSsoCallbackPath(SCHOOL_CONTEXT, 'oidc', '/course/abc'),
      'https://campus.local',
    );

    expect(url.pathname).toBe('/sso-callback');
    expect(url.searchParams.get('provider')).toBe('oidc');
    expect(url.searchParams.get('school')).toBe('DEMO');
    expect(url.searchParams.get('schoolId')).toBe('tw-demo-uni');
    expect(url.searchParams.get('returnUrl')).toBe('/course/abc');
  });

  it('extracts school context from internal paths', () => {
    expect(extractSchoolContextFromPath('/login?school=DEMO&schoolId=tw-demo-uni')).toEqual({
      school: 'DEMO',
      schoolId: 'tw-demo-uni',
    });
  });
});

it.each([
  'https://outside.test',
  '//outside.test',
  '/\\outside.test',
  '/\n/outside.test',
  'javascript:alert(1)',
])('rejects an external or ambiguous login destination %j', (path) => {
  expect(sanitizeInternalPath(path)).toBe('/');
});
it('preserves a course destination and its query and fragment', () => {
  expect(sanitizeInternalPath('/course/one?tab=work#assignment-two')).toBe(
    '/course/one?tab=work#assignment-two',
  );
});

it('builds a login href that returns to the original storefront', () => {
  expect(loginHref('/cafeteria/stall?schoolId=pu')).toBe(
    '/login?returnUrl=%2Fcafeteria%2Fstall%3FschoolId%3Dpu',
  );
});

it('reads returnUrl, returnTo or redirect and drops off-site values', () => {
  expect(readLoginReturnParam(new URLSearchParams({ returnTo: '/cafeteria/stall' }))).toBe(
    '/cafeteria/stall',
  );
  expect(readLoginReturnParam(new URLSearchParams({ redirect: '/lost-found' }))).toBe(
    '/lost-found',
  );
  expect(sanitizeInternalPath(readLoginReturnParam(new URLSearchParams({ returnUrl: 'https://evil.test' })))).toBe(
    '/',
  );
});
