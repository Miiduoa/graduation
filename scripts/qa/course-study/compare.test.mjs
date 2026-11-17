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
