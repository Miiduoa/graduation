#!/usr/bin/env node
// Self-owned temporary cluster only; never accepts a database URL or external host.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.length !== 4 || process.argv[2] !== '--prepared')
  throw Error('Expected --prepared <local-test-checkout>');
const source = realpathSync(process.argv[3]);
if (!source.startsWith(`${root}/output/`))
  throw Error('Checkout must be in this worktree output directory');
const manifest = JSON.parse(readFileSync(join(source, 'public-agent-test-manifest.json'), 'utf8'));
if (
  manifest.kind !== 'local-test-only' ||
  manifest.baseTree !== 'b0a10ac814cd03fbfb45132566035acce8339f17' ||
  manifest.migration !== '999_public_agent_isolated_test_only'
)
  throw Error('Unexpected test manifest');
for (const [path, checksum] of Object.entries(manifest.files)) {
  if (path.startsWith('/') || path.split('/').includes('..')) throw Error('Invalid manifest path');
  if (
    createHash('sha256')
      .update(readFileSync(join(source, path)))
      .digest('hex') !== checksum
  )
    throw Error(`Test manifest drift: ${path}`);
}
const pg = '/opt/homebrew/opt/postgresql@17/bin';
const folder = mkdtempSync('/tmp/c1host-'),
  socket = join(folder, 'socket'),
  data = join(folder, 'data');
const env = {
  PATH: `${pg}:/opt/homebrew/opt/node@22/bin:/usr/bin:/bin`,
  HOME: folder,
  LANG: 'C',
  LC_ALL: 'C',
  TMPDIR: folder,
  NODE_ENV: 'development',
};
let started = false;
function run(bin, args, extra = {}) {
  const result = spawnSync(bin, args, { env, encoding: 'utf8', ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`${bin} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}
try {
  chmodSync(folder, 0o700);
  mkdirSync(socket, { mode: 0o700 });
  run(join(pg, 'initdb'), [
    '-D',
    data,
    '-U',
    'campus_synthetic',
    '-A',
    'trust',
    '--no-instructions',
  ]);
  run(join(pg, 'pg_ctl'), [
    '-D',
    data,
    '-l',
    join(folder, 'postgres.log'),
    '-w',
    '-t',
    '20',
    '-o',
    `-c listen_addresses='' -c unix_socket_directories=${socket} -c unix_socket_permissions=0700 -p 55433`,
    'start',
  ]);
  started = true;
  writeFileSync(join(folder, 'owner'), `${process.pid}\n`, { mode: 0o600 });
  const api = join(source, 'apps/api');
  const test = join(api, 'src/platform-public-agent/pinned-host.integration.ts');
  copyFileSync(join(root, 'scripts/platform-public-agent/pinned-host.integration.ts'), test);
  const result = run('/opt/homebrew/opt/node@22/bin/node', ['--import', 'tsx', test], {
    cwd: api,
    env: { ...env, C1_HOST_PG_FOLDER: realpathSync(folder) },
  });
  if (
    result.stdout.includes('SYNTHETIC_LOG_CANARY_8cd2') ||
    result.stderr.includes('SYNTHETIC_LOG_CANARY_8cd2') ||
    result.stdout.includes(`ps_${'A'.repeat(43)}`) ||
    result.stderr.includes(`ps_${'A'.repeat(43)}`)
  )
    throw Error('Synthetic secret canary appeared in logs');
  if (!result.stdout.includes('Pinned host: disabled default'))
    throw Error('Test did not report completion');
  console.log(
    'Pinned Fastify host + real PlatformAccountService + CampusDatabase + Unix-only PostgreSQL: passed; synthetic canaries absent from logs.',
  );
} finally {
  if (started) {
    try {
      run(join(pg, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'fast', 'stop']);
    } catch {
      console.error(`Could not stop self-owned cluster; preserved ${folder}`);
      process.exit(1);
    }
  }
  rmSync(folder, { recursive: true, force: true });
}
