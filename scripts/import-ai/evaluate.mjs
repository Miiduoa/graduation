import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const fields = {
  timetable: ['title', 'courseCode', 'academicYear', 'semester', 'teacher', 'location', 'dayOfWeek', 'startPeriod', 'endPeriod', 'periodLabel', 'startTime', 'endTime'],
  grades: ['title', 'courseCode', 'academicYear', 'semester', 'credits', 'grade'],
  events: ['title', 'location', 'date', 'endDate', 'startTime', 'endTime', 'allDay'],
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalize = (value) => value === undefined || value === null ? null
  : typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : value;
const ratio = (matches, total) => total ? matches / total : null;

function indexCases(document, name) {
  if (!object(document) || document.schemaVersion !== 1 || !Array.isArray(document.cases) || document.cases.length > 1000)
    throw new Error(`${name}: expected schemaVersion 1 and at most 1000 cases`);
  const result = new Map();
  for (const item of document.cases) {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || result.has(item.id))
      throw new Error(`${name}: case identifiers must be nonempty and unique`);
    result.set(item.id, item);
  }
  return result;
}

function validateRows(rows, kind, name) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error(`${name}: expected at most 1000 rows`);
  for (const row of rows) {
    if (!object(row)) throw new Error(`${name}: rows must be objects`);
    for (const field of fields[kind]) {
      const value = row[field];
      if (value === undefined || value === null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.length > 2000))
        throw new Error(`${name}: invalid field value`);
    }
  }
}

/** Exact multiset matching: duplicates do not inflate recall; order does not matter. */
export function evaluateImports(gold, predictions) {
  const expected = indexCases(gold, 'gold');
  const actual = indexCases(predictions, 'predictions');
  if (!expected.size || !['synthetic', 'real'].includes(gold.datasetType))
    throw new Error('gold: declare datasetType as synthetic or real and provide at least one case');
  for (const id of actual.keys()) if (!expected.has(id)) throw new Error('predictions: unknown case identifier');
  const cases = [];
  for (const [id, fixture] of expected) {
    const kind = fixture.kind;
    if (!Object.hasOwn(fields, kind)) throw new Error('gold: unsupported import kind');
    validateRows(fixture.rows, kind, 'gold');
    if (fixture.rows.some((row) => typeof row.title !== 'string' || !row.title.trim()))
      throw new Error('gold: every expected record needs a title');
    const prediction = actual.get(id);
    if (prediction && !['ok', 'failed'].includes(prediction.status))
      throw new Error('predictions: each case must explicitly declare status ok or failed');
    if (prediction?.status === 'failed' && (!Array.isArray(prediction.rows) || prediction.rows.length))
      throw new Error('predictions: failed cases must provide rows: [], not a partial success');
    const rows = prediction ? prediction.rows : [];
    validateRows(rows, kind, 'predictions');
    const signature = (row) => JSON.stringify(fields[kind].map((field) => normalize(row[field])));
    const pool = new Map();
    rows.forEach((row, index) => {
      const key = signature(row);
      pool.set(key, [...(pool.get(key) ?? []), index]);
    });
    const used = new Set();
    const remainingExpected = [];
    let exactMatches = 0;
    for (const row of fixture.rows) {
      const bucket = pool.get(signature(row));
      if (bucket?.length) { used.add(bucket.shift()); exactMatches++; }
      else remainingExpected.push(row);
    }
    const remainingActual = rows.filter((_, index) => !used.has(index));
    const group = (items) => {
      const groups = new Map();
      for (const row of items) {
        const key = normalize(row.title);
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      return groups;
    };
    const left = group(remainingExpected);
    const right = group(remainingActual);
    const fieldDifferences = [];
    let omittedRows = 0;
    let unexpectedRows = 0;
    let ambiguousExpectedRows = 0;
    let ambiguousPredictedRows = 0;
    for (const title of new Set([...left.keys(), ...right.keys()])) {
      const before = left.get(title) ?? [];
      const after = right.get(title) ?? [];
      if (!after.length) omittedRows += before.length;
      else if (!before.length) unexpectedRows += after.length;
      else if (before.length === 1 && after.length === 1) {
        fieldDifferences.push({ title, fields: fields[kind].filter((field) =>
          normalize(before[0][field]) !== normalize(after[0][field]),
        ) });
      } else {
        // Never choose the most favorable pairing among repeated course names.
        ambiguousExpectedRows += before.length;
        ambiguousPredictedRows += after.length;
      }
    }
    cases.push({ id, kind, status: prediction?.status ?? 'missing',
      expectedRows: fixture.rows.length, predictedRows: rows.length, exactMatches,
      exactPrecision: ratio(exactMatches, rows.length), exactRecall: ratio(exactMatches, fixture.rows.length),
      changedRows: fieldDifferences.length, omittedRows, unexpectedRows,
      ambiguousExpectedRows, ambiguousPredictedRows, fieldDifferences,
    });
  }
  const totals = Object.fromEntries(['expectedRows', 'predictedRows', 'exactMatches', 'changedRows',
    'omittedRows', 'unexpectedRows', 'ambiguousExpectedRows', 'ambiguousPredictedRows']
    .map((key) => [key, cases.reduce((sum, item) => sum + item[key], 0)]));
  return { schemaVersion: 1, datasetType: gold.datasetType,
    evaluation: 'exact-record-multiset-v1',
    note: gold.datasetType === 'synthetic'
      ? 'Synthetic fixtures validate the evaluator, not model or competitor accuracy.'
      : 'Scores describe only the supplied labelled cases and recorded predictions.',
    complete: cases.every((item) => item.status === 'ok'),
    failedCases: cases.filter((item) => item.status !== 'ok').map((item) => item.id),
    totals: { ...totals, exactPrecision: ratio(totals.exactMatches, totals.predictedRows),
      exactRecall: ratio(totals.exactMatches, totals.expectedRows) }, cases,
  };
}

function readJson(path) {
  if (statSync(path).size > 10 * 1024 * 1024) throw new Error('Input exceeds 10 MiB');
  return JSON.parse(readFileSync(path, 'utf8'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/import-ai/evaluate.mjs gold.json predictions.json');
    console.log(JSON.stringify(evaluateImports(readJson(process.argv[2]), readJson(process.argv[3])), null, 2));
  } catch (error) {
    console.error(`Import evaluation failed: ${error instanceof Error ? error.message : 'invalid input'}`);
    process.exitCode = 1;
  }
}
