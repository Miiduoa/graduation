import assert from 'node:assert/strict';
import {
  closeSync, constants, existsSync, linkSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { writeRuntimeReport } = require('./write-runtime-report.cjs');

test('writeRuntimeReport writes a regular report file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    writeRuntimeReport(fd, 'health.json', { ok: true });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'health.json'), 'utf8')).ok, true);
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRuntimeReport refuses a symbolic link and leaves the target unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const outside = path.join(dir, 'outside.json');
    writeFileSync(outside, 'preserve-me');
    symlinkSync(outside, path.join(dir, 'health.json'));
    assert.throws(() => writeRuntimeReport(fd, 'health.json', { ok: false }), /unusable report/);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-me');
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRuntimeReport refuses a hard link and does not truncate the other file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const outside = path.join(dir, 'outside.json');
    writeFileSync(outside, 'preserve-hard-link');
    linkSync(outside, path.join(dir, 'acceptance.json'));
    assert.throws(() => writeRuntimeReport(fd, 'acceptance.json', { ok: false }), /unusable report/);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-hard-link');
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports stay in the pinned runtime when its parent is replaced with a symbolic link', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-swap-'));
  const parent = path.join(dir, 'parent');
  const moved = path.join(dir, 'moved');
  const outside = path.join(dir, 'outside');
  const runtime = path.join(parent, 'runtime');
  const outsideRuntime = path.join(outside, 'runtime');
  mkdirSync(runtime, { recursive: true });
  mkdirSync(outsideRuntime, { recursive: true });
  const outsideHealth = path.join(outsideRuntime, 'health.json');
  writeFileSync(outsideHealth, 'preserve-existing-report');

  const fd = openSync(runtime, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    renameSync(parent, moved);
    symlinkSync(outside, parent);
    for (const name of ['health.json', 'acceptance.json']) {
      writeRuntimeReport(fd, name, { ok: true });
      assert.deepEqual(JSON.parse(readFileSync(path.join(moved, 'runtime', name), 'utf8')), { ok: true });
    }
    assert.equal(readFileSync(outsideHealth, 'utf8'), 'preserve-existing-report');
    assert.equal(existsSync(path.join(outsideRuntime, 'acceptance.json')), false);
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});
