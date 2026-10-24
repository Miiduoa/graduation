import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(fileURLToPath(import.meta.url));
const buildPy = join(root, 'build.py');

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeTinyRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'nuni-legacy-build-src-'));
  runGit(dir, ['init']);
  runGit(dir, ['config', 'user.email', 'legacy-test@example.com']);
  runGit(dir, ['config', 'user.name', 'legacy-test']);
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'tiny\n');
  writeFileSync(join(dir, 'apps', 'web', 'package.json'), '{"name":"web"}\n');
  runGit(dir, ['add', '.']);
  runGit(dir, ['commit', '-m', 'init']);
  return dir;
}

function invokeBuild(args, env = {}) {
  return spawnSync('python3', [buildPy, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('fail closed: existing --keep-checkout is refused and sentinel untouched', () => {
  const parent = mkdtempSync(join(tmpdir(), 'nuni-legacy-keep-'));
  const dest = join(parent, 'checkout');
  mkdirSync(dest);
  const sentinel = join(dest, 'DO_NOT_DELETE');
  writeFileSync(sentinel, 'preserve-me\n');
  const source = makeTinyRepo();
  try {
    const result = invokeBuild(['--source', source, '--keep-checkout', dest, '--skip-docker']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /existing path|fail closed/i);
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-me\n');
    assert.equal(existsSync(sentinel), true);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

test('fail closed: --keep-checkout equal to source is refused and source unchanged', () => {
  const source = makeTinyRepo();
  const before = runGit(source, ['rev-parse', 'HEAD']);
  try {
    const result = invokeBuild(['--source', source, '--keep-checkout', source, '--skip-docker']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /equals or nests with source/i);
    assert.equal(runGit(source, ['rev-parse', 'HEAD']), before);
    assert.equal(existsSync(join(source, 'README.md')), true);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test('fail closed: --keep-checkout nested under source is refused', () => {
  const source = makeTinyRepo();
  const dest = join(source, 'nested-dest');
  try {
    const result = invokeBuild(['--source', source, '--keep-checkout', dest, '--skip-docker']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /equals or nests with source/i);
    assert.equal(existsSync(join(source, '.git')), true);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test('fail closed: missing parent directory for --keep-checkout is refused', () => {
  const source = makeTinyRepo();
  const parent = mkdtempSync(join(tmpdir(), 'nuni-legacy-parent-'));
  const missingParent = join(parent, 'does-not-exist');
  const dest = join(missingParent, 'checkout');
  try {
    const result = invokeBuild(['--source', source, '--keep-checkout', dest, '--skip-docker']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /missing parent/i);
    assert.equal(existsSync(missingParent), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});
