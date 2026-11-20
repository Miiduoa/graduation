'use strict';

const assert = require('node:assert/strict');
const { classifyGrade, buildDerivedCreditSummary } = require('./puCreditSummary');

function summarize(scores) {
  return buildDerivedCreditSummary({
    success: true,
    grades: scores.map(score => ({ semester: '1151', courseType: '必修', credits: 3, score }))
  }).creditSummary;
}

const invalidScores = [
  ['科學記號字串', '1e2'],
  ['十六進位字串', '0x50'],
  ['二進位字串', '0b1010000'],
  ['true', true],
  ['false', false],
  ['數字陣列', [80]],
  ['通過文字陣列', ['Pass']],
  ['一般物件', {}],
  ['沒有原型的物件', Object.create(null)],
  ['null', null],
  ['undefined', undefined],
  ['空字串', ''],
  ['空白字串', ' \t '],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['負 Infinity', -Infinity],
  ['負數', -1],
  ['負數字串', '-1'],
  ['超出有限數值範圍的十進位字串', '9'.repeat(400)]
];

for (const [label, score] of invalidScores) {
  test(`${label} 保持未知，不加入通過學分或平均`, () => {
    assert.equal(classifyGrade(score), 'unknown');
    const summary = summarize([score]);
    assert.equal(summary.totalEarned, 0);
    assert.equal(summary.categories[0].unknownCourses, 1);
    assert.equal(summary.categories[0].passedCourses, 0);
    assert.equal(summary.categories[0].failedCourses, 0);
    assert.equal(summary.semesters[0].weightedScore, 0);
    assert.equal(summary.semesters[0].weightedCredits, 0);
    assert.equal(summary.semesters[0].average, null);
  });
}

const numericScores = [
  ['數字零', 0, 0, 'failed'],
  ['字串零', '0', 0, 'failed'],
  ['未通過的小數', 59.5, 59.5, 'failed'],
  ['及格邊界', '60', 60, 'passed'],
  ['含前後空白的小數', ' 85.5 ', 85.5, 'passed'],
  ['整數', 100, 100, 'passed'],
  ['含前置零的十進位', '080.00', 80, 'passed']
];

for (const [label, score, expectedAverage, expectedStatus] of numericScores) {
  test(`${label} 在通過判定與平均使用相同數值`, () => {
    assert.equal(classifyGrade(score), expectedStatus);
    const summary = summarize([score]);
    assert.equal(summary.totalEarned, expectedStatus === 'passed' ? 3 : 0);
    assert.equal(summary.semesters[0].weightedCredits, 3);
    assert.equal(summary.semesters[0].average, expectedAverage);
  });
}

for (const [score, status] of [
  ['Pass', 'passed'], ['通過', 'passed'], ['通過(Pass)', 'passed'],
  ['Fail', 'failed'], ['未通過', 'failed'], ['不及格', 'failed']
]) {
  test(`${score} 保留文字成績語意，不虛構數值平均`, () => {
    assert.equal(classifyGrade(score), status);
    const summary = summarize([score]);
    assert.equal(summary.totalEarned, status === 'passed' ? 3 : 0);
    assert.equal(summary.semesters[0].average, null);
  });
}

test('異常成績不稀釋同學期有效成績的平均', () => {
  const summary = summarize([80, false, '1e2', [100], null, '待公告', 'Pass']);
  assert.equal(summary.totalCourses, 7);
  assert.equal(summary.totalEarned, 6);
  assert.equal(summary.categories[0].unknownCourses, 5);
  assert.equal(summary.semesters[0].weightedCredits, 3);
  assert.equal(summary.semesters[0].average, 80);
});

test('保留零分、小數學分與既有加權方式', () => {
  const summary = buildDerivedCreditSummary({ success: true, grades: [
    { semester: '1151', credits: 1.5, score: '80.5' },
    { semester: '1151', credits: 0.5, score: '0' },
    { semester: '1151', credits: 0, score: 100 }
  ] }).creditSummary;
  assert.equal(summary.totalEarned, 1.5);
  assert.equal(summary.semesters[0].weightedCredits, 2);
  assert.equal(summary.semesters[0].average, 60.38);
});

test('來源錯誤與缺少成績仍回報無法建立摘要', () => {
  assert.deepEqual(buildDerivedCreditSummary({ success: false, error: 'Session expired' }), {
    success: false, creditSummary: null, error: 'Session expired'
  });
  assert.equal(buildDerivedCreditSummary({ success: true, grades: [] }).success, false);
});

test('保留原有成績摘要結果與非正式畢業審核標示', () => {
  const summary = buildDerivedCreditSummary({
    success: true,
    allSemesters: ['1151'],
    summary: { '1151': { ranking: 'synthetic-fixture' } },
    grades: [
      { semester: '1151', courseType: '必修', credits: 3, score: 85 },
      { semester: '1151', courseType: '必修', credits: 2, score: 59 },
      { semester: '1151', courseType: '選修', credits: 2, score: 'Pass' },
      { semester: '1151', courseType: '選修', credits: 1, score: '待公告' }
    ]
  }).creditSummary;
  assert.equal(summary.totalEarned, 5);
  assert.equal(summary.semesters[0].average, 74.6);
  assert.equal(summary.source, 'derived-from-grade-rows');
  assert.equal(summary.officialAudit, false);
  assert.equal(summary.totalRequired, null);
  assert.deepEqual(summary.allSemesters, ['1151']);
  assert.deepEqual(summary.semesters[0].ranking, { ranking: 'synthetic-fixture' });
});
