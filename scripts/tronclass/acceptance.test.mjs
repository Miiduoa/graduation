import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import fs, { chmod, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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

test('walks directory components before applying dot-dot to private paths', async (t) => {
  const root = await directory(t);
  const child = path.join(root, 'child');
  const source = path.join(root, 'input.json');
  const output = path.join(root, 'plan.json');
  await mkdir(child, { mode: 0o700 });
  await symlink(child, path.join(root, 'alias'));
  await privateJson(source, { value: 'synthetic' });

  await assert.rejects(readPrivateJson(`${root}/alias/../input.json`), {
    code: 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
  });
  await assert.rejects(writePrivateJson(`${root}/alias/../plan.json`, {}), {
    code: 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
  });
  await assert.rejects(stat(output), { code: 'ENOENT' });
  assert.deepEqual(await readPrivateJson(`${root}//child/./../input.json`), { value: 'synthetic' });
  assert.equal(await writePrivateJson(`${root}/child/../plan.json`, { version: 1 }), true);
  assert.deepEqual(await readPrivateJson(output), { version: 1 });
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

test('exclusive dispatch marker creation leaves existing FIFOs and symlink targets intact', async (t) => {
  const root = await directory(t);
  const target = path.join(root, 'target.json');
  const fifoMarker = path.join(root, 'fifo-plan.json.dispatch');
  const symlinkMarker = path.join(root, 'symlink-plan.json.dispatch');
  await privateJson(target, { value: 'original' });
  const original = await readFile(target);
  assert.equal(spawnSync('mkfifo', ['-m', '600', fifoMarker]).status, 0);
  await symlink(target, symlinkMarker);

  for (const marker of [fifoMarker, symlinkMarker]) {
    assert.equal(await writePrivateJson(marker, { value: 'dispatch' }, true), false);
  }
  assert.ok((await stat(fifoMarker)).isFIFO());
  assert.ok((await fs.lstat(symlinkMarker)).isSymbolicLink());
  assert.deepEqual(await readFile(target), original);
});

test('rejects a parent replaced at the final open for plans and dispatch markers', async (t) => {
  const root = await directory(t);
  for (const [name, marker, replacement] of [
    ['plan.json', false, 'directory'],
    ['plan.json.dispatch', true, 'symlink'],
  ]) {
    await t.test(replacement, async (t) => {
      const parent = path.join(root, replacement);
      const moved = `${parent}-moved`;
      const substitute = replacement === 'directory' ? parent : `${parent}-substitute`;
      await mkdir(parent, { mode: 0o700 });
      const originalOpen = open;
      const hook = t.mock.method(fs, 'open', async (filename, flags, ...args) => {
        if (path.basename(filename) === name && (flags & constants.O_CREAT) !== 0) {
          await rename(parent, moved);
          await mkdir(substitute, { mode: 0o700 });
          if (replacement === 'symlink') await symlink(substitute, parent);
        }
        return originalOpen(filename, flags, ...args);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(writePrivateJson(path.join(parent, name), {}, marker), {
          code: 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
        });
        await assert.rejects(stat(path.join(substitute, name)), { code: 'ENOENT' });
      } finally {
        hook.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
});

test('dispatch rejects a plan ancestor replaced before reservation', async (t) => {
  const root = await directory(t);
  const ancestor = path.join(root, 'workspace');
  const parent = path.join(ancestor, 'reviewed');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const plan = path.join(parent, 'plan.json');
  const input = path.join(root, 'input.json');
  const confirmation = path.join(root, 'confirmation.json');
  await Promise.all([plan, input, confirmation].map((filename) => privateJson(filename, {})));

  let error = '';
  let reservationAttempted = false;
  const code = await runAcceptanceCli(
    ['dispatch', '--input', input, '--plan', plan, '--confirm', confirmation],
    {
      stdout: () => assert.fail('A replaced directory must not yield a dispatch result'),
      stderr: (text) => {
        error += text;
      },
      loadRuntime: async () => {
        await rename(ancestor, `${ancestor}-moved`);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        return {
          module: {
            parseTronClassAcceptanceInput() {},
            createDefaultTronClassAcceptanceService: ({ reserveDispatch }) => ({
              async dispatch(_input, reviewedPlan) {
                reservationAttempted = true;
                return reserveDispatch(reviewedPlan);
              },
            }),
          },
          dispose: async () => {},
        };
      },
    },
  );
  assert.equal(reservationAttempted, true);
  assert.equal(code, 1);
  assert.equal(error, 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED\n');
  await assert.rejects(stat(`${plan}.dispatch`), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(`${ancestor}-moved`, 'reviewed', 'plan.json.dispatch')), {
    code: 'ENOENT',
  });
});

test('refuses a file replaced with a FIFO or symlink at open without blocking', async (t) => {
  const root = await directory(t);
  const alternate = path.join(root, 'alternate.json');
  await privateJson(alternate, { value: 'alternate' });
  for (const mode of ['fifo', 'symlink']) {
    const target = path.join(root, `${mode}.json`);
    await privateJson(target, { value: 'original' });
    // Isolate the read so a regression that blocks a libuv thread can be killed.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { execFileSync } from 'node:child_process';
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import path from 'node:path';
      import { readPrivateJson } from ${JSON.stringify(new URL('./acceptance.mjs', import.meta.url).href)};
      const [target, alternate, mode] = process.argv.slice(1);
      const open = fs.open;
      let replaced = false;
      fs.open = async (filename, ...args) => {
        if (!replaced && path.basename(filename) === path.basename(target)) {
          replaced = true;
          await fs.unlink(target);
          if (mode === 'fifo') execFileSync('mkfifo', ['-m', '600', target]);
          else await fs.symlink(alternate, target);
        }
        return open(filename, ...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(readPrivateJson(target), {
        code: 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
      });
      assert.equal(replaced, true);
    `, target, alternate, mode], { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL' });
    assert.equal(result.error, undefined, mode);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('dispatch reads only the verified plan descriptor and refuses replaced plan names', { timeout: 5000 }, async (t) => {
  for (const phase of ['open', 'read', 'reserve']) {
    for (const replacement of ['fifo', 'symlink', 'regular file']) {
      await t.test(`${phase}: ${replacement}`, async (t) => {
        const root = await directory(t);
        const plan = path.join(root, 'plan.json');
        const moved = path.join(root, 'moved.json');
        const input = path.join(root, 'input.json');
        const confirmation = path.join(root, 'confirmation.json');
        const originalPlan = { value: 'reviewed' };
        await privateJson(plan, originalPlan);
        await Promise.all([input, confirmation].map((filename) => privateJson(filename, {})));

        let replaced = false;
        async function replacePlan() {
          await rename(plan, moved);
          if (replacement === 'fifo') {
            assert.equal(spawnSync('mkfifo', ['-m', '600', plan]).status, 0);
          } else if (replacement === 'symlink') {
            await symlink(input, plan);
          } else {
            await privateJson(plan, { value: 'replacement' });
          }
          replaced = true;
        }

        let planOpens = 0;
        let planFlags;
        let bytesRead;
        const originalOpen = open;
        const hook = t.mock.method(fs, 'open', async (filename, flags, ...args) => {
          const handle = await originalOpen(filename, flags, ...args);
          if (path.basename(filename) === 'plan.json') {
            planOpens++;
            planFlags = flags;
            if (phase === 'open' && !replaced) await replacePlan();
            if (phase === 'read') {
              const read = handle.read.bind(handle);
              handle.read = async (buffer, offset, ...args) => {
                if (!replaced) await replacePlan();
                const result = await read(buffer, offset, ...args);
                if (result.bytesRead) bytesRead = buffer.subarray(offset, offset + result.bytesRead).toString();
                return result;
              };
            }
          }
          return handle;
        });
        syncBuiltinESMExports();
        let loadCount = 0;
        let reservationAttempted = false;
        let output = '';
        let error = '';
        try {
          const code = await runAcceptanceCli(
            ['dispatch', '--input', input, '--plan', plan, '--confirm', confirmation],
            {
              stdout: (text) => { output += text; },
              stderr: (text) => { error += text; },
              loadRuntime: async () => {
                loadCount++;
                return {
                  module: {
                    parseTronClassAcceptanceInput() {},
                    createDefaultTronClassAcceptanceService: ({ reserveDispatch }) => ({
                      async dispatch(_input, reviewedPlan) {
                        assert.deepEqual(reviewedPlan, originalPlan);
                        await replacePlan();
                        reservationAttempted = true;
                        return reserveDispatch(reviewedPlan);
                      },
                    }),
                  },
                  dispose: async () => {},
                };
              },
            },
          );
          assert.equal(replaced, true);
          assert.equal(planOpens, 1);
          assert.ok(planFlags & constants.O_NOFOLLOW);
          if (phase === 'read') assert.deepEqual(JSON.parse(bytesRead), originalPlan);
          assert.equal(loadCount, phase === 'reserve' ? 1 : 0);
          assert.equal(reservationAttempted, phase === 'reserve');
          assert.equal(code, 1);
          assert.equal(output, '');
          assert.equal(error, 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED\n');
          await assert.rejects(stat(`${plan}.dispatch`), { code: 'ENOENT' });
          await assert.rejects(stat(`${moved}.dispatch`), { code: 'ENOENT' });
        } finally {
          hook.mock.restore();
          syncBuiltinESMExports();
        }
      });
    }
  }
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

for (const substitute of ['file', 'symlink']) {
  test(`runtime loading bypasses a ${substitute} substituted after a bundle write`, async (t) => {
    const dir = await directory(t);
    const replacement = path.join(dir, 'replacement.cjs');
    const executionMarker = path.join(dir, 'replacement-ran');
    const replacementCode = `require('node:fs').writeFileSync(${JSON.stringify(executionMarker)}, 'ran');`;
    await writeFile(replacement, replacementCode);
    const write = fs.writeFile;
    const hook = t.mock.method(fs, 'writeFile', async (filename, ...args) => {
      await write(filename, ...args);
      await rename(filename, `${filename}.original`);
      if (substitute === 'symlink') await symlink(replacement, filename);
      else await write(filename, replacementCode);
    });
    syncBuiltinESMExports();
    try {
      const runtime = await loadAcceptanceRuntime();
      await runtime.dispose();
      assert.equal(typeof runtime.module.createDefaultTronClassAcceptanceService, 'function');
      await assert.rejects(stat(executionMarker), { code: 'ENOENT' });
      assert.equal(hook.mock.callCount(), 0);
    } finally {
      hook.mock.restore();
      syncBuiltinESMExports();
    }
  });
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
  const shared = path.join(root, 'shared');
  const alternate = path.join(shared, 'alternate');
  const selected = path.join(shared, 'selected');
  await mkdir(alternate, { recursive: true, mode: 0o700 });
  const alternateInput = path.join(alternate, 'input.json');
  const alternatePlan = path.join(alternate, 'plan.json');
  await privateJson(alternateInput, {
    ...f.input, operationId: 'synthetic_cli_operation_2', content: '另一份確認內容',
  });
  assert.equal(await runAcceptanceCli([
    'preflight', '--input', alternateInput, '--plan', alternatePlan,
  ], { ...options, stdout: () => {} }), 0);
  const reviewedAlternate = await readPrivateJson(alternatePlan);
  assert.notEqual(reviewedAlternate.contentSha256, plan.contentSha256);
  await privateJson(path.join(alternate, 'confirm.json'), {
    operationId: reviewedAlternate.operationId,
    contentSha256: reviewedAlternate.contentSha256,
    confirmed: true,
  });
  await rename(alternate, selected);
  await chmod(shared, 0o777);
  let unsafeError = '';
  assert.equal(await runAcceptanceCli([
    'dispatch', '--input', path.join(selected, 'input.json'),
    '--plan', path.join(selected, 'plan.json'), '--confirm', path.join(selected, 'confirm.json'),
  ], {
    ...options,
    stdout: () => assert.fail('An unsafe ancestor must not yield a dispatch result'),
    stderr: value => { unsafeError += value; },
  }), 1);
  assert.equal(unsafeError, 'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED\n');
  assert.equal(f.posts(), 0);
  await assert.rejects(stat(path.join(selected, 'plan.json.dispatch')), { code: 'ENOENT' });
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
