import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const local = process.env.NUNI_ASSISTANT_LOCAL_DB;
if (!local) {
  console.log(
    'SKIP: set NUNI_ASSISTANT_LOCAL_DB and NUNI_ASSISTANT_CONTEXT for isolated PostgreSQL regression',
  );
} else {
  const url = new URL(local);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.username, 'nuni_test');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.match(url.pathname, /^\/[a-z_][a-z0-9_]*$/);
  assert.ok(process.env.NUNI_ASSISTANT_CONTEXT, 'prepared candidate context required');
  const context = resolve(process.env.NUNI_ASSISTANT_CONTEXT);
  const file = resolve(context, 'assistant-local-regression.mts');
  const manifest = JSON.parse(
    await readFile(new URL('../../deploy/nuni-api/assistant/source.json', import.meta.url)),
  );
  const { stdout: tree } = await promisify(execFile)('git', ['write-tree'], { cwd: context });
  assert.equal(tree.trim(), manifest.candidateTree, 'context must be the pinned candidate');
  await promisify(execFile)('git', ['diff', '--exit-code', '--quiet'], { cwd: context });
  await copyFile(new URL('./local-regression.mts', import.meta.url), file);
  try {
    const { stdout, stderr } = await promisify(execFile)(
      resolve(context, 'apps/api/node_modules/.bin/tsx'),
      [file],
      {
        cwd: context,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          EXPO_NO_DOTENV: '1',
          CAMPUS_ASSISTANT_ENABLED: 'true',
          CAMPUS_ASSISTANT_PROVIDER: 'groq',
          NUNI_ASSISTANT_LOCAL_DB: local,
        },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 240000,
      },
    );
    const logs = stdout + stderr;
    assert.match(logs, /LOCAL_REGRESSION_OK/);
    assert.match(logs, /Assistant request failed/, 'production logger must emit failure records');
    assert.doesNotMatch(
      logs,
      /合成王小明|S123456789|synthetic-private@example.test|原文唯一標記|authorization|Platform ps_|ps_[tuv]{43}|question/i,
    );
    console.log(
      'PASS: real createApp, PostgreSQL sessions, guard, limits, proxy and production log privacy',
    );
  } catch (error) {
    // Avoid printing child output: a failed privacy assertion may contain fixture data.
    const diagnostic = String(error.stderr ?? error.message).replace(
      /合成王小明|S123456789|synthetic-private@example.test|原文唯一標記|Platform ps_[A-Za-z0-9_-]+/g,
      '[fixture]',
    );
    throw new Error('Local regression failed: ' + diagnostic);
  } finally {
    await rm(file, { force: true });
  }
}
