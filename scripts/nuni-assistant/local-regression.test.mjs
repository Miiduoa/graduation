import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
const script = fileURLToPath(new URL('./local-regression.mjs', import.meta.url));
const run = (local) =>
  promisify(execFile)(process.execPath, [script], {
    env: { PATH: process.env.PATH, ...(local ? { NUNI_ASSISTANT_LOCAL_DB: local } : {}) },
  });
test('database regression skips by default and rejects nonlocal destinations before connecting', async () => {
  assert.match((await run()).stdout, /^SKIP:/);
  for (const url of [
    'postgresql://nuni_test@example.invalid:55432/postgres',
    'postgresql://nuni_test@127.0.0.1:5432/postgres',
    'postgresql://another@127.0.0.1:55432/postgres',
    'postgresql://nuni_test:synthetic@127.0.0.1:55432/postgres',
    'postgresql://nuni_test@127.0.0.1:55432/postgres?host=example.invalid',
  ])
    await assert.rejects(run(url));
});
