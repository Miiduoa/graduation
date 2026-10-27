import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateImports } from './evaluate.mjs';

const course = { title: '資料庫', dayOfWeek: 1, startPeriod: 3, endPeriod: 4, location: '主顧303' };
const gold = (rows = [course], extra = {}) => ({ schemaVersion: 1, datasetType: 'synthetic', cases: [{ id: 'week', kind: 'timetable', rows }], ...extra });
const prediction = (rows = [course], status = 'ok') => ({ schemaVersion: 1, cases: [{ id: 'week', status, rows }] });

test('matches reordered complete records without claiming model accuracy', () => {
  const other = { ...course, title: '統計學' };
  const result = evaluateImports(gold([course, other]), prediction([other, course]));
  assert.equal(result.totals.exactMatches, 2);
  assert.equal(result.totals.exactPrecision, 1);
  assert.equal(result.totals.exactRecall, 1);
  assert.match(result.note, /not model or competitor accuracy/);
});
test('duplicate predictions hurt precision instead of inflating recall', () => {
  const result = evaluateImports(gold(), prediction([course, course]));
  assert.equal(result.totals.exactMatches, 1);
  assert.equal(result.totals.exactPrecision, 0.5);
  assert.equal(result.totals.exactRecall, 1);
  assert.equal(result.totals.unexpectedRows, 1);
});
test('a missed second meeting is not collapsed into the same course name', () => {
  const result = evaluateImports(gold([course, { ...course, dayOfWeek: 3 }]), prediction());
  assert.equal(result.totals.exactRecall, 0.5);
  assert.equal(result.totals.omittedRows, 1);
});
test('reports day and period errors rather than only counting extracted names', () => {
  const result = evaluateImports(gold(), prediction([{ ...course, dayOfWeek: 2, endPeriod: 5 }]));
  assert.equal(result.totals.exactMatches, 0);
  assert.equal(result.totals.changedRows, 1);
  assert.deepEqual(result.cases[0].fieldDifferences, [{ title: '資料庫', fields: ['dayOfWeek', 'endPeriod'] }]);
});
test('ambiguous remaining meetings do not receive an optimistic pairing', () => {
  const result = evaluateImports(gold([course, { ...course, dayOfWeek: 3 }]),
    prediction([{ ...course, dayOfWeek: 2 }, { ...course, dayOfWeek: 4 }]));
  assert.equal(result.totals.exactMatches, 0);
  assert.equal(result.totals.changedRows, 0);
  assert.equal(result.totals.ambiguousExpectedRows, 2);
  assert.equal(result.totals.ambiguousPredictedRows, 2);
});
test('missing or failed cases remain in the denominator', () => {
  for (const actual of [{ schemaVersion: 1, cases: [] }, prediction([], 'failed')]) {
    const result = evaluateImports(gold(), actual);
    assert.equal(result.complete, false);
    assert.deepEqual(result.failedCases, ['week']);
    assert.equal(result.totals.exactRecall, 0);
    assert.equal(result.totals.exactPrecision, null);
  }
});
test('empty truth does not turn missing results into perfect accuracy', () => {
  const result = evaluateImports(gold([]), { schemaVersion: 1, cases: [] });
  assert.equal(result.complete, false);
  assert.equal(result.totals.exactRecall, null);
  assert.equal(result.totals.exactPrecision, null);
});
test('zero credits, decimal credits and absent values stay distinct', () => {
  const data = gold([{ title: '服務學習', credits: 0, grade: '通過' }]);
  data.cases[0].kind = 'grades';
  assert.equal(evaluateImports(data, prediction([{ title: '服務學習', grade: '通過' }])).totals.exactMatches, 0);
  assert.equal(evaluateImports(data, prediction([{ title: '服務學習', credits: 0, grade: '通過' }])).totals.exactMatches, 1);
  data.cases[0].rows[0].credits = 2.5;
  assert.equal(evaluateImports(data, prediction([{ title: '服務學習', credits: 2, grade: '通過' }])).totals.exactMatches, 0);
});
test('normalization permits full-width text but not changed field types', () => {
  const data = gold([{ ...course, location: '主顧３０３' }]);
  assert.equal(evaluateImports(data, prediction()).totals.exactMatches, 1);
  assert.equal(evaluateImports(data, prediction([{ ...course, dayOfWeek: '1' }])).totals.exactMatches, 0);
});
test('all-day end dates are compared, never silently reduced to one day', () => {
  const row = { title: '校慶', date: '2026-11-05', endDate: '2026-11-08', allDay: true };
  const data = gold([row]); data.cases[0].kind = 'events';
  const result = evaluateImports(data, prediction([{ ...row, endDate: '2026-11-06' }]));
  assert.deepEqual(result.cases[0].fieldDifferences[0].fields, ['endDate']);
});
test('rejects duplicate or unexpected cases, invalid rows and partial failures', () => {
  assert.throws(() => evaluateImports(gold(), { schemaVersion: 1, cases: [...prediction().cases, ...prediction().cases] }));
  assert.throws(() => evaluateImports(gold(), { schemaVersion: 1, cases: [{ id: 'unknown', status: 'ok', rows: [] }] }));
  assert.throws(() => evaluateImports(gold(), prediction([course], 'failed')));
  assert.throws(() => evaluateImports(gold(), prediction([{ title: { fake: true } }])));
  assert.throws(() => evaluateImports(gold(), prediction([null])));
  assert.throws(() => evaluateImports(gold([], { datasetType: 'unknown' }), prediction()));
  assert.throws(() => evaluateImports(gold(), prediction([course], '')));
});
