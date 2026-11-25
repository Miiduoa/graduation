import { constants } from 'node:fs';
import { Buffer } from 'node:buffer';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs, TextDecoder } from 'node:util';
import { compileFunction } from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_FILE_BYTES = 128 * 1024;
const HELP = `TronClass controlled first-text acceptance (production writer stays disabled)

  node scripts/tronclass/acceptance.mjs preflight --input PRIVATE_JSON --plan NEW_PRIVATE_JSON
  node scripts/tronclass/acceptance.mjs dispatch --input PRIVATE_JSON --plan PRIVATE_JSON --confirm PRIVATE_JSON
  node scripts/tronclass/acceptance.mjs reconcile --plan PRIVATE_JSON
  node scripts/tronclass/acceptance.mjs --help

Only absolute, private regular files outside this repository are accepted.
preflight reads the existing bound account and school eligibility; it never claims or submits.
dispatch requires the reviewed plan's operationId, exact contentSha256 and confirmed:true.
It creates a permanent local .dispatch marker before entering the durable controlled core.
After any unknown result, use only reconcile with the original plan; never delete its marker or lock.
No passwords, cookies, arbitrary URLs, attachments, login, new operation IDs or production overrides.
Existing Web Admin/binding runtime configuration is required for real commands; --help does no I/O.
See scripts/tronclass/ACCEPTANCE.md. No live acceptance has been performed by this tool's tests.
`;
const SAFE_CODES = new Set([
  'TRONCLASS_ACCEPTANCE_ARGUMENTS',
  'TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED',
  'TRONCLASS_ACCEPTANCE_FILE_TOO_LARGE',
  'TRONCLASS_ACCEPTANCE_INVALID_JSON',
  'TRONCLASS_ACCEPTANCE_OUTPUT_EXISTS',
  'TRONCLASS_ACCEPTANCE_RUNTIME_UNAVAILABLE',
  'TRONCLASS_ACCEPTANCE_INVALID_RESULT',
  'TRONCLASS_ACCEPTANCE_INVALID_INPUT',
  'TRONCLASS_ACCEPTANCE_PLAN_CHANGED',
  'TRONCLASS_ACCEPTANCE_PLAN_EXPIRED',
  'TRONCLASS_ACCEPTANCE_CONFIRMATION_REQUIRED',
  'TRONCLASS_ACCEPTANCE_INPUT_CHANGED',
  'TRONCLASS_ACCEPTANCE_RECONCILE_ONLY',
  'TRONCLASS_ACCEPTANCE_UNAVAILABLE',
  'TRONCLASS_CONFIGURATION_REQUIRED',
  'TRONCLASS_OPERATION_CONFLICT',
  'TRONCLASS_RECONNECT_REQUIRED',
  'TRONCLASS_BINDING_CHANGED',
  'TRONCLASS_SUBMISSION_BLOCKED',
  'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED',
  'TRONCLASS_PROTOCOL_INVALID_INPUT',
  'TRONCLASS_SUBMISSION_UNAVAILABLE',
  'TRONCLASS_COURSE_ACCESS_DENIED',
  'TRONCLASS_HOMEWORK_NOT_FOUND',
  'TRONCLASS_READ_TIMEOUT',
  'TRONCLASS_JOURNAL_UNAVAILABLE',
  'TRONCLASS_HISTORY_UNAVAILABLE',
]);
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function localPath(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 4096 ||
    value.includes('\0')
  ) {
    fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
  }
  const resolved = path.normalize(value);
  if (resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`))
    fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
  return resolved;
}
function privateStat(stat, directory = false) {
  if (
    typeof process.getuid !== 'function' ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0 ||
    (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
  ) {
    fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
  }
}
// Node does not expose openat. Linux procfs resolves children relative to
// the open directory descriptor, including when the directory has been renamed.
const O_PATH = 0o10000000;
const fdPath = (handle) => `/proc/self/fd/${handle.fd}`;
const childPath = (directory, name) => `${fdPath(directory)}/${name}`;

async function withPrivateFileLocation(value, privateParent, action) {
  const handles = [];
  try {
    const { directory, name, verifyParent } = await pinLocation();
    return await action(directory, name, verifyParent);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }

  async function pinLocation() {
    try {
      const target = localPath(value);
      if (target.endsWith(path.sep)) fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
      const parts = target.slice(1).split(path.sep);
      const name = parts.pop();
      const flags = O_PATH | constants.O_DIRECTORY | constants.O_NOFOLLOW;
      let directory = await open('/', flags);
      handles.push(directory);
      const bindings = [];
      for (const part of parts) {
        const entry = childPath(directory, part);
        directory = await open(entry, flags);
        handles.push(directory);
        bindings.push({ entry, opened: await directory.stat({ bigint: true }) });
      }
      bindings.reverse();
      async function verifyParent() {
        if (privateParent) privateStat(await directory.stat(), true);
        // Check toward the root so a detached ancestor cannot hide a replacement.
        for (const { entry, opened } of bindings) {
          const current = await lstat(entry, { bigint: true });
          if (!current.isDirectory() || current.dev !== opened.dev || current.ino !== opened.ino)
            fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
        }
      }
      await verifyParent();
      return { directory, name, verifyParent };
    } catch (error) {
      if (SAFE_CODES.has(error?.code)) throw error;
      fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
    }
  }
}

export function readPrivateJson(value) {
  return withPrivateFileLocation(value, false, readPrivateJsonAt);
}

async function readPrivateJsonAt(directory, name, verifyParent) {
  let entry;
  let handle;
  try {
    // O_PATH binds even a FIFO without opening it for I/O. A symlink opened
    // with O_PATH | O_NOFOLLOW is itself the entry and fails the regular-file check.
    entry = await open(childPath(directory, name), O_PATH | constants.O_NOFOLLOW);
    privateStat(await entry.stat());
    await verifyParent();
    handle = await open(fdPath(entry), constants.O_RDONLY | constants.O_NONBLOCK);
    const before = await handle.stat();
    privateStat(before);
    if (before.size < 1 || before.size > MAX_FILE_BYTES)
      fail('TRONCLASS_ACCEPTANCE_FILE_TOO_LARGE');
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const next = await handle.read(bytes, length, bytes.length - length, null);
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    const after = await handle.stat();
    await verifyParent();
    if (length > MAX_FILE_BYTES) fail('TRONCLASS_ACCEPTANCE_FILE_TOO_LARGE');
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
      );
    } catch {
      fail('TRONCLASS_ACCEPTANCE_INVALID_JSON');
    }
  } catch (error) {
    if (SAFE_CODES.has(error?.code)) throw error;
    fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
  } finally {
    await Promise.all([handle?.close(), entry?.close()]);
  }
}

export function writePrivateJson(value, body, existingIsRefusal = false) {
  return withPrivateFileLocation(value, true, (directory, name, verifyParent) =>
    writePrivateJsonAt(directory, name, verifyParent, body, existingIsRefusal),
  );
}

async function writePrivateJsonAt(directory, name, verifyParent, body, existingIsRefusal = false) {
  const data = Buffer.from(`${JSON.stringify(body, null, 2)}\n`, 'utf8');
  if (data.byteLength > MAX_FILE_BYTES) fail('TRONCLASS_ACCEPTANCE_FILE_TOO_LARGE');
  let handle;
  try {
    await verifyParent();
    try {
      handle = await open(
        childPath(directory, name),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await verifyParent();
      if (existingIsRefusal) return false;
      fail('TRONCLASS_ACCEPTANCE_OUTPUT_EXISTS');
    }
    await verifyParent();
    await handle.chmod(0o600);
    await handle.writeFile(data);
    await handle.sync();
    await verifyParent();
    return true;
  } catch (error) {
    if (SAFE_CODES.has(error?.code)) throw error;
    fail('TRONCLASS_ACCEPTANCE_PRIVATE_FILE_REQUIRED');
  } finally {
    await handle?.close();
  }
}

/** A fixed esbuild entry, not an arbitrary module path or require/extension hook. */
export async function loadAcceptanceRuntime() {
  const version = process.versions.node.split('.').map(Number);
  if (version[0] !== 22 || version[1] < 23 || (version[1] === 23 && version[2] < 5)) {
    fail('TRONCLASS_ACCEPTANCE_RUNTIME_UNAVAILABLE');
  }
  try {
    const { build } = await import('esbuild');
    const require = createRequire(path.join(ROOT, 'package.json'));
    const result = await build({
      absWorkingDir: ROOT,
      entryPoints: ['apps/web/src/lib/server/tronClassAcceptance.ts'],
      tsconfig: path.join(ROOT, 'apps/web/tsconfig.json'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      conditions: ['react-server', 'node'],
      write: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'installed-firebase-admin',
          setup(context) {
            context.onResolve(
              { filter: /^firebase-admin\/(app|auth|firestore)$/ },
              ({ path: name }) => ({ path: require.resolve(name), external: true }),
            );
          },
        },
      ],
    });
    // The name only labels diagnostics. Evaluate esbuild's output directly.
    const filename = path.join(ROOT, 'scripts/tronclass/acceptance-runtime.cjs');
    const module = { exports: {} };
    const evaluate = compileFunction(result.outputFiles[0].text,
      ['exports', 'require', 'module', '__filename', '__dirname'], { filename });
    evaluate.call(module.exports, module.exports, require, module, filename, path.dirname(filename));
    return { module: module.exports, dispose: async () => {} };
  } catch {
    fail('TRONCLASS_ACCEPTANCE_RUNTIME_UNAVAILABLE');
  }
}
function publicResult(value, operationId) {
  if (!value || value.operationId !== operationId || value.receipt !== null)
    fail('TRONCLASS_ACCEPTANCE_INVALID_RESULT');
  if (value.status === 'unknown')
    return { status: 'unknown', operationId, receipt: null, nextAction: 'reconcile' };
  const confirmation = value.confirmation;
  if (
    value.status !== 'confirmed' ||
    !confirmation ||
    confirmation.kind !== 'acknowledged-readback' ||
    confirmation.source !== 'tronclass' ||
    confirmation.schoolId !== 'pu' ||
    confirmation.operationId !== operationId ||
    !['submissionId', 'courseId', 'homeworkId'].every(
      (key) => Number.isSafeInteger(confirmation[key]) && confirmation[key] > 0,
    ) ||
    !canonicalInstant(confirmation.confirmedAt) ||
    !(confirmation.sourceRecordedAt === null || canonicalInstant(confirmation.sourceRecordedAt))
  ) {
    fail('TRONCLASS_ACCEPTANCE_INVALID_RESULT');
  }
  return {
    status: 'confirmed',
    operationId,
    receipt: null,
    confirmation: {
      kind: confirmation.kind,
      source: confirmation.source,
      schoolId: confirmation.schoolId,
      operationId,
      submissionId: confirmation.submissionId,
      courseId: confirmation.courseId,
      homeworkId: confirmation.homeworkId,
      confirmedAt: confirmation.confirmedAt,
      sourceRecordedAt: confirmation.sourceRecordedAt,
    },
    contractVerified: false,
  };
}
function canonicalInstant(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export async function runAcceptanceCli(
  args,
  {
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
    loadRuntime = loadAcceptanceRuntime,
  } = {},
) {
  let runtime;
  let service;
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        strict: true,
        options: {
          help: { type: 'boolean' },
          input: { type: 'string' },
          plan: { type: 'string' },
          confirm: { type: 'string' },
        },
      });
    } catch {
      fail('TRONCLASS_ACCEPTANCE_ARGUMENTS');
    }
    const { values, positionals } = parsed;
    if (values.help && positionals.length === 0 && Object.keys(values).length === 1) {
      stdout(HELP);
      return 0;
    }
    const command = positionals[0];
    const required =
      command === 'preflight'
        ? ['input', 'plan']
        : command === 'dispatch'
          ? ['input', 'plan', 'confirm']
          : command === 'reconcile'
            ? ['plan']
            : null;
    if (
      positionals.length !== 1 ||
      !required ||
      Object.keys(values).length !== required.length ||
      required.some((key) => !values[key])
    ) {
      fail('TRONCLASS_ACCEPTANCE_ARGUMENTS');
    }
    const input = values.input ? await readPrivateJson(values.input) : undefined;
    await withPrivateFileLocation(values.plan, true, async (directory, name, verifyParent) => {
      const plan =
        command === 'preflight' ? undefined : await readPrivateJsonAt(directory, name, verifyParent);
      const confirmation = values.confirm ? await readPrivateJson(values.confirm) : undefined;
      if (command === 'preflight') {
        try {
          await lstat(childPath(directory, name));
          fail('TRONCLASS_ACCEPTANCE_OUTPUT_EXISTS');
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      runtime = await loadRuntime();
      if (input !== undefined) runtime.module.parseTronClassAcceptanceInput(input);
      service = await runtime.module.createDefaultTronClassAcceptanceService({
        reserveDispatch: (accepted) =>
          writePrivateJsonAt(
            directory,
            `${name}.dispatch`,
            verifyParent,
            {
              version: 1,
              state: 'dispatch-started',
              operationId: accepted.operationId,
              contentSha256: accepted.contentSha256,
              planSignature: accepted.signature,
            },
            true,
          ),
      });
      if (command === 'preflight') {
        const prepared = await service.preflight(input);
        await writePrivateJsonAt(directory, name, verifyParent, prepared);
        stdout(
          `${JSON.stringify({
            status: 'prepared',
            operationId: prepared.operationId,
            contentSha256: prepared.contentSha256,
            expiresAt: prepared.expiresAt,
            contractVerified: false,
          })}\n`,
        );
      } else {
        const result =
          command === 'dispatch'
            ? await service.dispatch(input, plan, confirmation)
            : await service.reconcile(plan);
        stdout(`${JSON.stringify(publicResult(result, plan.operationId))}\n`);
      }
    });
    await service.dispose?.();
    service = undefined;
    await runtime.dispose();
    runtime = undefined;
    return 0;
  } catch (error) {
    const code = SAFE_CODES.has(error?.code) ? error.code : 'TRONCLASS_ACCEPTANCE_UNAVAILABLE';
    stderr(`${code}\n`);
    return 1;
  } finally {
    try {
      await service?.dispose?.();
    } catch {
      stderr('TRONCLASS_ACCEPTANCE_RUNTIME_UNAVAILABLE\n');
    }
    try {
      await runtime?.dispose();
    } catch {
      stderr('TRONCLASS_ACCEPTANCE_RUNTIME_UNAVAILABLE\n');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAcceptanceCli(process.argv.slice(2));
}
