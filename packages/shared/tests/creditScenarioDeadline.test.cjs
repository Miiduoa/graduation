const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../../artifacts/credit-deadline-core');
const { compareCreditScenarioDeadline: compare, creditDeadlineConclusion } = require(path.join(dir, 'creditScenarioDeadline.js'));
const { emptyCreditPlan } = require(path.join(dir, 'creditPlanner.js'));
function sample() {
  return { ...emptyCreditPlan(), recognized: '112', target: '128', terms: 3,
    categoryGoals: { ...emptyCreditPlan().categoryGoals, required: { recognized: '50', target: '62' } },
    courses: [
      { id: 'db', name: '資料庫', credits: 6, term: 1, category: 'required', status: 'registered' },
      { id: 'stat', name: '統計學', credits: 6, term: 2, category: 'required', status: 'considering' },
      { id: 'art', name: '藝術', credits: 4, term: 3, category: 'general', status: 'considering' },
    ], milestones: [{ id: 'english', label: '英文門檻', done: false }] };
}
const copy = (plan) => structuredClone(plan);
const moved = (plan) => { const after = copy(plan); after.courses[1].term = 3; return after; };
const options = { targetTerm: 2, workloadLimit: 25 };
function report(before, after = before, prefs = options) { const result = compare(before, after, prefs); assert.equal(result.ok, true, result.message); return result.report; }

test('延期不改總學分，但期限缺口由4變10，必修缺口由0變6', () => {
  const before = sample(), after = moved(before), result = report(before, after);
  assert.equal(result.before.remaining, 4); assert.equal(result.after.remaining, 10);
  assert.equal(result.remainingDelta, 6); assert.equal(result.after.remainingAfterAll, 0);
  assert.equal(result.categories[0].before, 0); assert.equal(result.categories[0].after, 6);
  assert.match(creditDeadlineConclusion(result), /全部修完總量足夠.*仍差 10/);
  assert.deepEqual(result.laterCourses.map((course) => course.id), ['stat', 'art']);
});
test('額外學分不擅自排入期限', () => {
  const before = { ...sample(), extra: '20' }; const result = report(before, moved(before));
  assert.equal(result.after.remaining, 10); assert.equal(result.after.remainingAfterAll, 0);
  assert.equal(result.unallocated, 20); assert.match(result.warnings.join(' '), /不計入這個期限/);
  assert.match(creditDeadlineConclusion(result), /含尚未排入學期的其他預計學分後.*可達標.*仍差 10/);
  assert.doesNotMatch(creditDeadlineConclusion(result), /全部修完總量足夠/);
});
test('沒有課程、只靠未排程 extra 湊總量時不宣稱全部修完足夠', () => {
  const before = { ...sample(), recognized: '120', target: '128', extra: '8', courses: [] };
  const result = report(before);
  assert.equal(result.after.remaining, 8); assert.equal(result.after.remainingAfterAll, 0);
  assert.equal(result.unallocated, 8); assert.equal(result.after.scheduled, 0);
  assert.match(creditDeadlineConclusion(result), /含尚未排入學期的其他預計學分後.*可達標.*仍差 8/);
  assert.doesNotMatch(creditDeadlineConclusion(result), /全部修完總量足夠/);
});
test('到第3學期末才包含延期課程', () => {
  const before = sample(); const result = report(before, moved(before), { ...options, targetTerm: 3 });
  assert.equal(result.after.remaining, 0); assert.equal(result.laterCourses.length, 0);
  assert.match(creditDeadlineConclusion(result), /仍須核對/);
});
test('排在截止學期的課程包含在內', () => {
  const result = report(sample()); assert.equal(result.before.scheduled, 12); assert.equal(result.terms.length, 2);
});
test('只修已選課仍是假設通過，不提升已取得', () => {
  const before = sample(), after = { ...copy(before), courses: before.courses.filter((c) => c.status === 'registered') };
  const result = report(before, after); assert.equal(result.after.cumulative, 118); assert.equal(before.recognized, '112');
});
test('缺少總目標不假設為0', () => {
  const before = { ...sample(), target: '' }; const result = report(before);
  assert.equal(result.after.remaining, null); assert.equal(result.remainingDelta, null);
  assert.equal(result.capacityShortfall, null); assert.match(creditDeadlineConclusion(result), /不能判斷/);
});
test('缺少已確認學分時保留未知累計', () => {
  const before = { ...sample(), recognized: '' }; const result = report(before);
  assert.equal(result.after.cumulative, null); assert.equal(result.after.remaining, null);
});
test('明確的零與未填分類保持不同', () => {
  const before = sample(); before.categoryGoals.general = { recognized: '0', target: '0' };
  const result = report(before); assert.equal(result.categories.find((c) => c.key === 'general').after, 0);
  assert.equal(result.categories.find((c) => c.key === 'other').after, null);
  assert.equal(result.unknownCategories, 2); assert.equal(result.pendingMilestones, 1);
});
test('小數採百分之一整數計算，沒有0.30000000000004', () => {
  const before = sample(); before.recognized = '0.1'; before.target = '0.3';
  before.courses = [{ ...before.courses[0], credits: 0.2 }];
  const result = report(before); assert.equal(result.after.cumulative, 0.3); assert.equal(result.after.remaining, 0);
});
test('個人負擔超額與餘量不互相抵銷', () => {
  const before = sample(), result = report(before, moved(before), { ...options, workloadLimit: 5 });
  assert.equal(result.terms[0].overBy, 1); assert.equal(result.terms[0].room, 0);
  assert.equal(result.terms[1].room, 5); assert.equal(result.after.roomWithinLimit, 5);
  assert.equal(result.capacityShortfall, 5);
});
test('不修改來源且回傳資料不與來源共用課程物件', () => {
  const before = sample(), after = moved(before), snapshot = JSON.stringify({ before, after });
  const result = report(before, after); result.laterCourses[0].name = 'changed';
  assert.equal(JSON.stringify({ before, after }), snapshot);
});
test('來源保守疑義仍顯示，沒有假稱重修已被認列', () => {
  const before = sample(); before.courses[1].name = '資料庫'; before.categoryGoals.required.recognized = '120';
  const result = report(before); assert.match(result.warnings.join(' '), /同名課程/); assert.match(result.warnings.join(' '), /分類已確認學分/);
});
test('空課程也顯示期限缺口，無資料不代表已達標', () => {
  const before = { ...sample(), courses: [] }; const result = report(before);
  assert.equal(result.after.remaining, 16); assert.equal(result.after.scheduled, 0);
});
for (const term of [0, 9, -1, 1.5, NaN]) test(`拒絕無效期限 ${term}`, () => assert.equal(compare(sample(), sample(), { ...options, targetTerm: term }).ok, false));
for (const limit of [0, -1, 40.01, Infinity, NaN, 2.555]) test(`拒絕無效負擔 ${limit}`, () => assert.equal(compare(sample(), sample(), { ...options, workloadLimit: limit }).ok, false));
for (const field of ['recognized', 'target', 'extra']) test(`不以不同${field}當作單純修課比較`, () => {
  const before = sample(), after = copy(before); after[field] = '123'; assert.equal(compare(before, after, options).ok, false);
});
test('分類門檻、檢核狀態或課程內容改變必須重新比較', () => {
  const before = sample();
  for (const mutate of [p => { p.categoryGoals.required.target = '63'; }, p => { p.milestones[0].done = true; },
    p => { p.courses[0].credits = 5; }, p => { p.courses[0].status = 'considering'; }, p => { p.courses[0].id = 'new'; }]) {
    const after = copy(before); mutate(after); assert.equal(compare(before, after, options).ok, false);
  }
});
test('無效原規劃與循環資料不拋出未處理例外', () => {
  const before = sample(); before.cycle = before;
  assert.equal(compare(before, sample(), options).ok, false);
  assert.equal(compare({ ...sample(), recognized: 'wrong' }, sample(), options).ok, false);
});
test('1000組固定種子驗證期限單調性與來源不變性', () => {
  let seed = 70829; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let iteration = 0; iteration < 1000; iteration++) {
    const before = { ...emptyCreditPlan(), recognized: String(Math.floor(random() * 100)), target: '128' };
    before.courses = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `課程${i}`, credits: (1 + Math.floor(random() * 600)) / 100, term: 1 + Math.floor(random() * 8), category: 'elective', status: 'considering' }));
    const source = JSON.stringify(before); let lastGap = Infinity;
    for (let term = 1; term <= 8; term++) {
      const result = report(before, before, { targetTerm: term, workloadLimit: 25 });
      const expected = Math.max(0, 12800 - Math.round(Number(before.recognized) * 100) - before.courses.filter(c => c.term <= term).reduce((sum, c) => sum + Math.round(c.credits * 100), 0)) / 100;
      assert.equal(result.after.remaining, expected); assert.ok(result.after.remaining <= lastGap); lastGap = result.after.remaining;
    }
    assert.equal(JSON.stringify(before), source);
  }
});
