import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditStudyComparisons, verifyLocalStudyFixtures } from './compare.mjs';
const result = (product, completed = true) => ({
  product, version: '2026-11-17', completed, correct: completed,
  sourceVerified: completed, failureReason: completed ? undefined : 'model unavailable',
  steps: completed ? 4 : null, coldStartMs: completed ? 1500 : null,
  warmStartMs: completed ? 500 : null, peakMemoryMiB: completed ? 200 : null,
  offlineCompleted: completed ? true : null, costTwd: 0,
});
const fixture = () => ({ schemaVersion: 1, trials: [{
  caseId: 'pair-1', sourceSha256: 'a'.repeat(64), questionSha256: 'b'.repeat(64),
  sourcePermissionConfirmed: true, manualReviewer: 'human test operator',
  environment: { date: '2026-11-17', device: 'same phone', browser: 'same browser', network: 'same WiFi' },
  results: [result('nuni'), result('Ahaboard', false)],
}] });
test('keeps failures and unknown timings in denominator instead of silently scoring zero', () => {
  const report = auditStudyComparisons(fixture());
  assert.equal(report.trialCount, 1);
  assert.equal(report.summary.Ahaboard.completed, 0);
  assert.equal(report.summary.Ahaboard.averageColdStartMs, null);
  assert.deepEqual(report.pairedColdStartDeltasMs, [null]);
});
test('rejects missing comparisons, unauthorized sources and duplicate cases', () => {
  const single = fixture(); single.trials[0].results.pop();
  assert.throws(() => auditStudyComparisons(single), /exactly one/);
  const unlicensed = fixture(); unlicensed.trials[0].sourcePermissionConfirmed = false;
  assert.throws(() => auditStudyComparisons(unlicensed), /permission/);
  const duplicated = fixture(); duplicated.trials.push(structuredClone(duplicated.trials[0]));
  assert.throws(() => auditStudyComparisons(duplicated), /duplicate caseId/);
});
test('rejects false success for failures and non-finite values', () => {
  const bad = fixture(); bad.trials[0].results[1].correct = true;
  assert.throws(() => auditStudyComparisons(bad), /failed attempt/);
  const infinite = fixture(); infinite.trials[0].results[0].coldStartMs = Infinity;
  assert.throws(() => auditStudyComparisons(infinite), /finite nonnegative/);
});
test('calculates only observed paired timing deltas without declaring a winner', () => {
  const good = fixture(); good.trials[0].results[1] = { ...result('Ahaboard'), coldStartMs: 1000 };
  const report = auditStudyComparisons(good);
  assert.deepEqual(report.pairedColdStartDeltasMs, [500]);
  assert.equal(report.summary.Ahaboard.correctAndSourceVerified, 1);
  assert.equal('winner' in report, false);
});


test('preserves unknown actual cost instead of treating it as a free service', () => {
  const unknown = fixture();
  unknown.trials[0].results[1].costTwd = null;
  const report = auditStudyComparisons(unknown);
  assert.equal(report.summary.Ahaboard.totalCostTwd, null);
  assert.equal(report.summary.Ahaboard.measuredCostTotalTwd, 0);
  assert.equal(report.summary.Ahaboard.costNotMeasured, 1);
  assert.equal(report.summary.nuni.totalCostTwd, 0);
  assert.equal(report.summary.nuni.costNotMeasured, 0);
  const missing = fixture();
  delete missing.trials[0].results[1].costTwd;
  assert.throws(() => auditStudyComparisons(missing), /finite nonnegative/);
});

test('rejects impossible calendar dates, including non-leap February 29', () => {
  const impossible = fixture();
  impossible.trials[0].environment.date = '2026-02-30';
  assert.throws(() => auditStudyComparisons(impossible), /valid ISO date/);
  const leap = fixture();
  leap.trials[0].environment.date = '2024-02-29';
  assert.equal(auditStudyComparisons(leap).trialCount, 1);
});

test('reports measurement denominators instead of hiding missing timings and memory', () => {
  const paired = fixture();
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results[0].coldStartMs = null;
  second.results[0].warmStartMs = null;
  second.results[0].peakMemoryMiB = null;
  second.results[0].steps = null;
  second.results[1].offlineCompleted = null;
  paired.trials.push(second);
  const report = auditStudyComparisons(paired);
  assert.equal(report.trialCount, 2);
  assert.deepEqual(report.summary.nuni.measuredCounts, {
    steps: 1, coldStartMs: 1, warmStartMs: 1,
    peakMemoryMiB: 1, offlineCompleted: 2, costTwd: 2,
  });
  assert.equal(report.summary.nuni.averageColdStartMs, 1500);
  assert.deepEqual(report.pairedWarmStartDeltasMs, [null, null]);
  assert.equal(report.summary.Ahaboard.offlineNotMeasured, 2);
  assert.equal('winner' in report, false);
});

test('only reports warm-start deltas when both products were measured', () => {
  const paired = fixture();
  paired.trials[0].results[1] = { ...result('Ahaboard'), warmStartMs: 250 };
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.pairedWarmStartDeltasMs, [250]);
  assert.equal(report.summary.nuni.measuredCounts.warmStartMs, 1);
  assert.equal(report.summary.Ahaboard.measuredCounts.warmStartMs, 1);
});

test('rejects an offline completion claim when the student task failed', () => {
  const paired = fixture();
  paired.trials[0].results[1].offlineCompleted = true;
  assert.throws(() => auditStudyComparisons(paired), /failed attempt cannot count as offline-completed/);
});


test('keeps finite latency and memory averages when their raw sum would overflow', () => {
  const large = fixture();
  large.trials[0].results[1] = {
    ...result('Ahaboard'), coldStartMs: 1e308, warmStartMs: 1e308, peakMemoryMiB: 1e308,
  };
  const another = structuredClone(large.trials[0]);
  another.caseId = 'pair-2';
  large.trials.push(another);
  const report = auditStudyComparisons(large);
  for (const key of ['averageColdStartMs', 'averageWarmStartMs', 'averagePeakMemoryMiB']) {
    assert.equal(report.summary.Ahaboard[key], 1e308);
  }
  assert.ok(!JSON.stringify(report).includes('"averageColdStartMs":null'));
});

test('rejects overflowing measured costs instead of serializing Infinity as unknown', () => {
  const large = fixture();
  large.trials[0].results[0].costTwd = 1e308;
  const another = structuredClone(large.trials[0]);
  another.caseId = 'pair-2';
  large.trials.push(another);
  assert.throws(() => auditStudyComparisons(large), /measured total exceeds finite numeric range/);
  // Unknown individual costs do not excuse overflowing known-cost subtotals.
  large.trials[0].results[1].costTwd = null;
  assert.throws(() => auditStudyComparisons(large), /measured total exceeds finite numeric range/);
});


test('counts paired human-verified outcomes including failed and unsupported attempts', () => {
  const paired = fixture(); // nuni verified, Ahaboard failed
  const add = (caseId, nuni, ahaboard) => {
    const item = structuredClone(paired.trials[0]);
    item.caseId = caseId;
    item.results = [nuni, ahaboard];
    paired.trials.push(item);
  };
  add('pair-2', result('nuni'), result('Ahaboard')); // both verified
  add('pair-3', result('nuni', false), result('Ahaboard')); // Ahaboard alone
  add('pair-4', result('nuni', false), result('Ahaboard', false)); // neither
  const unsupported = result('nuni');
  unsupported.sourceVerified = false; // completed and correct, but not grounded
  add('pair-5', unsupported, result('Ahaboard', false)); // still neither
  const report = auditStudyComparisons(paired);
  assert.equal(report.trialCount, 5);
  assert.deepEqual(report.pairedVerifiedCounts, {
    both: 1, nuniOnly: 1, ahaboardOnly: 1, neither: 2,
  });
  assert.equal(report.summary.nuni.completed, 3);
  assert.equal(report.summary.nuni.correctAndSourceVerified, 2);
  assert.equal('winner' in report, false);
});

test('compares steps, memory and actual costs only in the same measured pair', () => {
  const paired = fixture();
  paired.trials[0].results[1] = {
    ...result('Ahaboard'), steps: 7, peakMemoryMiB: 250,
    costTwd: 2, offlineCompleted: false,
  };
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results[0].steps = null;
  second.results[0].peakMemoryMiB = null;
  second.results[0].costTwd = null;
  second.results[1].offlineCompleted = null;
  paired.trials.push(second);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.pairedStepsDeltas, [-3, null]);
  assert.deepEqual(report.pairedPeakMemoryDeltasMiB, [-50, null]);
  assert.deepEqual(report.pairedCostDeltasTwd, [-2, null]);
  assert.deepEqual(report.pairedOfflineCounts, {
    both: 0, nuniOnly: 1, ahaboardOnly: 0, neither: 0, unmeasured: 1,
  });
  assert.equal(report.summary.nuni.totalCostTwd, null);
  assert.equal('winner' in report, false);
});

test('separates measured offline failure from a missing offline measurement', () => {
  const paired = fixture();
  paired.trials[0].results[0].offlineCompleted = false;
  paired.trials[0].results[1].offlineCompleted = false;
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results[0].offlineCompleted = null;
  // This pair has a genuinely completed Ahaboard run. Failed runs must not
  // claim successful offline completion, even in a comparison fixture.
  second.results[1] = result('Ahaboard');
  paired.trials.push(second);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.pairedOfflineCounts, {
    both: 0, nuniOnly: 0, ahaboardOnly: 0, neither: 1, unmeasured: 1,
  });
  assert.equal(report.summary.Ahaboard.offlineCompleted, 1);
});

test('keeps case IDs aligned to measured deltas and per-case verification/offline outcomes', () => {
  const paired = fixture(); // nuni verified, Ahaboard failed; offline unknown for failed
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results = [result('nuni', false), result('Ahaboard')];
  paired.trials.push(second);
  const third = structuredClone(paired.trials[0]);
  third.caseId = 'pair-3';
  third.results = [
    { ...result('nuni'), sourceVerified: false, offlineCompleted: false },
    { ...result('Ahaboard'), correct: false, offlineCompleted: false },
  ];
  paired.trials.push(third);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.caseIds, ['pair-1', 'pair-2', 'pair-3']);
  assert.deepEqual(report.pairedVerifiedOutcomes, ['nuniOnly', 'ahaboardOnly', 'neither']);
  assert.deepEqual(report.pairedOfflineOutcomes, ['unmeasured', 'unmeasured', 'neither']);
  assert.deepEqual(report.pairedColdStartDeltasMs, [null, null, 0]);
  assert.deepEqual(report.pairedVerifiedCounts, {
    both: 0, nuniOnly: 1, ahaboardOnly: 1, neither: 1,
  });
  assert.deepEqual(report.pairedOfflineCounts, {
    both: 0, nuniOnly: 0, ahaboardOnly: 0, neither: 1, unmeasured: 2,
  });
  // A report must not echo source text or pretend to have graded it.
  assert.equal('winner' in report, false);
  assert.equal(JSON.stringify(report).includes('human test operator'), false);
});

test('paired mean deltas exclude unpaired measurements rather than comparing separate averages', () => {
  const paired = fixture();
  paired.trials[0].results[1] = {
    ...result('Ahaboard'), coldStartMs: 1000, warmStartMs: 250,
    steps: 7, peakMemoryMiB: 250, costTwd: 2,
  };
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results[0].coldStartMs = null;
  second.results[0].peakMemoryMiB = null;
  second.results[0].costTwd = null;
  second.results[1].coldStartMs = 1e308;
  second.results[1].warmStartMs = null;
  second.results[1].steps = 6;
  paired.trials.push(second);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.pairedMeasuredCounts, {
    coldStartMs: 1, warmStartMs: 1, steps: 2, peakMemoryMiB: 1, costTwd: 1,
  });
  assert.deepEqual(report.pairedAverageDeltas, {
    coldStartMs: 500, warmStartMs: 250, steps: -2.5, peakMemoryMiB: -50, costTwd: -2,
  });
  assert.deepEqual(report.pairedColdStartDeltasMs, [500, null]);
  assert.equal(report.summary.Ahaboard.measuredCounts.coldStartMs, 2);
  assert.equal(report.summary.nuni.measuredCounts.coldStartMs, 1);
  assert.equal('winner' in report, false);
});

test('signed paired means stay finite for opposite extreme measurements', () => {
  const paired = fixture();
  paired.trials[0].results[1] = result('Ahaboard');
  paired.trials[0].results[0].coldStartMs = 1e308;
  paired.trials[0].results[1].coldStartMs = 0;
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.results[0].coldStartMs = 0;
  second.results[1].coldStartMs = 1e308;
  paired.trials.push(second);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.pairedColdStartDeltasMs, [1e308, -1e308]);
  assert.equal(report.pairedMeasuredCounts.coldStartMs, 2);
  assert.equal(report.pairedAverageDeltas.coldStartMs, 0);
  assert.equal(JSON.stringify(report).includes('"coldStartMs":null'), false);
});

test('all missing paired measurements remain null despite one-sided data', () => {
  const report = auditStudyComparisons(fixture());
  assert.equal(report.pairedMeasuredCounts.warmStartMs, 0);
  assert.equal(report.pairedAverageDeltas.warmStartMs, null);
  assert.equal(report.summary.nuni.averageWarmStartMs, 500);
});

test('keeps per-case source hashes, device/date and versions aligned without exposing reviewer text', () => {
  const paired = fixture();
  paired.trials[0].sourceSha256 = 'A'.repeat(64);
  paired.trials[0].results = [
    { ...result('Ahaboard', false), version: 'Ahaboard 2.1' },
    { ...result('nuni'), version: 'nuni 2026.11' },
  ]; // Deliberately reverse product order.
  const second = structuredClone(paired.trials[0]);
  second.caseId = 'pair-2';
  second.sourceSha256 = 'c'.repeat(64);
  second.questionSha256 = 'd'.repeat(64);
  second.environment = { date: '2026-11-18', device: 'Android handset',
    browser: 'Chrome 140', network: 'offline' };
  second.results = [
    { ...result('nuni'), version: 'nuni 2026.12' },
    { ...result('Ahaboard'), version: 'Ahaboard 2.2' },
  ];
  paired.trials.push(second);
  const original = structuredClone(paired);
  const report = auditStudyComparisons(paired);
  assert.deepEqual(report.caseIds, ['pair-1', 'pair-2']);
  assert.deepEqual(report.caseProvenance, [
    { caseId: 'pair-1', sourceSha256: 'a'.repeat(64),
      questionSha256: 'b'.repeat(64),
      environment: { date: '2026-11-17', device: 'same phone',
        browser: 'same browser', network: 'same WiFi' },
      versions: { nuni: 'nuni 2026.11', Ahaboard: 'Ahaboard 2.1' } },
    { caseId: 'pair-2', sourceSha256: 'c'.repeat(64),
      questionSha256: 'd'.repeat(64),
      environment: { date: '2026-11-18', device: 'Android handset',
        browser: 'Chrome 140', network: 'offline' },
      versions: { nuni: 'nuni 2026.12', Ahaboard: 'Ahaboard 2.2' } },
  ]);
  assert.deepEqual(report.pairedVerifiedOutcomes, ['nuniOnly', 'both']);
  assert.deepEqual(paired, original); // Never rewrite the manifest itself.
  assert.equal(JSON.stringify(report).includes('human test operator'), false);
  assert.equal(JSON.stringify(report).includes('model unavailable'), false);
});

test('verifies local course/question bytes without exposing private content or paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nuni-study-fixture-'));
  try {
    const source = Buffer.from('授權課程教材：原文段落', 'utf8');
    const question = Buffer.from('主鍵的用途是什麼？', 'utf8');
    writeFileSync(join(directory, 'lesson.txt'), source);
    writeFileSync(join(directory, 'question.txt'), question);
    const input = fixture();
    const trial = input.trials[0];
    trial.sourceFile = 'lesson.txt';
    trial.questionFile = 'question.txt';
    trial.sourceSha256 = createHash('sha256').update(source).digest('hex');
    trial.questionSha256 = createHash('sha256').update(question).digest('hex');
    const manifestPath = join(directory, 'observations.json');
    writeFileSync(manifestPath, JSON.stringify(input));
    assert.equal(auditStudyComparisons(input).fixtureIntegrityVerified, false);
    const verified = verifyLocalStudyFixtures(input, manifestPath);
    assert.equal(verified.fixtureIntegrityVerified, true);
    assert.equal(verified.caseProvenance[0].sourceSha256, trial.sourceSha256);
    assert.equal(JSON.stringify(verified).includes('lesson.txt'), false);
    assert.equal(JSON.stringify(verified).includes('授權課程教材'), false);
    const script = fileURLToPath(new URL('./compare.mjs', import.meta.url));
    const cli = spawnSync(process.execPath,
      [script, manifestPath, '--verify-fixtures'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).fixtureIntegrityVerified, true);
    const defaultCli = spawnSync(process.execPath, [script, manifestPath], { encoding: 'utf8' });
    assert.equal(defaultCli.status, 0, defaultCli.stderr);
    assert.equal(JSON.parse(defaultCli.stdout).fixtureIntegrityVerified, false);
    const tampered = structuredClone(input);
    writeFileSync(join(directory, 'lesson.txt'), '資料遭到修改');
    assert.throws(() => verifyLocalStudyFixtures(tampered, manifestPath), /SHA-256 mismatch/);
    // Reset the intentionally corrupted lesson before checking the next,
    // independent validation boundary.
    writeFileSync(join(directory, 'lesson.txt'), source);
    const outside = structuredClone(input);
    outside.trials[0].sourceFile = '../outside.txt';
    assert.throws(() => verifyLocalStudyFixtures(outside, manifestPath),
      /inside manifest directory/);
    const missing = structuredClone(input);
    delete missing.trials[0].questionFile;
    assert.throws(() => verifyLocalStudyFixtures(missing, manifestPath),
      /relative file path required/);
    // Never try to hash a directory, FIFO, device or socket as a fixture.
    // Some special files can block a synchronous reader indefinitely.
    mkdirSync(join(directory, 'not-a-file'));
    const special = structuredClone(input);
    special.trials[0].sourceFile = 'not-a-file';
    assert.throws(() => verifyLocalStudyFixtures(special, manifestPath),
      /regular fixture file required/);
    assert.equal(verifyLocalStudyFixtures(input, manifestPath).fixtureIntegrityVerified, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
