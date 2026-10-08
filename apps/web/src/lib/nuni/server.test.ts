// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { createNuniClasses, parseNuniWorkspace } from '@campus/shared/src/nuni';
import { handleNuni } from './api';
import { finishGoogle, startGoogle } from './oauth';
import {
  LOGIN_COOKIE,
  SESSION_COOKIE,
  boundedJson,
  openCookie,
  nuniEnabled,
  publicOrigin,
  sealCookie,
  sessionContext,
} from './server';

const id = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
const account = 'pa_33333333-3333-4333-8333-333333333333';
const session = () => ({ sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 });
const workspace = { id, title: '設計專題', state: 'active', memberRole: 'owner-teacher' };
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const fetcher = vi.fn();

function request(
  path: string,
  options: { post?: object; cookie?: string; context?: string; origin?: string } = {},
) {
  return new NextRequest(`https://nuni.tw/${path}`, {
    method: options.post ? 'POST' : 'GET',
    headers: {
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.context ? { 'X-Campus-Session': options.context } : {}),
      ...(options.post
        ? { Origin: options.origin ?? 'https://nuni.tw', 'Content-Type': 'application/json' }
        : {}),
    },
    ...(options.post ? { body: JSON.stringify(options.post) } : {}),
  });
}

beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('CAMPUS_BACKEND', '');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubEnv('PLATFORM_GOOGLE_LOGIN_ENABLED', 'true');
  vi.stubEnv('PLATFORM_GOOGLE_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Nuni additive classroom configuration', () => {
  it.each([
    ['true', '', true],
    ['true', 'firebase', true],
    ['', 'nuni', true],
    ['', 'firebase', false],
    ['', '', false],
    ['false', '', false],
    ['1', '', false],
  ])('gates only Nuni access with classroom=%s and legacy=%s', (flag, legacy, expected) => {
    vi.stubEnv('NUNI_CLASSROOM_ENABLED', flag);
    vi.stubEnv('CAMPUS_BACKEND', legacy);
    expect(nuniEnabled()).toBe(expected);
  });

  it('serves the Nuni API with the additive flag while Campus One uses Firebase', async () => {
    vi.stubEnv('CAMPUS_BACKEND', 'firebase');
    const value = session();
    fetcher.mockResolvedValue(response({ workspaces: [workspace] }));
    const result = await handleNuni(
      request('api/nuni/class-workspaces', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['class-workspaces'],
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ workspaces: [workspace] });
  });

  it('keeps the legacy flag as an API-only compatibility gate', async () => {
    vi.stubEnv('NUNI_CLASSROOM_ENABLED', '');
    vi.stubEnv('CAMPUS_BACKEND', 'nuni');
    const result = await handleNuni(request('api/nuni/session'), ['session']);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ authenticated: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps disabled classroom APIs closed and directs OAuth errors to the classroom login', async () => {
    vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'false');
    expect((await handleNuni(request('api/nuni/session'), ['session'])).status).toBe(404);
    const started = await startGoogle(request('auth/platform/start', { post: {} }));
    expect(started.headers.get('location')).toBe(
      'https://nuni.tw/classroom/login?issue=unavailable',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Nuni browser session boundary', () => {
  it('only advertises Google when both the Web and the API are configured', async () => {
    vi.stubEnv('PLATFORM_GOOGLE_CLIENT_SECRET', '');
    expect(
      await (await handleNuni(request('api/nuni/sign-in-options'), ['sign-in-options'])).json(),
    ).toEqual({ google: false });
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('PLATFORM_GOOGLE_CLIENT_SECRET', 'test-secret');
    fetcher.mockResolvedValueOnce(response({ kinds: [] }));
    expect(
      await (await handleNuni(request('api/nuni/sign-in-options'), ['sign-in-options'])).json(),
    ).toEqual({ google: false });
    fetcher.mockResolvedValueOnce(response({ kinds: ['google-consumer'] }));
    expect(
      await (await handleNuni(request('api/nuni/sign-in-options'), ['sign-in-options'])).json(),
    ).toEqual({ google: true });
  });
  it('does not treat an unrelated successful JSON response as acknowledged logout', async () => {
    const value = session();
    fetcher.mockResolvedValue(response({ ok: true }));
    const result = await handleNuni(
      request('api/nuni/logout', {
        post: {},
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['logout'],
    );
    expect(result.status).toBe(502);
    expect(
      openCookie(SESSION_COOKIE, result.cookies.get(SESSION_COOKIE)?.value)?.pendingLogout,
    ).toBe(true);
  });
  it('fails closed for expired cookies without making an authenticated API call', async () => {
    const value = { ...session(), expiresAt: Date.now() - 1000 };
    const result = await handleNuni(
      request('api/nuni/class-workspaces', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['class-workspaces'],
    );
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts the existing encrypted Nuni cookie format and rejects tampering or another purpose', () => {
    const value = session();
    const sealed = sealCookie(SESSION_COOKIE, value);
    expect(sealed).not.toContain(value.sessionHandle);
    expect(openCookie(SESSION_COOKIE, sealed)).toMatchObject(value);
    expect(openCookie(LOGIN_COOKIE, sealed)).toBeNull();
    expect(openCookie(SESSION_COOKIE, `${sealed.slice(0, 8)}!${sealed.slice(9)}`)).toBeNull();
  });
  it('never uses request Host or forwarded headers to allow an external write', async () => {
    const value = session();
    const incoming = request('api/nuni/class-workspaces', {
      post: { title: '課程', idempotencyKey: 'create-12345' },
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
      context: sessionContext(value),
      origin: 'https://attacker.example',
    });
    incoming.headers.set('host', 'attacker.example');
    incoming.headers.set('x-forwarded-host', 'attacker.example');
    expect((await handleNuni(incoming, ['class-workspaces'])).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires explicit valid browser origin configuration', () => {
    vi.stubEnv('WEB_PUBLIC_ORIGIN', '');
    expect(publicOrigin).toThrow();
    vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw/attacker');
    expect(publicOrigin).toThrow();
  });
  it('does not expose the session handle or server privileges in the session response', async () => {
    const value = session();
    fetcher.mockResolvedValue(
      response({
        authenticated: true,
        platformAccountId: account,
        isPlatformOperator: false,
        sessionHandle: value.sessionHandle,
        schoolIssuedRoles: [{ role: 'admin' }],
      }),
    );
    const result = await handleNuni(
      request('api/nuni/session', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
      }),
      ['session'],
    );
    expect(await result.json()).toEqual({
      authenticated: true,
      platformAccountId: account,
      isPlatformOperator: false,
      context: sessionContext(value),
    });
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('rejects stale account writes before calling the backend', async () => {
    const old = session();
    const current = { ...old, sessionHandle: `ps_${'b'.repeat(43)}` };
    const result = await handleNuni(
      request('api/nuni/class-workspaces', {
        post: { title: '課程', idempotencyKey: 'request-123' },
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, current)}`,
        context: sessionContext(old),
      }),
      ['class-workspaces'],
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'SESSION_CHANGED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('blocks ordinary reads after logout revocation fails, while allowing a retry', async () => {
    const value = session();
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    const failed = await handleNuni(
      request('api/nuni/logout', {
        post: {},
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['logout'],
    );
    expect(failed.status).toBe(503);
    const pendingCookie = failed.cookies.get(SESSION_COOKIE)!.value;
    expect(openCookie(SESSION_COOKIE, pendingCookie)?.pendingLogout).toBe(true);
    const blocked = await handleNuni(
      request('api/nuni/class-workspaces', {
        cookie: `${SESSION_COOKIE}=${pendingCookie}`,
        context: sessionContext(value),
      }),
      ['class-workspaces'],
    );
    expect(blocked.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(response({ signedOut: true }));
    const done = await handleNuni(
      request('api/nuni/logout', {
        post: {},
        cookie: `${SESSION_COOKIE}=${pendingCookie}`,
        context: sessionContext(value),
      }),
      ['logout'],
    );
    expect(done.status).toBe(200);
    expect(done.cookies.get(SESSION_COOKIE)?.value).toBe('');
  });
  it('does not erase a newer cookie when a delayed read returns unauthorized', async () => {
    fetcher.mockResolvedValue(response({}, 401));
    const value = session();
    const result = await handleNuni(
      request('api/nuni/session', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
      }),
      ['session'],
    );
    expect(await result.json()).toEqual({ authenticated: false });
    expect(result.headers.has('set-cookie')).toBe(false);
  });
  it('allows only implemented routes, never an arbitrary proxy path', async () => {
    const value = session();
    const result = await handleNuni(
      request('api/nuni/ops', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['ops'],
    );
    expect(result.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects oversized chunked JSON without reading unbounded input', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(20));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      boundedJson(new Response(stream, { headers: { 'content-type': 'application/json' } }), 30),
    ).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  it('rejects cross-origin API redirects without forwarding the platform credential', async () => {
    fetcher.mockResolvedValue(response({ workspaces: [workspace] }));
    const value = session();
    await handleNuni(
      request('api/nuni/class-workspaces', {
        cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, value)}`,
        context: sessionContext(value),
      }),
      ['class-workspaces'],
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.nuni.tw/v1/auth/platform/class-workspaces',
      expect.objectContaining({
        redirect: 'error',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: `Platform ${value.sessionHandle}` }),
      }),
    );
  });
});

describe('Nuni Google authorization code flow', () => {
  const tx = () => ({
    kind: 'google-consumer',
    transactionId: `pt_${'t'.repeat(43)}`,
    nonce: 'n'.repeat(43),
    clientId: '123-test.apps.googleusercontent.com',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    expiresInSeconds: 600,
  });
  it('keeps state, verifier and nonce encrypted and binds S256 to the registered callback', async () => {
    fetcher.mockResolvedValue(response(tx()));
    const started = await startGoogle(request('auth/platform/start', { post: {} }));
    expect(started.status).toBe(303);
    const cookie = started.cookies.get(LOGIN_COOKIE)!.value;
    const login = openCookie(LOGIN_COOKIE, cookie)!;
    const destination = new URL(started.headers.get('location')!);
    expect(destination.origin).toBe('https://accounts.google.com');
    expect(destination.searchParams.get('redirect_uri')).toBe(
      'https://nuni.tw/auth/platform/callback',
    );
    expect(destination.searchParams.get('state')).toBe(login.state);
    expect(destination.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(String(login.verifier)).digest('base64url'),
    );
    expect(started.cookies.get(LOGIN_COOKIE)?.httpOnly).toBe(true);
    expect(cookie).not.toContain(String(login.verifier));
  });
  it('rejects a malicious token endpoint returned by the upstream', async () => {
    fetcher.mockResolvedValue(response({ ...tx(), tokenEndpoint: 'https://attacker.example' }));
    const result = await startGoogle(request('auth/platform/start', { post: {} }));
    expect(result.headers.get('location')).toBe(
      'https://nuni.tw/classroom/login?issue=unavailable',
    );
    expect(result.cookies.has(LOGIN_COOKIE)).toBe(false);
  });
  it('rejects mismatched state before any token exchange', async () => {
    const login = {
      ...tx(),
      state: 's'.repeat(43),
      verifier: 'v'.repeat(43),
      callback: 'https://nuni.tw/auth/platform/callback',
      expiresAt: Date.now() + 600_000,
    };
    const result = await finishGoogle(
      request('auth/platform/callback?state=wrong&code=secret-code', {
        cookie: `${LOGIN_COOKIE}=${sealCookie(LOGIN_COOKIE, login)}`,
      }),
    );
    expect(result.headers.get('location')).toBe('https://nuni.tw/classroom/login?issue=expired');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('exchanges only at Google and stores only the returned platform handle in an HttpOnly cookie', async () => {
    const login = {
      ...tx(),
      state: 's'.repeat(43),
      verifier: 'v'.repeat(43),
      callback: 'https://nuni.tw/auth/platform/callback',
      expiresAt: Date.now() + 600_000,
    };
    fetcher
      .mockResolvedValueOnce(response({ id_token: 'signed-provider-token' }))
      .mockResolvedValueOnce(
        response({ sessionHandle: session().sessionHandle, expiresInSeconds: 3600 }),
      );
    const result = await finishGoogle(
      request(`auth/platform/callback?state=${login.state}&code=secret-code`, {
        cookie: `${LOGIN_COOKIE}=${sealCookie(LOGIN_COOKIE, login)}`,
      }),
    );
    expect(result.headers.get('location')).toBe('https://nuni.tw/classroom');
    expect(
      openCookie(SESSION_COOKIE, result.cookies.get(SESSION_COOKIE)?.value)?.sessionHandle,
    ).toBe(session().sessionHandle);
    expect(result.cookies.get(SESSION_COOKIE)?.httpOnly).toBe(true);
    expect(result.cookies.get(LOGIN_COOKIE)?.value).toBe('');
    expect(fetcher.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetcher.mock.calls[1][0]).toBe('https://api.nuni.tw/v1/auth/platform/sessions');
    expect(JSON.stringify([...result.headers])).not.toContain('signed-provider-token');
  });
  it('rejects a delayed callback when another account is already signed in', async () => {
    const login = {
      ...tx(),
      state: 's'.repeat(43),
      verifier: 'v'.repeat(43),
      callback: 'https://nuni.tw/auth/platform/callback',
      expiresAt: Date.now() + 600_000,
    };
    await finishGoogle(
      request(`auth/platform/callback?state=${login.state}&code=secret-code`, {
        cookie: `${LOGIN_COOKIE}=${sealCookie(LOGIN_COOKIE, login)}; ${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session())}`,
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Nuni coursework contracts', () => {
  it('rejects malformed lists, unknown roles and cross-workspace receipts', async () => {
    expect(() => parseNuniWorkspace({ ...workspace, memberRole: 'admin' })).toThrow();
    const classes = createNuniClasses(async () => ({ workspaces: null }));
    await expect(classes.list()).rejects.toThrow();
    const assignments = createNuniClasses(async () => ({
      assignments: [
        {
          id: assignmentId,
          workspaceId: id.replace('11111111', '99999999'),
          title: '作業',
          instructions: '內容',
          state: 'open',
          createdAt: new Date().toISOString(),
          closedAt: null,
          unitId: null,
          unitTitle: null,
          dueAt: null,
          submissionCount: 0,
          mySubmission: null,
        },
      ],
    }));
    await expect(assignments.assignments(id)).rejects.toThrow();
  });
  it('parses the actual assignment envelope returned after submission, not a fabricated receipt', async () => {
    const assignment = {
      id: assignmentId,
      workspaceId: id,
      title: '作業',
      instructions: '內容',
      state: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      unitId: null,
      unitTitle: null,
      dueAt: null,
      submissionCount: 1,
      mySubmission: {
        assignmentId,
        platformAccountId: account,
        displayName: '同學',
        body: '答案',
        state: 'submitted',
        submittedAt: new Date().toISOString(),
        teacherFeedback: null,
        reviewedAt: null,
      },
    };
    const transport = vi.fn(async () => assignment);
    const result = await createNuniClasses(transport, account).submit(
      id,
      assignmentId,
      '答案',
      'retry-stable-key',
    );
    expect(result.mySubmission?.body).toBe('答案');
    expect(transport).toHaveBeenCalledWith(
      `class-workspaces/${id}/assignments/${assignmentId}/submit`,
      { body: '答案', idempotencyKey: 'retry-stable-key' },
    );
  });
});
