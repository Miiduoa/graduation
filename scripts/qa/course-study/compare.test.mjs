import assert from 'node:assert/strict';
import test from 'node:test';
import { auditStudyComparisons } from './compare.mjs';
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
