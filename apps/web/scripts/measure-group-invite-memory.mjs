#!/usr/bin/env node
/**
 * Measure RSS for the Next.js process after boot and after hitting
 * /api/fn routes without a service account (the production default).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

function rssKb(pid) {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const match = status.match(/^VmRSS:\s+(\d+) kB/m);
  if (!match) throw new Error(`VmRSS missing for pid ${pid}`);
  return Number(match[1]);
}

function mappedFirebaseAdmin(pid) {
  const maps = readFileSync(`/proc/${pid}/maps`, 'utf8');
  return /firebase-admin|@google-cloud\/firestore|grpc/.test(maps);
}

async function waitReady(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const port = process.env.PORT || '3120';
const webRoot = new URL('..', import.meta.url);
const nextBin = createRequire(new URL('../package.json', import.meta.url)).resolve(
  'next/dist/bin/next',
);
const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
  cwd: webRoot.pathname,
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const log = [];
child.stdout.on('data', (chunk) => log.push(chunk.toString()));
child.stderr.on('data', (chunk) => log.push(chunk.toString()));

try {
  await waitReady(`http://127.0.0.1:${port}/health/live`);
  const afterBoot = rssKb(child.pid);
  const adminMappedAtBoot = mappedFirebaseAdmin(child.pid);

  const unknown = await fetch(`http://127.0.0.1:${port}/api/fn/askCampusAssistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  });
  const after404 = rssKb(child.pid);

  const unconfigured = await fetch(`http://127.0.0.1:${port}/api/fn/joinGroupByCode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
    body: JSON.stringify({ data: {} }),
  });
  const after503 = rssKb(child.pid);
  const adminMappedAfter = mappedFirebaseAdmin(child.pid);

  const report = {
    pid: child.pid,
    rssMb: {
      afterBoot: Number((afterBoot / 1024).toFixed(1)),
      afterUnknown404: Number((after404 / 1024).toFixed(1)),
      afterJoinGroupByCode503: Number((after503 / 1024).toFixed(1)),
      deltaAfterRoutesMb: Number(((after503 - afterBoot) / 1024).toFixed(1)),
    },
    statuses: { unknown: unknown.status, joinGroupByCode: unconfigured.status },
    firebaseAdminMappedAtBoot: adminMappedAtBoot,
    firebaseAdminMappedAfterRoutes: adminMappedAfter,
  };
  console.log(JSON.stringify(report, null, 2));
  if (unknown.status !== 404 || unconfigured.status !== 503) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  console.error(log.join(''));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
