'use strict';

const assert = require('node:assert/strict');
const { parsePuGradeDocument } = require('./lib/puGradeDocument');
const run = typeof test === 'function' ? test : require('node:test').test;
const header = '<tr><th>課號</th><th>課程名稱</th><th>學分數</th><th>成績</th></tr>';
const row = (code, name, credits, score = '85') => `<tr><td>${code}</td><td>${name}</td><td>${credits}</td><td>${score}</td></tr>`;
const heading = (term) => `<tr><th colspan="4">${term}</th></tr>`;

for (const [term, expected] of [['115學年上學期', '1151'], ['115學年度下學期', '1152'], ['115學年度暑學期', '1153']]) {
  run(`keeps the current-main semester vocabulary in section headings: ${term}`, () => {
    const result = parsePuGradeDocument(`<table>${header}${heading(term)}${row('0001', '資料庫', '３．５ 學分')}</table>`);
    assert.equal(result.success, true);
    assert.deepEqual(result.grades.map((item) => [item.semester, item.courseCode, item.credits]), [[expected, '0001', 3.5]]);
  });
}

run('retains standalone term transitions, leading zeros, and fractional credits together', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('114學年度第二學期')}${row('001', '程式設計', '０．５學分')}${heading('115學年度第一學期')}${row('002', '資料結構', '3')}</table>`);
  assert.equal(result.success, true);
  assert.deepEqual(result.grades.map((item) => [item.semester, item.courseCode, item.credits]), [['1142', '001', 0.5], ['1151', '002', 3]]);
});

run('an invalid section cannot borrow the preceding verified term', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '保留科目', '3')}${heading('115學年度第四學期')}${row('002', '不可歸入上一學期', '3')}</table>`);
  assert.equal(result.success, true);
  assert.deepEqual(result.grades.map((item) => item.courseCode), ['001']);
  assert.equal(result.coverage.status, 'partial');
});

run('updates column mappings at repeated headers without losing normalized credits', () => {
  const reversed = '<tr><th>成績</th><th>學分</th><th>課程名稱</th><th>課號</th></tr>';
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '原欄位', '3')}${reversed}<tr><td>91</td><td>２學分</td><td>重排欄位</td><td>0002</td></tr></table>`);
  assert.deepEqual(result.grades.map((item) => [item.courseCode, item.credits, item.score]), [['001', 3, 85], ['0002', 2, 91]]);
});

run('keeps a source English continuation only with its immediately preceding term context', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '資料庫', '3')}${row('', 'DATABASE SYSTEMS', '')}</table>`);
  assert.equal(result.grades.length, 1);
  assert.equal(result.grades[0].courseNameEn, 'DATABASE SYSTEMS');
});

run('does not attach an English continuation from an invalid following section', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '資料庫', '3')}${heading('115學年度第四學期')}${row('', 'UNVERIFIED SECTION', '')}</table>`);
  assert.equal(result.grades[0].courseNameEn, '');
  assert.equal(result.coverage.status, 'partial');
});

run('does not attach an unrelated English-only row from a different table', () => {
  const result = parsePuGradeDocument(`<p>115學年度第一學期</p><table>${header}${row('001', '資料庫', '3')}</table><table>${header}${row('', 'UNRELATED TABLE', '')}</table>`);
  assert.equal(result.grades[0].courseNameEn, '');
});

run('respects row-group boundaries for rowspan zero', () => {
  const explicit = '<tr><th>學期別</th><th>課號</th><th>課程名稱</th><th>學分</th><th>成績</th></tr>';
  const result = parsePuGradeDocument(`<table><thead>${explicit}</thead><tbody><tr><td rowspan="0">115上</td><td>001</td><td>第一列</td><td>１學分</td><td>80</td></tr>${row('002', '同群組', '2')}</tbody><tbody><tr><td>115下</td><td>003</td><td>下一群組</td><td>3</td><td>90</td></tr></tbody></table>`);
  assert.equal(result.success, true);
  assert.deepEqual(result.grades.map((item) => [item.semester, item.courseCode]), [['1151', '001'], ['1151', '002'], ['1152', '003']]);
});

run('rejects overflowing credits while preserving the valid source row', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '保留科目', '3')}${row('002', '溢位學分', '9'.repeat(400))}</table>`);
  assert.deepEqual(result.grades.map((item) => item.courseCode), ['001']);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.skippedRows, 1);
});

run('preserves unusual numeric score text instead of serializing Infinity as null', () => {
  const score = '9'.repeat(400);
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '待核對分數', '3', score)}</table>`);
  assert.equal(result.grades[0].score, score);
  assert.equal(JSON.parse(JSON.stringify(result)).grades[0].score, score);
});

run('keeps official summary values separate from course rows', () => {
  const result = parsePuGradeDocument(`<table>${header}${heading('115學年度第一學期')}${row('001', '資料庫', '3')}${row('', '學期平均成績', '', '88.25')}</table>`);
  assert.equal(result.grades.length, 1);
  assert.equal(result.summary['1151'].semesterAverage, '88.25');
});
