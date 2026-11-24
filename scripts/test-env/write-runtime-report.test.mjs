import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { writeRuntimeReport } = require('./write-runtime-report.cjs');

test('writeRuntimeReport writes a regular report file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  try {
    writeRuntimeReport(dir, 'health.json', { ok: true });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'health.json'), 'utf8')).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRuntimeReport refuses a symbolic link and leaves the target unchanged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  try {
    const outside = path.join(dir, 'outside.json');
    writeFileSync(outside, 'preserve-me');
    symlinkSync(outside, path.join(dir, 'health.json'));
    assert.throws(() => writeRuntimeReport(dir, 'health.json', { ok: false }), /unusable report/);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-me');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRuntimeReport refuses a hard link and does not truncate the other file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tronclass-report-'));
  try {
    const outside = path.join(dir, 'outside.json');
    writeFileSync(outside, 'preserve-hard-link');
    linkSync(outside, path.join(dir, 'acceptance.json'));
    assert.throws(() => writeRuntimeReport(dir, 'acceptance.json', { ok: false }), /unusable report/);
    assert.equal(readFileSync(outside, 'utf8'), 'preserve-hard-link');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
