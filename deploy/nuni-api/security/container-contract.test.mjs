import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'source.json'), 'utf8'));

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

test('local security image exists with expected platform labels and non-root contract', (t) => {
  const inspect = docker([
    'image',
    'inspect',
    manifest.imageTag,
    '--format',
    '{{.Id}}|{{.Architecture}}|{{.Os}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{json .Config.User}}|{{json .Config.Cmd}}',
  ]);
  if (inspect.status !== 0) {
    t.skip(`${manifest.imageTag} not built yet`);
    return;
  }
  const [id, arch, os, revision, user, cmd] = inspect.stdout.trim().split('|');
  assert.match(id, /^sha256:/);
  assert.equal(arch, 'amd64');
  assert.equal(os, 'linux');
  assert.equal(revision, manifest.candidateTree);
  assert.equal(JSON.parse(user), 'node');
  assert.deepEqual(JSON.parse(cmd), ['node', 'apps/api/dist/index.js']);
  const uid = docker(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', manifest.imageTag, '-p', 'process.getuid()']);
  assert.equal(uid.status, 0, uid.stderr);
  assert.equal(uid.stdout.trim(), '1000', 'runtime must use the unprivileged node account');
});

test('security image runtime package metadata has patched versions and no forbidden vulns', (t) => {
  const exists = docker(['image', 'inspect', manifest.imageTag]);
  if (exists.status !== 0) {
    t.skip(`${manifest.imageTag} not built yet`);
    return;
  }
  const script = `
const fs = require('fs');
const path = require('path');
const root = '/app/node_modules/.pnpm';
function versions(name) {
  const out = new Set();
  for (const ent of fs.readdirSync(root)) {
    if (!ent.startsWith(name.replace('/', '+') + '@') && !ent.startsWith(name + '@')) continue;
    const pkg = path.join(root, ent, 'node_modules', ...name.split('/'), 'package.json');
    if (fs.existsSync(pkg)) out.add(JSON.parse(fs.readFileSync(pkg, 'utf8')).version);
  }
  return [...out].sort();
}
const report = {
  node: process.version,
  serverExists: fs.existsSync('/app/apps/api/dist/index.js'),
  fastify: versions('fastify'),
  zod: versions('zod'),
  'brace-expansion': versions('brace-expansion'),
  'fast-uri': versions('fast-uri'),
  '@grpc/grpc-js': versions('@grpc/grpc-js'),
};
process.stdout.write(JSON.stringify(report));
`;
  const run = docker([
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--entrypoint',
    'node',
    manifest.imageTag,
    '-e',
    script,
  ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(run.stdout);
  assert.equal(report.serverExists, true);
  assert.match(report.node, /^v24\.22\.1/);
  assert.deepEqual(report.fastify, ['5.12.7']);
  assert.deepEqual(report.zod, ['4.6.7']);
  assert.deepEqual(report['brace-expansion'], ['5.0.12']);
  assert.deepEqual(report['@grpc/grpc-js'], ['1.14.5']);
  assert.deepEqual(report['fast-uri'], ['3.1.9', '4.2.3']);
});
