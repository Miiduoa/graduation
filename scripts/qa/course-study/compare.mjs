#!/usr/bin/env node
/** Audits paired, human-verified study tasks. Never uploads study material or grades AI. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(where, reason) { throw new Error(`${where}: ${reason}`); }
function object(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, 'object required');
  return value;
}
function text(value, where) {
  if (typeof value !== 'string' || !value.trim()) fail(where, 'nonempty string required');
  return value.trim();
}
function number(value, where, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    fail(where, 'finite nonnegative number required');
  return value;
}
function bool(value, where) {
  if (typeof value !== 'boolean') fail(where, 'boolean required');
  return value;
}
// An ordinary sum can overflow even when every observed value is finite
// (for example, two large valid latency readings). Keep the mean finite.
function mean(list) {
  if (!list.length) return null;
  let average = list[0];
  for (let index = 1; index < list.length; index += 1)
    average += (list[index] - average) / (index + 1);
  return average;
}
// Never emit Infinity in a report: JSON.stringify would silently turn it
// into null and misrepresent a measured amount as missing.
function finiteTotal(list, where) {
  let total = 0;
  for (const value of list) {
    total += value;
    if (!Number.isFinite(total)) fail(where, 'measured total exceeds finite numeric range');
  }
  return total;
}
export function auditStudyComparisons(raw) {
  const input = object(raw, 'manifest');
  if (input.schemaVersion !== 1 || !Array.isArray(input.trials) || !input.trials.length)
    fail('manifest', 'schemaVersion 1 and paired trials required');
  const ids = new Set();
  const observations = { nuni: [], Ahaboard: [] };
  const pairedColdStartDeltasMs = [];
  const pairedWarmStartDeltasMs = [];
  // Pairwise verification is stricter than simple task completion: it requires
  // the human reviewer to mark both correctness and exact-source support.
  // Failures and unverified answers remain in the denominator.
  const pairedVerifiedCounts = { both: 0, nuniOnly: 0, ahaboardOnly: 0, neither: 0 };
  input.trials.forEach((item, index) => {
    const key = `trials[${index}]`;
    const trial = object(item, key);
    const id = text(trial.caseId, `${key}.caseId`);
    if (ids.has(id)) fail(key, 'duplicate caseId');
    ids.add(id);
    for (const digest of ['sourceSha256', 'questionSha256']) {
      if (typeof trial[digest] !== 'string' || !/^[a-f0-9]{64}$/i.test(trial[digest]))
        fail(`${key}.${digest}`, 'SHA-256 fixture digest required');
    }
    if (trial.sourcePermissionConfirmed !== true)
      fail(key, 'permission to use source must be confirmed');
    text(trial.manualReviewer, `${key}.manualReviewer`);
    const env = object(trial.environment, `${key}.environment`);
    for (const field of ['date', 'device', 'browser', 'network'])
      text(env[field], `${key}.environment.${field}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env.date) ||
        (!Number.isFinite(Date.parse(`${env.date}T00:00:00Z`)) ||
         new Date(`${env.date}T00:00:00Z`).toISOString().slice(0, 10) !== env.date))
      fail(key, 'valid ISO date required');
    if (!Array.isArray(trial.results) || trial.results.length !== 2)
      fail(key, 'exactly one nuni and one Ahaboard result required');
    const seen = new Set(), pair = {};
    trial.results.forEach((item, n) => {
      const where = `${key}.results[${n}]`, run = object(item, where);
      if (!Object.hasOwn(observations, run.product) || seen.has(run.product))
        fail(where, 'unknown or repeated product');
      seen.add(run.product);
      text(run.version, `${where}.version`);
      const completed = bool(run.completed, `${where}.completed`);
      const correct = bool(run.correct, `${where}.correct`);
      const sourceVerified = bool(run.sourceVerified, `${where}.sourceVerified`);
      if (!completed && (correct || sourceVerified))
        fail(where, 'failed attempt cannot count as correct/source-verified');
      if (!completed && run.offlineCompleted === true)
        fail(where, 'failed attempt cannot count as offline-completed');
      if (!completed) text(run.failureReason, `${where}.failureReason`);
      const steps = number(run.steps, `${where}.steps`, true);
      if (steps !== null && !Number.isSafeInteger(steps)) fail(where, 'steps must be integer');
      const coldStartMs = number(run.coldStartMs, `${where}.coldStartMs`, true);
      const warmStartMs = number(run.warmStartMs, `${where}.warmStartMs`, true);
      const peakMemoryMiB = number(run.peakMemoryMiB, `${where}.peakMemoryMiB`, true);
      const offlineCompleted = run.offlineCompleted === null ? null :
        bool(run.offlineCompleted, `${where}.offlineCompleted`);
      // An unmeasured actual cost is unknown, not a measured NT$0.
      const costTwd = number(run.costTwd, `${where}.costTwd`, true);
      const measurement = { completed, correct, sourceVerified, steps, coldStartMs,
        warmStartMs, peakMemoryMiB, offlineCompleted, costTwd };
      observations[run.product].push(measurement);
      pair[run.product] = measurement;
    });
    pairedColdStartDeltasMs.push(
      pair.nuni.coldStartMs !== null && pair.Ahaboard.coldStartMs !== null
        ? pair.nuni.coldStartMs - pair.Ahaboard.coldStartMs : null);
    pairedWarmStartDeltasMs.push(
      pair.nuni.warmStartMs !== null && pair.Ahaboard.warmStartMs !== null
        ? pair.nuni.warmStartMs - pair.Ahaboard.warmStartMs : null);
    const nuniVerified = pair.nuni.completed && pair.nuni.correct && pair.nuni.sourceVerified;
    const ahaboardVerified = pair.Ahaboard.completed && pair.Ahaboard.correct && pair.Ahaboard.sourceVerified;
    if (nuniVerified && ahaboardVerified) pairedVerifiedCounts.both += 1;
    else if (nuniVerified) pairedVerifiedCounts.nuniOnly += 1;
    else if (ahaboardVerified) pairedVerifiedCounts.ahaboardOnly += 1;
    else pairedVerifiedCounts.neither += 1;
  });
  const summary = {};
  for (const [product, values] of Object.entries(observations)) {
    const measured = (key) => values.map((v) => v[key]).filter((v) => v !== null);
    summary[product] = {
      trials: values.length,
      completed: values.filter((v) => v.completed).length,
      correct: values.filter((v) => v.correct).length,
      correctAndSourceVerified: values.filter((v) => v.correct && v.sourceVerified).length,
      offlineCompleted: values.filter((v) => v.offlineCompleted === true).length,
      offlineNotMeasured: values.filter((v) => v.offlineCompleted === null).length,
      // Averages exclude unknown measurements; publish denominators so coverage is visible.
      measuredCounts: {
        steps: measured('steps').length,
        coldStartMs: measured('coldStartMs').length,
        warmStartMs: measured('warmStartMs').length,
        peakMemoryMiB: measured('peakMemoryMiB').length,
        offlineCompleted: measured('offlineCompleted').length,
        costTwd: measured('costTwd').length,
      },
      averageSteps: mean(measured('steps')),
      averageColdStartMs: mean(measured('coldStartMs')),
      averageWarmStartMs: mean(measured('warmStartMs')),
      averagePeakMemoryMiB: mean(measured('peakMemoryMiB')),
      // Do not report a "total" if even one trial's cost was not measured.
      totalCostTwd: values.some((v) => v.costTwd === null) ? null :
        finiteTotal(measured('costTwd'), `${product}.totalCostTwd`),
      measuredCostTotalTwd: finiteTotal(measured('costTwd'), `${product}.measuredCostTotalTwd`),
      costNotMeasured: values.filter((v) => v.costTwd === null).length,
    };
  }
  return { trialCount: input.trials.length, summary, pairedColdStartDeltasMs,
    pairedWarmStartDeltasMs, pairedVerifiedCounts,
    sourceOfTruth: 'manually recorded observations, not automatic grading or proof of superiority' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail('usage', 'node compare.mjs <paired-observations.json>');
    process.stdout.write(JSON.stringify(auditStudyComparisons(
      JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
