import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createFixture, fixtureHandle, fixtureSecret } from './harness.mjs';

// Bundle application TS and shared aliases; use the installed Next runtime unchanged.
async function loadBff() {
  const directory = await mkdtemp(fileURLToPath(new URL('./.bff-test-', import.meta.url)));
  try {
    const result = await build({
      stdin: {
        contents: `export { handleNuni } from './apps/web/src/lib/nuni/api';
          export { sealCookie, SESSION_COOKIE, sessionContext } from './apps/web/src/lib/nuni/server';
          export { NextRequest } from 'next/server';`,
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      },
      tsconfig: fileURLToPath(new URL('../../apps/web/tsconfig.json', import.meta.url)),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false,
    });
    const file = directory + '/bff.cjs';
    await writeFile(file, result.outputFiles[0].text);
    return createRequire(import.meta.url)(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('preview conversation crosses real web BFF and real Fastify routes', async (t) => {
  const previousEnv = { ...process.env };
  t.after(() => {
    process.env = previousEnv;
  });
  const { app, state } = await createFixture();
  Object.assign(process.env, {
    CAMPUS_BACKEND: 'nuni',
    CAMPUS_ASSISTANT_ENABLED: 'true',
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000',
    BFF_SESSION_SECRET: fixtureSecret,
    NUNI_API_BASE_URL: 'http://127.0.0.1:4317',
  });
  try {
    const { handleNuni, NextRequest, sealCookie, SESSION_COOKIE, sessionContext } = await loadBff();
    const session = { sessionHandle: fixtureHandle, expiresAt: Date.now() + 3600000 };
    function request(action, input) {
      return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
        method: input ? 'POST' : 'GET',
        headers: {
          cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
          'X-Campus-Session': sessionContext(session),
          Origin: 'http://localhost:3000',
          ...(input ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    }
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const target = new URL(url);
      assert.equal(target.origin, 'http://127.0.0.1:4317');
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
    assert.equal(cap.status, 200);
    assert.equal((await cap.json()).simulation, true);
    const preview = await handleNuni(
      request('preview', { schoolId: 'pu', question: '圖書館怎麼走' }),
      ['assistant', 'preview'],
    );
    assert.equal(preview.status, 200);
    const p = await preview.json();
    const input = { schoolId: 'pu', intent: p.intent, confirmation: p.confirmation, consent: true };
    const ask = await handleNuni(request('ask', input), ['assistant', 'ask']);
    assert.equal(ask.status, 200);
    const answer = await ask.json();
    assert.match(answer.answer, /校園地圖/);
    const route = await handleNuni(
      request('route', { ...input, confirmation: answer.confirmation }),
      ['assistant', 'route'],
    );
    assert.equal(route.status, 200);
    assert.equal((await route.json()).href, '/map?schoolId=pu');
    state.active = false;
    assert.equal((await handleNuni(request('ask', input), ['assistant', 'ask'])).status, 401);
  } finally {
    await app.close();
  }
});
