#!/usr/bin/env node
/** Audits paired, human-verified study tasks. Never uploads study material or grades AI. */
import { realpathSync, statSync, openSync, readSync, fstatSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
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
// Evidence labels must remain identical to the human-entered manifest.
// Trimming or silently accepting control/bidi formatting characters can
// make two case IDs or recorded device/version names appear identical.
function evidenceLabel(value, where) {
  const label = text(value, where);
  if (label !== value || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value))
    fail(where, 'unambiguous single-line evidence label required');
  return value;
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
// Ordinary sums overflow for large measurements; even an incremental
// (next - average) can overflow when paired deltas have opposite signs.
// A weighted update keeps both intermediate terms within finite range.
function mean(list) {
  if (!list.length) return null;
  let average = list[0];
  for (let index = 1; index < list.length; index += 1) {
    const count = index + 1;
    average = average * (index / count) + list[index] / count;
  }
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
  // Preserve the order of the actual paired fixtures in every reported delta.
  // Without case IDs and per-case outcomes, a low aggregate can conceal which
  // licensed question failed or where a measurement was absent.
  const caseIds = [];
  // Keep the exact fixture and environment metadata beside each reported case,
  // without embedding private teaching material or the human reviewer's name.
  const caseProvenance = [];
  const pairedVerifiedOutcomes = [];
  const pairedOfflineOutcomes = [];
  const observations = { nuni: [], Ahaboard: [] };
  const pairedColdStartDeltasMs = [];
  const pairedWarmStartDeltasMs = [];
  // Differences are meaningful only within the same licensed source, question
  // and device case. Unknown measurements stay null, not zero.
  const pairedStepsDeltas = [];
  const pairedPeakMemoryDeltasMiB = [];
  const pairedCostDeltasTwd = [];
  // An unknown offline result is NOT the same as a measured "did not work offline".
  const pairedOfflineCounts = { both: 0, nuniOnly: 0, ahaboardOnly: 0, neither: 0, unmeasured: 0 };
  // Pairwise verification is stricter than simple task completion: it requires
  // the human reviewer to mark both correctness and exact-source support.
  // Failures and unverified answers remain in the denominator.
  const pairedVerifiedCounts = { both: 0, nuniOnly: 0, ahaboardOnly: 0, neither: 0 };
  input.trials.forEach((item, index) => {
    const key = `trials[${index}]`;
    const trial = object(item, key);
    const id = evidenceLabel(trial.caseId, `${key}.caseId`);
    // Canonically equivalent Unicode case IDs must not count as two trials.
    // Preserve the original label in the report and do not alter fixture bytes.
    const identity = id.normalize('NFC');
    if (ids.has(identity)) fail(key, 'duplicate caseId');
    ids.add(identity);
    caseIds.push(id);
    for (const digest of ['sourceSha256', 'questionSha256']) {
      if (typeof trial[digest] !== 'string' || !/^[a-f0-9]{64}$/i.test(trial[digest]))
        fail(`${key}.${digest}`, 'SHA-256 fixture digest required');
    }
    if (trial.sourcePermissionConfirmed !== true)
      fail(key, 'permission to use source must be confirmed');
    text(trial.manualReviewer, `${key}.manualReviewer`);
    const env = object(trial.environment, `${key}.environment`);
    const environment = Object.fromEntries(['date', 'device', 'browser', 'network']
      .map((field) => [field, evidenceLabel(env[field], `${key}.environment.${field}`)]));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env.date) ||
        (!Number.isFinite(Date.parse(`${env.date}T00:00:00Z`)) ||
         new Date(`${env.date}T00:00:00Z`).toISOString().slice(0, 10) !== env.date))
      fail(key, 'valid ISO date required');
    if (!Array.isArray(trial.results) || trial.results.length !== 2)
      fail(key, 'exactly one nuni and one Ahaboard result required');
    const seen = new Set(), pair = {}, versions = {};
    trial.results.forEach((item, n) => {
      const where = `${key}.results[${n}]`, run = object(item, where);
      if (!Object.hasOwn(observations, run.product) || seen.has(run.product))
        fail(where, 'unknown or repeated product');
      seen.add(run.product);
      versions[run.product] = evidenceLabel(run.version, `${where}.version`);
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
    // Report each pair's provenance in the same order as caseIds and deltas.
    // Digest case differences instead of copying raw source or question text.
    caseProvenance.push({
      caseId: id,
      sourceSha256: trial.sourceSha256.toLowerCase(),
      questionSha256: trial.questionSha256.toLowerCase(),
      environment,
      versions: { nuni: versions.nuni, Ahaboard: versions.Ahaboard },
    });
    pairedColdStartDeltasMs.push(
      pair.nuni.coldStartMs !== null && pair.Ahaboard.coldStartMs !== null
        ? pair.nuni.coldStartMs - pair.Ahaboard.coldStartMs : null);
    pairedWarmStartDeltasMs.push(
      pair.nuni.warmStartMs !== null && pair.Ahaboard.warmStartMs !== null
        ? pair.nuni.warmStartMs - pair.Ahaboard.warmStartMs : null);
    const pairedDifference = (field) =>
      pair.nuni[field] !== null && pair.Ahaboard[field] !== null
        ? pair.nuni[field] - pair.Ahaboard[field] : null;
    pairedStepsDeltas.push(pairedDifference('steps'));
    pairedPeakMemoryDeltasMiB.push(pairedDifference('peakMemoryMiB'));
    pairedCostDeltasTwd.push(pairedDifference('costTwd'));
    const nuniOffline = pair.nuni.offlineCompleted;
    const ahaboardOffline = pair.Ahaboard.offlineCompleted;
    const offlineOutcome = nuniOffline === null || ahaboardOffline === null
      ? 'unmeasured' : nuniOffline && ahaboardOffline
        ? 'both' : nuniOffline ? 'nuniOnly' : ahaboardOffline ? 'ahaboardOnly' : 'neither';
    pairedOfflineOutcomes.push(offlineOutcome);
    pairedOfflineCounts[offlineOutcome] += 1;
    const nuniVerified = pair.nuni.completed && pair.nuni.correct && pair.nuni.sourceVerified;
    const ahaboardVerified = pair.Ahaboard.completed && pair.Ahaboard.correct && pair.Ahaboard.sourceVerified;
    const verifiedOutcome = nuniVerified && ahaboardVerified
      ? 'both' : nuniVerified ? 'nuniOnly' : ahaboardVerified ? 'ahaboardOnly' : 'neither';
    pairedVerifiedOutcomes.push(verifiedOutcome);
    pairedVerifiedCounts[verifiedOutcome] += 1;
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
  // Product-wide averages can use disjoint sets of measurements, so their
  // difference is not a same-case result. Publish paired coverage separately.
  const pairedMetrics = {
    coldStartMs: pairedColdStartDeltasMs,
    warmStartMs: pairedWarmStartDeltasMs,
    steps: pairedStepsDeltas,
    peakMemoryMiB: pairedPeakMemoryDeltasMiB,
    costTwd: pairedCostDeltasTwd,
  };
  const pairedMeasuredCounts = {};
  const pairedAverageDeltas = {};
  for (const [metric, deltas] of Object.entries(pairedMetrics)) {
    const measured = deltas.filter((delta) => delta !== null);
    pairedMeasuredCounts[metric] = measured.length;
    pairedAverageDeltas[metric] = mean(measured);
  }
  return { trialCount: input.trials.length, summary, caseIds, caseProvenance,
    pairedVerifiedOutcomes, pairedOfflineOutcomes, pairedColdStartDeltasMs,
    pairedWarmStartDeltasMs, pairedStepsDeltas, pairedPeakMemoryDeltasMiB,
    pairedCostDeltasTwd, pairedMeasuredCounts, pairedAverageDeltas,
    pairedOfflineCounts, pairedVerifiedCounts,
    fixtureIntegrityVerified: false,
    sourceOfTruth: 'manually recorded observations, not automatic grading or proof of superiority' };
}
// Strict opt-in verification of actual local source/question file bytes.
// Metadata hashes alone are unverified claims, not fixture-integrity evidence.
function fixturePath(root, name, where) {
  if (typeof name !== 'string' || !name.trim() || isAbsolute(name))
    fail(where, 'relative file path required');
  const candidate = resolve(root, name);
  const contained = (path) => {
    const part = relative(root, path);
    return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
  };
  if (!contained(candidate)) fail(where, 'file must remain inside manifest directory');
  let actual;
  try { actual = realpathSync(candidate); }
  catch { fail(where, 'fixture file unavailable'); }
  if (!contained(actual)) fail(where, 'file must remain inside manifest directory');
  // A path can resolve to a FIFO, socket or device. readFileSync on a FIFO
  // may block indefinitely, so never treat non-regular files as fixtures.
  // Keep a clear local error without echoing the learner's private path.
  try {
    if (!statSync(actual).isFile()) fail(where, 'regular fixture file required');
  } catch (error) {
    if (error instanceof Error && error.message.includes('regular fixture file required')) throw error;
    fail(where, 'fixture file unavailable');
  }
  return actual;
}
// Stream large PDFs in bounded memory instead of loading each whole fixture.
// Recheck the opened descriptor (not just a pre-open path) so a file replaced
// by a FIFO or another non-regular object cannot block the synchronous reader.
function hashLocalFixture(file, where) {
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK |
      (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail(where, 'regular fixture file required');
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let remaining = before.size;
    while (remaining > 0n) {
      const length = Number(remaining < BigInt(chunk.length) ? remaining : BigInt(chunk.length));
      const count = readSync(descriptor, chunk, 0, length, null);
      if (count === 0) fail(where, 'fixture file changed while hashing');
      digest.update(chunk.subarray(0, count));
      remaining -= BigInt(count);
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs)
      fail(where, 'fixture file changed while hashing');
    return digest.digest('hex');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${where}: `)) throw error;
    fail(where, 'fixture file unreadable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
export function verifyLocalStudyFixtures(raw, manifestPath) {
  const report = auditStudyComparisons(raw);
  let root;
  try { root = realpathSync(dirname(resolve(manifestPath))); }
  catch { fail('manifest', 'directory unavailable'); }
  raw.trials.forEach((trial, index) => {
    for (const [fileKey, digestKey] of [
      ['sourceFile', 'sourceSha256'], ['questionFile', 'questionSha256'],
    ]) {
      const where = `trials[${index}].${fileKey}`;
      const file = fixturePath(root, trial[fileKey], where);
      const actual = hashLocalFixture(file, where);
      if (actual !== trial[digestKey].toLowerCase())
        fail(where, 'local fixture SHA-256 mismatch');
    }
  });
  return { ...report, fixtureIntegrityVerified: true };
}
// Malformed JSON error messages may include excerpts of private course notes;
 // filesystem errors also embed a student's local directory. Neither belongs in
 // CI logs, CLI output or shared bug reports.
// The local comparison manifest is user-selected input, not necessarily a
// regular JSON file. Never block on FIFOs/devices or exhaust RAM on a huge file.
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
function readLocalManifest(path) {
  let descriptor;
  let content;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK |
      (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) fail('manifest', 'regular JSON file required');
    if (before.size > BigInt(MAX_MANIFEST_BYTES))
      fail('manifest', 'JSON exceeds 16 MiB limit');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      // The extra byte detects a file that grows after its initial size check.
      const count = readSync(descriptor, buffer, 0,
        Math.min(buffer.length, MAX_MANIFEST_BYTES + 1 - total), null);
      if (count === 0) break;
      total += count;
      if (total > MAX_MANIFEST_BYTES) fail('manifest', 'JSON exceeds 16 MiB limit');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (after.size !== before.size || after.size !== BigInt(total) ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
      fail('manifest', 'JSON changed during read');
    // Buffer.toString('utf8') silently replaces malformed bytes with U+FFFD.
    // That would let a corrupted case ID or device label pass as a different
    // observation, breaking reproducible same-question comparisons.
    // Retain the previous BOM behavior (a BOM is not silently discarded).
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(Buffer.concat(chunks, total));
    } catch {
      fail('manifest', 'invalid UTF-8');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('manifest: ')) throw error;
    fail('manifest', 'file unreadable');
  } finally {
    // Closing a read descriptor is best-effort and must not reveal local paths.
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* The file is no longer needed. */ }
    }
  }
  try { return JSON.parse(content); }
  catch { fail('manifest', 'invalid JSON'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 &&
        !(process.argv.length === 4 && process.argv[3] === '--verify-fixtures'))
      fail('usage', 'node compare.mjs <paired-observations.json> [--verify-fixtures]');
    const manifest = readLocalManifest(process.argv[2]);
    const report = process.argv[3] === '--verify-fixtures'
      ? verifyLocalStudyFixtures(manifest, process.argv[2])
      : auditStudyComparisons(manifest);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
