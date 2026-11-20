import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { listSeedDocuments, runOralExamSeed } from './seed-oral-exam.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'seed-oral-exam.mjs');

test('dry-run is the default and only prints tagged oral-exam documents', async () => {
  const result = await runOralExamSeed([]);
  assert.equal(result.mode, 'dry-run');
  assert.ok(result.documents.length >= 20);
  for (const doc of result.documents) {
    assert.match(doc.path, /oral-exam|nuni-oral-exam/);
    assert.equal(doc.data.demo, true);
    assert.equal(doc.data.oralExamTag, '2026-11-12');
    assert.equal(doc.data.tenantId, 'nuni-oral-exam');
    assert.equal(doc.data.schoolId, 'nuni-oral-exam');
  }
  const paths = result.documents.map((doc) => doc.path);
  assert.ok(paths.includes('schools/nuni-oral-exam'));
  assert.ok(paths.some((path) => path.includes('announcements')));
  assert.ok(paths.some((path) => path.includes('cafeterias')));
  assert.ok(paths.some((path) => path.includes('lostFoundItems')));
  assert.ok(paths.some((path) => path.includes('leaveRequests')));
  assert.ok(!JSON.stringify(result.documents).toLowerCase().includes('password'));
});

test('apply without confirm env is rejected and writes nothing', async () => {
  delete process.env.ORAL_EXAM_SEED_CONFIRM;
  await assert.rejects(() => runOralExamSeed(['--apply']), /ORAL_EXAM_SEED_CONFIRM/);
});

test('remove without confirm env is rejected', async () => {
  delete process.env.ORAL_EXAM_SEED_CONFIRM;
  await assert.rejects(() => runOralExamSeed(['--remove']), /ORAL_EXAM_SEED_CONFIRM/);
});

test('apply and remove cannot be combined', async () => {
  await assert.rejects(() => runOralExamSeed(['--apply', '--remove']), /不能同時/);
});

test('CLI dry-run exits 0 and prints the tenant plan', () => {
  const ran = spawnSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /nuni-oral-exam/);
  assert.match(ran.stdout, /dry-run/);
  assert.match(ran.stdout, /SET {2}schools\/nuni-oral-exam/);
  assert.doesNotMatch(ran.stdout, /password/i);
});

test('seed plan stays limited to the demo tenant', () => {
  const foreign = listSeedDocuments().filter(
    (doc) => doc.data.tenantId !== 'nuni-oral-exam' || doc.data.demo !== true,
  );
  assert.deepEqual(foreign, []);
});

test('shared catalog uses the same tenant and tag', () => {
  const source = readFileSync(join(here, '../../packages/shared/src/oralExamDemo.ts'), 'utf8');
  assert.match(source, /ORAL_EXAM_TENANT_ID = 'nuni-oral-exam'/);
  assert.match(source, /ORAL_EXAM_TAG = '2026-11-12'/);
  assert.match(source, /示範學生王小明/);
  assert.doesNotMatch(source, /password/i);
});
