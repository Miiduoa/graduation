// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { sealCookie, SESSION_COOKIE, sessionContext } from './server';
import { assistantInput, projectAssistant } from './assistantContracts';
import { assistantRequest } from './assistantTransport';
import {
  createFixture,
  fixtureHandle,
  fixtureSecret,
} from '../../../../../scripts/nuni-assistant/harness.mjs';
const session = { sessionHandle: fixtureHandle as string, expiresAt: Date.now() + 3600000 };
function request(action: string, input?: object, overrides: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: input ? 'POST' : 'GET',
    headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session),
      Origin: 'http://localhost:3000',
      ...(input ? { 'Content-Type': 'application/json' } : {}),
      ...overrides,
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}
beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BFF_SESSION_SECRET', fixtureSecret);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('default off returns 404 without contacting upstream; blocks writes and bad sessions', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', '');
  expect((await handleNuni(request('capability'), ['assistant', 'capability'])).status).toBe(404);
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  for (const action of ['execute', 'enqueue']) {
    const response = await handleNuni(request(action, { toolName: 'createOrder' }), [
      'assistant',
      action,
    ]);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ASSISTANT_WRITE_UNAVAILABLE' });
  }
  expect(
    (
      await handleNuni(
        request('preview', { schoolId: 'pu', intent: 'map' }, { Origin: 'https://evil.test' }),
        ['assistant', 'preview'],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleNuni(request('capability', undefined, { 'X-Campus-Session': 'other' }), [
        'assistant',
        'capability',
      ])
    ).status,
  ).toBe(409);
  expect(
    (
      await handleNuni(request('capability', undefined, { cookie: '' }), [
        'assistant',
        'capability',
      ])
    ).status,
  ).toBe(401);
  expect(
    (
      await handleNuni(request('preview', { schoolId: 'pu', intent: 'map', uid: 'forged' }), [
        'assistant',
        'preview',
      ])
    ).status,
  ).toBe(422);
  expect(fetch).not.toHaveBeenCalled();
});
it('pending logout is rejected before upstream and unknown actions stay closed', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const pending = { ...session, pendingLogout: true as const };
  const response = await handleNuni(
    request('capability', undefined, {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, pending)}`,
    }),
    ['assistant', 'capability'],
  );
  expect(response.status).toBe(401);
  expect((await handleNuni(request('unknown'), ['assistant', 'unknown'])).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it('ask sends exactly once on 429, 503, and transport failure', async () => {
  for (const status of [429, 503, 0]) {
    const fetch = vi.fn(async () => {
      if (!status) throw new Error('network');
      return new Response('{"error":{"code":"PROVIDER_UNAVAILABLE"}}', {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(assistantRequest('ask', session, {})).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it('PII is discarded locally, untrusted upstream prose and URLs are projected away', () => {
  expect(
    assistantInput('preview', {
      schoolId: 'pu',
      question: '王小明 S123456789 secret@example.test Bearer abc.def 圖書館怎麼走',
    }),
  ).toEqual({ schoolId: 'pu', intent: 'map' });
  expect(() => assistantInput('preview', { schoolId: 'pu', question: '王小明' })).toThrow();
  expect(
    projectAssistant('route', { schoolId: 'pu', intent: 'map', href: 'https://evil.test' }),
  ).toEqual({
    schoolId: 'pu',
    intent: 'map',
    href: '/map?schoolId=pu',
    source: 'https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw',
  });
});
it('preview conversation crosses actual web BFF and local fake Fastify inject transport', async () => {
  const { app, state } = await createFixture();
  try {
    vi.stubEnv('NUNI_API_BASE_URL', 'http://127.0.0.1:4317');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const target = new URL(url);
      expect(target.origin).toBe('http://127.0.0.1:4317');
      const result = await app.inject({
        method: init.method,
        url: target.pathname,
        headers: Object.fromEntries(new Headers(init.headers)),
        ...(init.body ? { payload: init.body } : {}),
      });
      return new Response(result.body, {
        status: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const cap = await handleNuni(request('capability'), ['assistant', 'capability']);
    expect(cap.status).toBe(200);
    expect((await cap.json()).simulation).toBe(true);
    const preview = await handleNuni(
      request('preview', { schoolId: 'pu', question: '圖書館怎麼走' }),
      ['assistant', 'preview'],
    );
    expect(preview.status).toBe(200);
    const p = await preview.json();
    const input = { schoolId: 'pu', intent: p.intent, confirmation: p.confirmation, consent: true };
    const ask = await handleNuni(request('ask', input), ['assistant', 'ask']);
    expect(ask.status).toBe(200);
    const answer = await ask.json();
    expect(answer.answer).toContain('校園地圖');
    const route = await handleNuni(
      request('route', { ...input, confirmation: answer.confirmation }),
      ['assistant', 'route'],
    );
    expect(route.status).toBe(200);
    expect((await route.json()).href).toBe('/map?schoolId=pu');
    state.active = false;
    expect((await handleNuni(request('ask', input), ['assistant', 'ask'])).status).toBe(401);
  } finally {
    await app.close();
  }
});
