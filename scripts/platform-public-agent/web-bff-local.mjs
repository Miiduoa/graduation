#!/usr/bin/env node
// Loopback-only composed product flow. Synthetic sessions/SQL protocol fixture;
// real application component, handler, service, ledger and bundled public catalog.
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { createServer as createViteServer } from 'vite';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(join(tmpdir(), 'platform-agent-local-'));
const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
const source = join(root, 'deploy/nuni-api/platform-public-agent');
const build = spawnSync(
  process.execPath,
  [
    compiler,
    ...readdirSync(source)
      .filter((n) => n.endsWith('.ts'))
      .map((n) => join(source, n)),
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--types',
    'node',
    '--typeRoots',
    realpathSync(join(root, 'node_modules/@types')),
    '--noUncheckedIndexedAccess',
    '--exactOptionalPropertyTypes',
    '--skipLibCheck',
    '--outDir',
    out,
  ],
  { stdio: 'inherit' },
);
if (build.status !== 0) throw new Error('Candidate compile failed');
process.env.PLATFORM_AGENT_COMPILED = out;
const { admissionFixture } = await import('./fixtures.mjs');
const { PlatformPublicTaskService } = await import(pathToFileURL(join(out, 'service.js')).href);
const catalogPath = join(root, 'packages/shared/src/providenceCampus.ts');
writeFileSync(
  join(out, 'catalog.cjs'),
  ts.transpileModule(readFileSync(catalogPath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
);
const { PROVIDENCE_CAMPUS_PLACES, PROVIDENCE_CAMPUS_SOURCE } = await import(
  pathToFileURL(join(out, 'catalog.cjs')).href
);
const f = admissionFixture({
  providerBudgetKey: 'local-deterministic-navigation',
  providerDailyLimit: 100,
  accountDailyLimit: 50,
});
f.db.now = Date.now();
f.actor.expiresAt = f.db.now + 3_600_000;
const authA = f.register(f.actor, 'a');
const actorB = f.db.actor();
const authB = f.register(actorB, 'b');
const syntheticActors = new Map([
  [authA, f.actor],
  [authB, actorB],
]);
const accounts = {
  async resolveSession(authorization) {
    const actor = syntheticActors.get(authorization);
    if (!actor)
      throw Object.assign(new Error('synthetic invalid'), { code: 'PLATFORM_SESSION_INVALID' });
    return {
      platformAccountId: actor.platformAccountId,
      credentialId: actor.credentialId,
      expiresAt: actor.expiresAt,
    };
  },
};
const service = new PlatformPublicTaskService({
  ...f.options,
  accounts,
  clock: () => f.db.now,
  async readPublicCatalog(schoolId) {
    if (schoolId !== 'pu') throw new Error('No bundled catalog');
    return {
      schoolId,
      label: PROVIDENCE_CAMPUS_SOURCE.mapDataLabel,
      updatedAt: PROVIDENCE_CAMPUS_SOURCE.retrievedAt,
      places: PROVIDENCE_CAMPUS_PLACES.filter(
        (p) =>
          p.verification === 'cross-checked' &&
          p.sourceUrl.startsWith('https://www.openstreetmap.org/'),
      ).map(({ id, name, lat, lng, sourceUrl }) => ({ id, name, lat, lng, sourceUrl })),
    };
  },
});
const port = 4319,
  origin = `http://127.0.0.1:${port}`;
if (process.env.NODE_ENV === 'production')
  throw new Error('Local synthetic preview cannot run in production');
process.env.NODE_ENV = 'development';
process.env.WEB_PUBLIC_ORIGIN = origin;
process.env.CAMPUS_BACKEND = 'nuni';
process.env.CAMPUS_PUBLIC_AGENT_ENABLED = 'true';
process.env.NUNI_API_BASE_URL = 'https://api.example.test';
process.env.BFF_SESSION_SECRET = 'synthetic-local-session-secret-over-32-characters';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = new globalThis.URL(String(url));
  if (target.origin !== 'https://api.example.test') throw new Error('External requests disabled');
  const authorization = new globalThis.Headers(init?.headers).get('authorization');
  const actor = syntheticActors.get(authorization);
  if (!actor) return globalThis.Response.json({ code: 'PUBLIC_AGENT_SESSION_INVALID' }, { status: 401 });
  if (target.pathname === '/v1/auth/platform/sessions/current')
    return globalThis.Response.json({
      authenticated: true,
      platformAccountId: actor.platformAccountId,
      isPlatformOperator: false,
    });
  const match =
    /^\/v1\/auth\/platform\/public-agent\/(preview|confirm|execute|read|status|ack)$/.exec(
      target.pathname,
    );
  if (!match || init?.method !== 'POST')
    return globalThis.Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  try {
    return globalThis.Response.json(
      await service[match[1]](authorization, JSON.parse(String(init.body)), init.signal),
    );
  } catch (error) {
    return globalThis.Response.json({ code: error.code ?? 'UNKNOWN' }, { status: error.statusCode ?? 500 });
  }
};
const vite = await createViteServer({
  root: join(root, 'scripts/platform-public-agent/local'),
  configFile: false,
  server: { middlewareMode: true, hmr: false, fs: { allow: [root] } },
  appType: 'spa',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@campus/shared', replacement: join(root, 'packages/shared') },
      { find: '@', replacement: join(root, 'apps/web/src') },
    ],
  },
  oxc: { jsx: { runtime: 'automatic' } },
});
const { handleNuni } = await vite.ssrLoadModule(join(root, 'apps/web/src/lib/nuni/api.ts'));
const { SESSION_COOKIE, sealCookie } = await vite.ssrLoadModule(
  join(root, 'apps/web/src/lib/nuni/server.ts'),
);
const { NextRequest } = await import('next/server.js');
const cookieFor = (actor) =>
  sealCookie(SESSION_COOKIE, {
    sessionHandle: actor.sessionHash === f.actor.sessionHash ? authA.slice(9) : authB.slice(9),
    expiresAt: actor.expiresAt,
  });
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.url === '/' || req.url === '/web-bff.html')
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${cookieFor(f.actor)}; HttpOnly; SameSite=Lax; Path=/`,
    );
  if (!req.url?.startsWith('/api/nuni/')) return vite.middlewares(req, res);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = new globalThis.Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === 'string') headers.set(key, value);
    const abort = new globalThis.AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const request = new NextRequest(origin + req.url, {
      method: req.method,
      headers,
      ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }),
      signal: abort.signal,
    });
    const response = await handleNuni(
      request,
      new globalThis.URL(request.url).pathname.slice('/api/nuni/'.length).split('/'),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (error) {
    process.stderr.write(`Synthetic BFF error: ${error.message}\n`);
    res.writeHead(500);
    res.end('{"error":"LOCAL_PREVIEW_FAILED"}');
  }
});
server.listen(port, '127.0.0.1', () =>
  process.stdout.write(
    `Local Web BFF flow: ${origin}/web-bff.html\nSynthetic sessions/store; bundled public catalog; no cloud calls.\n`,
  ),
);
async function close() {
  server.close();
  globalThis.fetch = originalFetch;
  await vite.close();
  rmSync(out, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
