#!/usr/bin/env node
/** Local acceptance only: full pinned source, fresh owned Unix-socket PG, no DB URL input. */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.length !== 4 || process.argv[2] !== '--source')
  throw Error('Pass --source <pinned reconstructed API tree>');
const source = realpathSync(process.argv[3]);
const git = (args) => {
  const r = spawnSync('git', ['-C', source, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', LANG: 'C' },
  });
  if (r.status !== 0) throw Error('Cannot verify source tree');
  return r.stdout.trim();
};
if (git(['write-tree']) !== 'b0a10ac814cd03fbfb45132566035acce8339f17')
  throw Error('Source tree does not match recorded production tree');
git(['diff-files', '--quiet']);
if (git(['ls-files', '--others', '--exclude-standard']))
  throw Error('Untracked source files are not accepted');
const postgres = '/opt/homebrew/opt/postgresql@17/bin';
const folder = mkdtempSync('/tmp/c1migration-');
const socket = join(folder, 'socket'),
  data = join(folder, 'data');
const env = {
  PATH: `${postgres}:${dirname(process.execPath)}:/usr/bin:/bin`,
  LANG: 'C',
  LC_ALL: 'C',
  TMPDIR: folder,
};
let attempted = false;
function run(bin, args, extra = {}) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: 'utf8', ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${bin} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
try {
  chmodSync(folder, 0o700);
  mkdirSync(socket, { mode: 0o700 });
  // Bundle the exact pinned TypeScript database implementation, not a copy of its migration logic.
  const bundle = join(folder, 'database.mjs');
  run(join(root, 'node_modules/.bin/esbuild'), [
    join(source, 'apps/api/src/database.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--packages=external',
    `--alias:@campus/contracts=${join(source, 'packages/contracts/src/index.ts')}`,
    `--outfile=${bundle}`,
    '--log-level=warning',
  ]);
  symlinkSync(realpathSync(join(root, 'node_modules')), join(folder, 'node_modules'));
  for (const name of ['before', 'candidate', 'rollback']) {
    const dir = join(folder, name);
    mkdirSync(dir);
    cpSync(bundle, join(dir, 'database.mjs'));
    cpSync(join(source, 'apps/api/src/schema.sql'), join(dir, 'schema.sql'));
    cpSync(join(source, 'apps/api/src/migrations'), join(dir, 'migrations'), { recursive: true });
    if (name !== 'before')
      cpSync(
        join(root, 'deploy/nuni-api/platform-public-agent/schema.candidate.sql'),
        join(dir, 'migrations/999_public_agent_isolated_test_only.sql'),
      );
  }
  run(join(postgres, 'initdb'), [
    '-D',
    data,
    '-U',
    'campus_synthetic',
    '-A',
    'trust',
    '--no-instructions',
  ]);
  attempted = true;
  run(join(postgres, 'pg_ctl'), [
    '-D',
    data,
    '-l',
    join(folder, 'server.log'),
    '-w',
    '-t',
    '20',
    '-o',
    `-c listen_addresses='' -c unix_socket_directories=${socket} -c unix_socket_permissions=0700 -p 55432`,
    'start',
  ]);
  writeFileSync(join(folder, 'owner'), `${process.pid}\n`, { mode: 0o600 });
  const child = spawnSync(
    process.execPath,
    [join(root, 'scripts/platform-public-agent/full-migration-isolated.test.mjs')],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...env,
        C1_MIGRATION_FOLDER: realpathSync(folder),
        C1_MIGRATION_PARENT: String(process.pid),
      },
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`Isolated full migration test: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (attempted) {
    const status = spawnSync(join(postgres, 'pg_ctl'), ['-D', data, 'status'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    if (status.error || ![0, 3].includes(status.status)) {
      process.stderr.write(`Cannot establish owned cluster status; preserved ${folder}.\n`);
      process.exit(1);
    }
    if (status.status === 0) {
      try {
        run(join(postgres, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'fast', 'stop']);
      } catch {
        process.stderr.write(`Could not stop owned cluster; preserved ${folder}.\n`);
        process.exit(1);
      }
    }
  }
  rmSync(folder, { recursive: true, force: true });
}
