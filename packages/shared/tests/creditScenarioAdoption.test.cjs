const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.CREDIT_ADOPTION_BUILD || path.resolve(__dirname, '../../../.credit-adoption-build');
const { emptyCreditPlan } = require(path.join(root, 'creditPlanner.js'));
const { startCreditScenario, changeCreditScenario, compareCreditScenario } = require(path.join(root, 'creditPlanScenarios.js'));
const { prepareCreditScenarioAdoption: prepare, prepareCreditScenarioUndo: undo } = require(path.join(root, 'creditScenarioAdoption.js'));
const sample = () => ({ ...emptyCreditPlan(), recognized: '60', target: '128', extra: '2.5',
  milestones: [{ id: 'english', label: '語言能力', done: false }], courses: [
    { id: 'a', name: '資料庫', credits: 3, term: 1, category: 'required', status: 'registered' },
    { id: 'b', name: '統計學', credits: 2.5, term: 2, category: 'elective', status: 'considering' },
  ] });
function alternative(before) {
  const scenario = changeCreditScenario(changeCreditScenario(startCreditScenario(before), 'a', 3), 'b', null);
  const compared = compareCreditScenario(before, scenario); assert.equal(compared.ok, true); return compared.plan;
}
test('snapshots an exact move/omission with earned credits, targets and requirements preserved', () => {
  const before = sample(), raw = JSON.stringify(before), after = alternative(before);
  const result = prepare(before, after); assert.equal(result.ok, true);
  assert.deepEqual(result.value.moved, [{ id: 'a', name: '資料庫', from: 1, to: 3 }]);
  assert.equal(result.value.removed[0].credits, 2.5);
  assert.equal(result.value.after.recognized, '60'); assert.equal(result.value.after.target, '128');
  assert.deepEqual(result.value.after.milestones, before.milestones);
  assert.equal(JSON.stringify(before), raw);
  before.courses[0].name = 'later mutation'; after.recognized = '0';
  assert.equal(result.value.before.courses[0].name, '資料庫'); assert.equal(result.value.after.recognized, '60');
});
for (const field of ['recognized', 'target', 'extra']) test(`rejects hidden change of ${field}`, () => {
  const b = sample(); assert.equal(prepare(b, { ...alternative(b), [field]: '999' }).ok, false);
});
for (const field of ['name', 'credits', 'category', 'status']) test(`rejects hidden course ${field}`, () => {
  const b = sample(), a = alternative(b);
  a.courses[0][field] = { name: 'wrong', credits: 4, category: 'general', status: 'considering' }[field];
  assert.equal(prepare(b, a).ok, false);
});
test('rejects adding an unrelated course or changing non-credit conditions', () => {
  const b = sample(), a = alternative(b); a.courses.push({ ...b.courses[0], id: 'new' });
  assert.equal(prepare(b, a).ok, false);
  const c = alternative(b); c.milestones[0].done = true; assert.equal(prepare(b, c).ok, false);
});
test('rejects changed category evidence and ambiguous period extension', () => {
  const b = sample(), a = alternative(b); a.categoryGoals.required.target = '88'; assert.equal(prepare(b, a).ok, false);
  assert.equal(prepare(b, { ...alternative(b), terms: 8 }).ok, false);
});
test('rejects invalid and unchanged input', () => {
  const b = sample(); assert.equal(prepare(b, b).ok, false);
  assert.equal(prepare(b, { ...b, target: '-1' }).ok, false);
});
test('undo restores exactly the baseline and refuses any later edit', () => {
  const b = sample(), a = alternative(b), r = prepare(b, a); assert.equal(r.ok, true);
  assert.deepEqual(undo(a, r.value), b);
  assert.equal(undo({ ...a, target: '140' }, r.value), null);
  const c = structuredClone(a); c.milestones[0].done = true;
  assert.equal(undo(c, r.value), null);
});
test('tampered receipt cannot undo unrelated academic values', () => {
  const b = sample(), a = alternative(b), r = prepare(b, a); assert.equal(r.ok, true);
  r.value.before.recognized = '900'; assert.equal(undo(a, r.value), null);
});
test('all-course omission stays explicit and reversible, not a graduation reset', () => {
  const b = sample(), s = startCreditScenario(b);
  s.choices.forEach(c => c.term = null);
  const a = compareCreditScenario(b, s); assert.equal(a.ok, true);
  const r = prepare(b, a.plan); assert.equal(r.ok, true); assert.equal(r.value.removed.length, 2);
  assert.equal(r.value.after.recognized, '60'); assert.deepEqual(undo(a.plan, r.value), b);
});
