import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import {
  loadAcceptanceRuntime,
  readPrivateJson,
  runAcceptanceCli,
  writePrivateJson,
} from './acceptance.mjs';

async function directory(t) {
  const value = await realpath(await mkdtemp(path.join(tmpdir(), 'tronclass-acceptance-test-')));
  await chmod(value, 0o700);
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}
const privateJson = (filename, value) =>
  writeFile(filename, JSON.stringify(value), { mode: 0o600, flag: 'wx' });

test('help is executable without building a runtime or initializing credentials', async () => {
  let output = '',
    loaded = false;
  assert.equal(
    await runAcceptanceCli(['--help'], {
      stdout: (value) => {
        output += value;
      },
      stderr: () => assert.fail('Unexpected error'),
      loadRuntime: async () => {
        loaded = true;
        throw new Error('must not load');
      },
    }),
    0,
  );
  assert.match(output, /preflight/);
  assert.match(output, /dispatch/);
  assert.match(output, /reconcile/);
  assert.match(output, /production writer stays disabled/);
  assert.equal(loaded, false);
});

test('accepts bounded private regular JSON and writes a non-overwriting 0600 plan', async (t) => {
  const root = await directory(t);
  const source = path.join(root, 'input.json'),
    output = path.join(root, 'plan.json');
  await privateJson(source, { value: 'synthetic' });
  assert.deepEqual(await readPrivateJson(source), { value: 'synthetic' });
  assert.equal(await writePrivateJson(output, { version: 1 }), true);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(writePrivateJson(output, { version: 2 }), {
    code: 'TRONCLASS_ACCEPTANCE_OUTPUT_EXISTS',
  });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { version: 1 });
});

test('rejects symlinks, oversized files, broad permissions and URLs without exposing their contents or paths', async (t) => {
  const root = await directory(t);
  const source = path.join(root, 'private-token-input.json');
  await privateJson(source, { secret: 'not-a-real-token' });
  const alias = path.join(root, 'alias.json');
  await symlink(source, alias);
  const large = path.join(root, 'large.json');
  await writeFile(large, 'x'.repeat(128 * 1024 + 1), { mode: 0o600 });
  const broad = path.join(root, 'broad.json');
  await privateJson(broad, {});
  await chmod(broad, 0o644);
  for (const [filename, code] of [
    [alias, 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED'],
    [large, 'TRONCLASS_ACCEPTANCE_FILE_TOO_LARGE'],
    [broad, 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED'],
    ['https://tronclass.pu.edu.tw/private', 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED'],
  ]) {
    await assert.rejects(readPrivateJson(filename), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      return true;
    });
  }
});

test('rejects nonprivate output directories and keeps a once marker across competing writers', async (t) => {
  const root = await directory(t);
  const marker = path.join(root, 'plan.json.dispatch');
  const outcomes = await Promise.all([
    writePrivateJson(marker, { operationId: 'synthetic_operation' }, true),
    writePrivateJson(marker, { operationId: 'synthetic_operation' }, true),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal((await stat(marker)).mode & 0o777, 0o600);
  await chmod(root, 0o755);
  await assert.rejects(writePrivateJson(path.join(root, 'unsafe.json'), {}), {
    code: 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
  });
});

test('refuses credential arguments and malformed private JSON without loading the runtime', async (t) => {
  const root = await directory(t);
  let output = '',
    errors = '',
    loaded = 0;
  const options = {
    stdout: (value) => {
      output += value;
    },
    stderr: (value) => {
      errors += value;
    },
    loadRuntime: async () => {
      loaded += 1;
      throw new Error('must not load');
    },
  };
  assert.equal(await runAcceptanceCli(['dispatch', '--cookie', 'private-cookie'], options), 1);
  const malformed = path.join(root, 'private-path.json');
  await writeFile(malformed, '{"password":"private-password"', { mode: 0o600 });
  assert.equal(
    await runAcceptanceCli(
      ['preflight', '--input', malformed, '--plan', path.join(root, 'out.json')],
      options,
    ),
    1,
  );
  assert.equal(output, '');
  assert.equal(loaded, 0);
  assert.equal(errors, 'TRONCLASS_ACCEPTANCE_ARGUMENTS\nTRONCLASS_ACCEPTANCE_INVALID_JSON\n');
  assert.ok(!errors.includes(root));
  assert.ok(!errors.includes('private-cookie'));
  assert.ok(!errors.includes('private-password'));
});

function syntheticProvider(module) {
  const now = Date.parse('2026-11-18T10:00:00.000Z');
  const input = {
    version: 1,
    schoolId: 'pu',
    ownerKey: 'firebase:acceptance-cli-synthetic',
    studentId: 303,
    courseId: 101,
    homeworkId: 202,
    revision: 'a'.repeat(32),
    operationId: 'synthetic_cli_operation_1',
    content: '僅供離線合成驗證 <內容>',
  };
  const binding = {
    schoolId: 'pu',
    revision: input.revision,
    userId: 303,
    account: 'synthetic',
    userName: null,
    expiresAt: new Date(now + 3600_000).toISOString(),
    cookies: { session: 'synthetic-cookie', 'XSRF-TOKEN': 'synthetic-csrf' },
  };
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const rows = new Map([
    [
      `_tronClassBindings/${hash(input.ownerKey)}`,
      {
        ownerKey: input.ownerKey,
        schoolId: 'pu',
        state: 'connected',
        revision: binding.revision,
        userId: 303,
        expiresAt: Date.parse(binding.expiresAt),
      },
    ],
  ]);
  const snapshot = (path) => ({
    exists: rows.has(path),
    data: () => globalThis.structuredClone(rows.get(path)),
  });
  let queue = Promise.resolve(),
    writes = 0,
    posts = 0,
    finalRow = null;
  const db = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    runTransaction(run) {
      const next = queue.then(async () => {
        const pending = [];
        const result = await run({
          get: async (ref) => {
            assert.equal(pending.length, 0);
            return snapshot(ref.path);
          },
          set: (ref, value) => pending.push([ref.path, globalThis.structuredClone(value)]),
        });
        for (const [key, value] of pending) rows.set(key, value);
        writes += pending.length;
        return result;
      });
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  const bindings = {
    requireBinding: async (owner) => {
      assert.equal(owner, input.ownerKey);
      return globalThis.structuredClone(binding);
    },
    assertCurrent: async (owner, revision) => {
      assert.equal(owner, input.ownerKey);
      assert.equal(revision, input.revision);
    },
  };
  const create = (options) =>
    module.createTronClassAcceptanceService({
      db,
      bindings,
      now: () => now,
      planSecret: 'synthetic-cli-binding-secret-at-least-32-characters',
      reserveDispatch: options.reserveDispatch,
      authorize: async () => ({
        binding: globalThis.structuredClone(binding),
        mode: 'normal',
        historyComplete: true,
        priorSubmissionIds: [],
        userSubmitCount: 0,
        ordinaryWindowConfirmed: true,
        prerequisitesConfirmed: true,
        assignment: {
          courseId: 101,
          homeworkId: 202,
          studentId: 303,
          title: '合成驗收作業',
          description: '',
          opensAt: null,
          deadline: new Date(now + 7200_000).toISOString(),
          permissionKnown: true,
          individual: true,
          canSubmit: true,
          isClosed: false,
          allowLate: false,
          remainingAttempts: 1,
          allowsText: true,
          allowsAttachments: false,
          maxFiles: 0,
          maxFileBytes: 0,
          maxTotalBytes: 0,
          allowedContentTypes: [],
        },
      }),
      fetchSchool: async (url, request) => {
        assert.equal(url, 'https://tronclass.pu.edu.tw/api/course/activities/202/submissions');
        assert.equal(request.method, 'POST');
        assert.ok([...rows.values()].some((row) => row.state === 'final-claimed'));
        const body = JSON.parse(request.body);
        assert.deepEqual(body.uploads, []);
        posts += 1;
        finalRow = {
          id: 501,
          activity_id: 202,
          course_id: 101,
          created_by: { id: 303 },
          is_latest_version: true,
          is_draft: false,
          is_redo: false,
          submit_by_instructor: false,
          uploads: [],
          comment: body.comment,
          other_resources: [],
          slide_references: [],
          created_at: '2026-11-18T10:00:00Z',
        };
        return new globalThis.Response(
          JSON.stringify({ submission: finalRow, student: { id: 303 } }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
      readHistory: async () => ({ list: finalRow ? [globalThis.structuredClone(finalRow)] : [] }),
    });
  return { input, create, writes: () => writes, posts: () => posts };
}

test('builds and loads the real server runtime, then runs private-file preflight/dispatch/reconcile without school networking', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('External fetch must not run'));
  t.mock.method(https, 'request', () => assert.fail('External HTTPS must not run'));
  t.mock.method(http, 'request', () => assert.fail('External HTTP must not run'));
  const runtime = await loadAcceptanceRuntime();
  t.after(() => runtime.dispose());
  assert.equal(typeof runtime.module.createDefaultTronClassAcceptanceService, 'function');
  const f = syntheticProvider(runtime.module);
  const root = await directory(t);
  const inputPath = path.join(root, 'input.json'),
    planPath = path.join(root, 'plan.json'),
    confirmPath = path.join(root, 'confirm.json');
  await privateJson(inputPath, f.input);
  let output = '',
    errors = '';
  const options = {
    stdout: (value) => {
      output += value;
    },
    stderr: (value) => {
      errors += value;
    },
    loadRuntime: async () => ({
      module: {
        ...runtime.module,
        createDefaultTronClassAcceptanceService: async (options) => f.create(options),
      },
      dispose: async () => {},
    }),
  };
  assert.equal(
    await runAcceptanceCli(['preflight', '--input', inputPath, '--plan', planPath], options),
    0,
  );
  const plan = await readPrivateJson(planPath);
  assert.equal((await stat(planPath)).mode & 0o777, 0o600);
  assert.equal(f.writes(), 0);
  assert.equal(f.posts(), 0);
  await privateJson(confirmPath, {
    operationId: plan.operationId,
    contentSha256: plan.contentSha256,
    confirmed: true,
  });
  const command = ['dispatch', '--input', inputPath, '--plan', planPath, '--confirm', confirmPath];
  assert.equal(await runAcceptanceCli(command, options), 0);
  assert.equal((await stat(`${planPath}.dispatch`)).mode & 0o777, 0o600);
  assert.equal(f.posts(), 1);
  assert.equal(await runAcceptanceCli(command, options), 0);
  assert.equal(f.posts(), 1);
  const writes = f.writes();
  assert.equal(await runAcceptanceCli(['reconcile', '--plan', planPath], options), 0);
  assert.equal(f.posts(), 1);
  assert.equal(f.writes(), writes);
  assert.deepEqual(
    output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).status),
    ['prepared', 'confirmed', 'unknown', 'confirmed'],
  );
  assert.equal(errors, '');
  for (const secret of [
    root,
    f.input.ownerKey,
    f.input.content,
    'synthetic-cookie',
    'synthetic-csrf',
    'planSignature',
    'studentId',
  ]) {
    assert.ok(!output.includes(secret));
  }
});
