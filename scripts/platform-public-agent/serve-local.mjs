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
const { createPlatformPublicAgentHandler } = await import(pathToFileURL(join(out, 'http.js')).href);
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
const second = f.register(f.db.actor(), 'b');
const service = new PlatformPublicTaskService({
  ...f.options,
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
const handler = createPlatformPublicAgentHandler({
  enabled: true,
  origin,
  service,
  async resolveHttpSession(request) {
    const account = request.headers.get('x-local-fixture-account');
    if (account !== 'a' && account !== 'b')
      throw Object.assign(new Error('Synthetic signed out'), { code: 'PLATFORM_SESSION_INVALID' });
    return {
      authorization: account === 'a' ? f.authorization : second,
      context: `synthetic-${account}`,
    };
  },
});
const vite = await createViteServer({
  root: join(root, 'scripts/platform-public-agent/local'),
  configFile: false,
  server: { middlewareMode: true, hmr: false, fs: { allow: [root] } },
  appType: 'spa',
  resolve: { dedupe: ['react', 'react-dom'] },
  oxc: { jsx: { runtime: 'automatic' } },
});
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/platform-public-agent/')) return vite.middlewares(req, res);
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
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const abort = new globalThis.AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const request = new globalThis.Request(origin + req.url, {
      method: req.method,
      headers,
      body: Buffer.concat(chunks),
      signal: abort.signal,
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end('{"code":"LOCAL_PREVIEW_FAILED"}');
  }
});
server.listen(port, '127.0.0.1', () =>
  process.stdout.write(
    `Local public task flow: ${origin}\nSynthetic sessions/store; bundled public catalog; no cloud calls.\n`,
  ),
);
async function close() {
  server.close();
  await vite.close();
  rmSync(out, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
