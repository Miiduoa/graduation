'use strict';

const assert = require('node:assert/strict');
const { parsePuGradeDocument } = require('./lib/puGradeDocument');

const header = '<tr><th>科目</th><th>學分</th><th>成績</th></tr>';
const row = (name, credits = '3', score = '80') => `<tr><td>${name}</td><td>${credits}</td><td>${score}</td></tr>`;
const section = code => `<tr><th colspan="3">學期別(Semester)：${code}</th></tr>`;
const document = body => `<p>學期別(Semester)：114[1]</p><table>${header}${body}</table>`;

// Node assertions also allow this exact suite to run locally with node:test.
test('switches semesters at a full-width heading inside a grade table', () => {
  const result = parsePuGradeDocument(document(row('上學期科目') + section('114[2]') + row('下學期科目')));
  assert.equal(result.success, true);
  assert.deepEqual(result.grades.map(grade => grade.semester), ['1141', '1142']);
  assert.deepEqual(result.allSemesters, ['1141', '1142']);
  assert.equal(result.coverage.skippedRows, 0);
});

test('accepts the first semester heading after the table header', () => {
  const result = parsePuGradeDocument(`<table>${header}${section('114[2]')}${row('資料庫')}</table>`);
  assert.equal(result.success, true);
  assert.equal(result.grades[0].semester, '1142');
});

test('uses the new column order at a repeated table header', () => {
  const result = parsePuGradeDocument(document(row('甲') + section('114[2]') +
    '<tr><th>成績</th><th>科目</th><th>學分</th></tr><tr><td>95</td><td>乙</td><td>0.5</td></tr>'));
  assert.equal(result.grades.length, 2);
  assert.equal(result.grades[1].courseName, '乙');
  assert.equal(result.grades[1].credits, 0.5);
  assert.equal(result.grades[1].score, 95);
  assert.equal(result.grades[1].semester, '1142');
});

for (const label of ['待公告', '114[9]', '114學年度第1學期／114學年度第2學期']) {
  test(`does not inherit the previous semester after an unresolved heading: ${label}`, () => {
    const result = parsePuGradeDocument(document(row('已確認') + section(label) + row('未確認') + section('115[1]') + row('恢復')));
    assert.deepEqual(result.grades.map(grade => grade.courseName), ['已確認', '恢復']);
    assert.deepEqual(result.grades.map(grade => grade.semester), ['1141', '1151']);
    assert.deepEqual(result.coverage, { status: 'partial', skippedRows: 1 });
  });
}

test('does not interpret text inside a normal course row as a semester heading', () => {
  const result = parsePuGradeDocument(document(row('114學年度第2學期專題') + row('資料庫')));
  assert.deepEqual(result.grades.map(grade => grade.semester), ['1141', '1141']);
});

test('keeps explicit row semesters instead of replacing them with a section heading', () => {
  const result = parsePuGradeDocument(`<table><tr><th>學期</th><th>科目</th><th>學分</th><th>成績</th></tr>
    <tr><th colspan="4">學期別(Semester)：114[1]</th></tr>
    <tr><td>1142</td><td>資料庫</td><td>3</td><td>88</td></tr></table>`);
  assert.equal(result.grades[0].semester, '1142');
});

test('does not carry rowspan into the next tbody', () => {
  const result = parsePuGradeDocument(`<table><thead><tr><th>學期</th><th>科目</th><th>學分</th><th>成績</th></tr></thead>
    <tbody><tr><td rowspan="5">1141</td><td>甲</td><td>3</td><td>81</td></tr></tbody>
    <tbody><tr><td>1142</td><td>乙</td><td>2</td><td>82</td></tr></tbody></table>`);
  assert.deepEqual(result.grades.map(grade => [grade.semester, grade.courseName, grade.credits, grade.score]),
    [['1141', '甲', 3, 81], ['1142', '乙', 2, 82]]);
});

test('supports rowspan zero only through the remainder of its own row group', () => {
  const result = parsePuGradeDocument(`<table><thead><tr><th>學期</th><th>科目</th><th>學分</th><th>成績</th></tr></thead>
    <tbody><tr><td rowspan="0">1141</td><td>甲</td><td>3</td><td>81</td></tr>
    <tr><td>乙</td><td>0.5</td><td>Pass</td></tr></tbody>
    <tbody><tr><td>1142</td><td>丙</td><td>2</td><td>82</td></tr></tbody></table>`);
  assert.deepEqual(result.grades.map(grade => [grade.semester, grade.courseName]),
    [['1141', '甲'], ['1141', '乙'], ['1142', '丙']]);
  assert.equal(result.grades[1].credits, 0.5);
});

test('skips a row whose semester column is missing instead of borrowing the prior row group', () => {
  const result = parsePuGradeDocument(`<table><thead><tr><th>學期</th><th>科目</th><th>學分</th><th>成績</th></tr></thead>
    <tbody><tr><td rowspan="9">1141</td><td>甲</td><td>3</td><td>81</td></tr></tbody>
    <tbody><tr><td></td><td>待確認</td><td>2</td><td>82</td></tr></tbody></table>`);
  assert.equal(result.grades.length, 1);
  assert.equal(result.coverage.skippedRows, 1);
});

test('keeps school summaries attached to the correct in-table semester', () => {
  const result = parsePuGradeDocument(document(row('甲') + row('學期平均', '', '81.5') + section('114[2]') +
    row('乙') + row('學期平均', '', '89')));
  assert.equal(result.grades.length, 2);
  assert.deepEqual(result.summary, { '1141': { semesterAverage: '81.5' }, '1142': { semesterAverage: '89' } });
});

test('retains a named semester with no recognized course rows for coverage review', () => {
  const result = parsePuGradeDocument(document(row('甲') + section('114[2]') + row('缺學分', '待確認')));
  assert.deepEqual(result.allSemesters, ['1141', '1142']);
  assert.equal(result.grades.length, 1);
  assert.equal(result.coverage.status, 'partial');
});

test('keeps same-name courses from different semesters while removing exact duplicate rows', () => {
  const result = parsePuGradeDocument(document(row('資料庫') + row('資料庫') + section('114[2]') + row('資料庫')));
  assert.equal(result.grades.length, 2);
  assert.deepEqual(result.grades.map(grade => grade.semester), ['1141', '1142']);
});

for (const label of ['課號', '科目編號', '課程編號']) {
  test(`preserves a source course code headed ${label}, including leading zeroes`, () => {
    const result = parsePuGradeDocument(`<p>114學年度第1學期</p><table><tr><th>${label}</th><th>科目</th><th>學分</th><th>成績</th></tr>
      <tr><td>0012</td><td>資料庫</td><td>3</td><td>88</td></tr></table>`);
    assert.equal(result.grades[0].courseCode, '0012');
  });
}

test('never emits infinite credits that would invalidate the entire browser response', () => {
  const result = parsePuGradeDocument(document(row('甲') + row('無法辨識', '9'.repeat(400))));
  assert.equal(result.grades.length, 1);
  assert.deepEqual(result.coverage, { status: 'partial', skippedRows: 1 });
});

test('retains a numerically overflowing score as source text for review', () => {
  const score = '9'.repeat(400);
  const result = parsePuGradeDocument(document(row('甲', '3', score)));
  assert.equal(result.success, true);
  assert.equal(result.grades[0].score, score);
  assert.equal(typeof result.grades[0].score, 'string');
});

test('retains zero scores, fractional credits and unknown result labels', () => {
  const result = parsePuGradeDocument(document(row('零分', '0.5', '0') + section('114[3]') + row('待核對', '0', 'SAT')));
  assert.deepEqual(result.grades.map(grade => [grade.semester, grade.credits, grade.score]),
    [['1141', 0.5, 0], ['1143', 0, 'SAT']]);
});

test('semester filtering still uses every parsed section and preserves source semester labels', () => {
  const result = parsePuGradeDocument(document(row('甲') + section('114[2]') + row('乙')), '1142');
  assert.deepEqual(result.grades.map(grade => grade.courseName), ['乙']);
  assert.deepEqual(result.allSemesters, ['1141', '1142']);
});

test('does not promote script or hidden form options into semester context', () => {
  const result = parsePuGradeDocument(document(row('甲') +
    '<tr><td colspan="3"><script>學期別(Semester)：115[2]</script><select><option>學期別(Semester)：115[1]</option></select></td></tr>' + row('乙')));
  assert.deepEqual(result.grades.map(grade => grade.semester), ['1141', '1141']);
});

test('an unreadable document remains a failed response', () => {
  assert.equal(parsePuGradeDocument('<html><body>系統維護中</body></html>').success, false);
});


test('an unresolved heading before the column header clears the previous table semester', () => {
  const result = parsePuGradeDocument(document(row('已確認')) +
    `<table>${section('待公告')}${header}${row('不得沿用上學期')}</table>`);
  assert.deepEqual(result.grades.map(grade => grade.courseName), ['已確認']);
  assert.equal(result.coverage.skippedRows, 1);
});

test('an unresolved caption clears the semester inherited from the previous table', () => {
  const result = parsePuGradeDocument(document(row('已確認')) +
    `<table><caption>學期別：待公告</caption>${header}${row('待確認')}</table>`);
  assert.deepEqual(result.grades.map(grade => grade.courseName), ['已確認']);
  assert.equal(result.coverage.skippedRows, 1);
});

test('a row section heading takes precedence over an earlier table caption', () => {
  const result = parsePuGradeDocument(`<table><caption>114學年度第1學期</caption>
    ${section('114[2]')}${header}${row('資料庫')}</table>`);
  assert.equal(result.grades[0].semester, '1142');
});
