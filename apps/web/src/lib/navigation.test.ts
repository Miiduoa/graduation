import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendSchoolContext,
  buildSsoCallbackPath,
  collapseInternalPathHash,
  currentReturnPath,
  extractSchoolContextFromPath,
  followLoginHref,
  loginHref,
  navigateAfterLogin,
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

it('keeps a single return fragment and ends the login href with # so client routing cannot keep the page hash', () => {
  expect(collapseInternalPathHash('/course/cs101#assignment-hw-3#assignment-hw-3')).toBe(
    '/course/cs101#assignment-hw-3',
  );
  expect(currentReturnPath('/course/cs101', '', '#assignment-hw-3')).toBe(
    '/course/cs101#assignment-hw-3',
  );
  expect(currentReturnPath('/course/cs101', '', '#assignment-hw-3#assignment-hw-3')).toBe(
    '/course/cs101#assignment-hw-3',
  );
  expect(currentReturnPath('/course/cs101', 'view=work', 'assignment-hw-3')).toBe(
    '/course/cs101?view=work#assignment-hw-3',
  );
  expect(loginHref('/course/cs101#assignment-hw-3')).toBe(
    '/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#',
  );
  expect(loginHref('/course/cs101#assignment-hw-3#assignment-hw-3')).toBe(
    '/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#',
  );
  expect(sanitizeInternalPath('https://evil.test#assignment-hw-3')).toBe('/');
  expect(loginHref('https://evil.test#assignment-hw-3')).toBe('/login?returnUrl=%2F');
});

it('follows a login href with a full navigation so the current page hash cannot stack', () => {
  const assign = vi.fn();
  const setAttribute = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  try {
    followLoginHref(
      { preventDefault() {}, currentTarget: { setAttribute } },
      currentReturnPath('/course/cs101', '', '#assignment-hw-3#assignment-hw-3'),
    );
    expect(setAttribute).toHaveBeenCalledWith(
      'href',
      '/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#',
    );
    expect(assign).toHaveBeenCalledWith('/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('clears a leftover login fragment before returning to a single course-work hash', () => {
  const replace = vi.fn();
  window.history.replaceState(
    null,
    '',
    '/login?returnUrl=%2Fcourse%2Fcs101%23assignment-hw-3#assignment-hw-3',
  );
  try {
    navigateAfterLogin(replace, '/course/cs101#assignment-hw-3#assignment-hw-3');
    expect(replace).toHaveBeenCalledWith('/course/cs101#assignment-hw-3');
    expect(window.location.hash).toBe('');
  } finally {
    window.history.replaceState(null, '', '/');
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
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
