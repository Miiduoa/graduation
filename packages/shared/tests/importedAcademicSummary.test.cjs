/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const {
  summarizeImportedAcademics: summarize,
  parseImportedAcademicIntent: parse,
  formatImportedAcademicSummary: format,
} = require('../src/importedAcademicSummary.ts');
require.extensions['.ts'] = original;

const fetchedAt = '2026-11-07T13:30:00.000Z';
const updatedAt = '2026-11-06T11:00:00.000Z';
const options = { schoolId: 'pu', availability: 'available', fetchedAt, updatedAt };
const record = (id, changes = {}) => ({
  id, kind: 'grades', title: `課程 ${id}`, schoolId: 'pu', academicYear: '115', semester: '1',
  courseCode: `00${id}`, credits: 3, grade: 'A+', batchId: 'synthetic-batch',
  importedAt: '2026-11-05T08:10:00.000Z',
  source: { type: 'file', name: 'synthetic.csv', line: 2, rawText: 'RAW_PRIVATE_SOURCE' },
  ...changes,
});
const read = (records, overrides = {}) => summarize({ ...options, records, ...overrides });

test('保留原始等第、課碼、來源與學期，不把未通過紀錄轉成已取得學分', () => {
  const result = read([
    record('1', { grade: 'F', credits: 3, courseCode: '00123 02' }),
    record('2', { grade: ' 及格 ', credits: 2 }),
    record('3', { grade: '未登錄', credits: 0 }),
    record('4', { kind: 'timetable', grade: undefined, credits: 40 }),
  ]);
  assert.equal(result.status, 'ready');
  assert.equal(result.totalMatching, 3);
  assert.equal(result.listedCredits, 5);
  assert.deepEqual(result.records.map(row => row.grade), ['F', ' 及格 ', '未登錄']);
  assert.equal(result.records[0].courseCode, '00123 02');
  assert.deepEqual(result.records[0].source, { type: 'file', name: 'synthetic.csv', line: 2 });
  assert.equal(result.fetchedAt, fetchedAt);
  assert.equal(result.updatedAt, updatedAt);
  assert.equal(result.source, 'personal-import');
  assert.equal(result.official, false);
  for (const key of ['gpa', 'earnedCredits', 'passedCredits', 'graduationEligible']) {
    assert.equal(key in result, false);
    assert.equal(result.records.some(row => key in row), false);
  }
  assert.match(format(result), /不代表已取得、通過或校方認列/);
});

test('缺少成績與學分有獨立計數，零學分保持已填值', () => {
  const result = read([
    record('1', { grade: undefined, credits: undefined }),
    record('2', { grade: ' ', credits: 0 }),
    record('3', { grade: '未登錄', credits: undefined }),
  ]);
  assert.equal(result.missingGrade, 2);
  assert.equal(result.missingCredits, 2);
  assert.equal(result.listedCredits, 0);
  assert.equal(result.records[0].grade, undefined);
  assert.equal(result.records[0].credits, undefined);
  assert.equal(result.records[1].includedInListedCredits, true);
  assert.equal(read([record('1', { credits: undefined })]).listedCredits, null);
  assert.match(format(result), /未把缺值當成 0/);
});

test('空清單、來源不可用與損壞資料保持不同狀態', () => {
  assert.equal(read([]).status, 'empty');
  assert.equal(read(null, { availability: 'unavailable' }).status, 'unavailable');
  assert.equal(read(null).status, 'invalid');
  assert.equal(read(undefined).status, 'invalid');
  const unavailable = read([record('private')], { availability: 'unavailable' });
  assert.deepEqual(unavailable.records, []);
  assert.equal(unavailable.listedCredits, null);
  assert.equal(JSON.stringify(unavailable).includes('課程 private'), false);
  assert.match(format(unavailable), /不表示你沒有/);
  assert.match(format(read([])), /空清單不代表校方沒有/);
});

test('任何他校資料使整批拒絕，不先吐出已讀到的本人校園紀錄', () => {
  for (const kind of ['grades', 'timetable', 'events']) {
    const result = read([record('ours'), record('foreign', { schoolId: 'ntu', kind })]);
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'school-mismatch');
    assert.deepEqual(result.records, []);
    assert.equal(result.totalMatching, 0);
    assert.equal(result.listedCredits, null);
    assert.equal(JSON.stringify(result).includes('foreign'), false);
  }
});

test('原始擷取文字、連結權限與其他額外欄位不進入結果', () => {
  const result = read([record('1', {
    linkedCourseId: 'PRIVATE_CLASS_ID', ownerUid: 'OTHER_ACCOUNT_TOKEN',
    source: { type: 'paste', line: 1, rawText: 'RAW_PRIVATE_SOURCE', session: 'SECRET_SESSION' },
    hidden: { token: 'PRIVATE_SECRET' },
  })]);
  assert.equal(result.status, 'ready');
  const serialized = JSON.stringify(result);
  for (const secret of ['rawText', 'PRIVATE_CLASS_ID', 'OTHER_ACCOUNT_TOKEN', 'RAW_PRIVATE_SOURCE', 'SECRET_SESSION', 'PRIVATE_SECRET'])
    assert.equal(serialized.includes(secret), false);
});

test('分頁前先算完整篩選結果，尾頁之外不誤稱整份成績為空', () => {
  const records = Array.from({ length: 28 }, (_, index) => record(String(index)));
  const first = read(records, { limit: 25 });
  assert.equal(first.totalMatching, 28);
  assert.equal(first.records.length, 25);
  assert.equal(first.listedCredits, 84);
  assert.equal(first.nextOffset, 25);
  const second = read(records, { offset: first.nextOffset, limit: 25 });
  assert.deepEqual(second.records.map(row => row.id), ['25', '26', '27']);
  assert.equal(second.totalMatching, 28);
  assert.equal(second.nextOffset, null);
  const beyond = read(records, { offset: 100 });
  assert.equal(beyond.status, 'ready');
  assert.equal(beyond.records.length, 0);
  assert.match(format(beyond), /這一頁沒有其他紀錄/);
});

test('學年度精確篩選與明示上下學期別名不改寫來源學期', () => {
  const rows = [
    record('1', { academicYear: '114', semester: '1' }),
    record('2', { semester: '上學期' }),
    record('3', { semester: '第二學期' }),
    record('4', { academicYear: '2026', semester: '1' }),
  ];
  const result = read(rows, { academicYear: '115', semester: '1' });
  assert.deepEqual(result.records.map(row => row.id), ['2']);
  assert.equal(result.records[0].semester, '上學期');
  assert.equal(result.terms[0].semester, '上學期');
  assert.deepEqual(read(rows, { semester: '2' }).records.map(row => row.id), ['3']);
  assert.equal(read(rows, { academicYear: '113' }).status, 'empty');
});

test('相同課碼與內容依現有匯入識別合併，保留多來源證據且不重複加總', () => {
  const first = record('1', { title: '資料庫', courseCode: '00012 A', teacher: '王老師', className: 'B' });
  const second = record('2', {
    title: '資料庫', courseCode: '00012  A', teacher: '王老師', className: 'B',
    importedAt: updatedAt, source: { type: 'screenshot', name: 'second.png', line: 3, rawText: 'OTHER_RAW' },
  });
  const result = read([first, second]);
  assert.equal(result.totalMatching, 1);
  assert.equal(result.sourceRecordCount, 2);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.ambiguousGroups, 0);
  assert.equal(result.listedCredits, 3);
  assert.equal(result.records[0].duplicateCount, 2);
  assert.deepEqual(result.records[0].sources.map(item => item.source.type), ['file', 'screenshot']);
  assert.equal(result.records[0].sources[1].importedAt, updatedAt);
  assert.match(format(result), /1 筆完全相同/);
});

for (const change of [{ grade: '85' }, { credits: 2 }, { teacher: '不同老師' }, { className: '另一班' }, { title: '新課名' }]) {
  test(`相同課碼內容有差異須核對，不任選其中一筆：${JSON.stringify(change)}`, () => {
    const base = record('1', { courseCode: '00123', title: '資料庫' });
    const conflict = { ...base, id: '2', ...change };
    const result = read([base, conflict, record('3', { credits: 1 })]);
    assert.equal(result.totalMatching, 3);
    assert.equal(result.duplicateRows, 0);
    assert.equal(result.ambiguousGroups, 1);
    assert.equal(result.ambiguousRecords, 2);
    assert.equal(result.listedCredits, 1);
    assert.deepEqual(result.records.map(row => row.includedInListedCredits), [false, false, true]);
    assert.equal(result.terms[0].ambiguousGroups, 1);
  });
}

test('缺課碼同名、含一筆缺課碼的不同課碼群組都不悄悄重複計算', () => {
  const rows = [record('1', { title: '統計學', courseCode: 'ST01' }),
    record('2', { title: '統計學', courseCode: undefined }),
    record('3', { title: '統計學', courseCode: 'ST02' })];
  const result = read(rows);
  assert.equal(result.ambiguousGroups, 1);
  assert.equal(result.ambiguousRecords, 3);
  assert.equal(result.listedCredits, null);
  assert.equal(read(rows.slice(0, 2).map(row => ({ ...row, courseCode: undefined }))).ambiguousGroups, 1);
  assert.equal(read([rows[0], rows[2]]).listedCredits, 6);
});

test('不同學期重修維持兩筆紀錄，不推導採計或用高分覆蓋', () => {
  const rows = [record('1', { title: '資料庫', courseCode: '00123', grade: 'F', semester: '1' }),
    record('2', { title: '資料庫', courseCode: '00123', grade: 'A', semester: '2' })];
  const result = read(rows);
  assert.equal(result.totalMatching, 2);
  assert.equal(result.ambiguousGroups, 0);
  assert.equal(result.listedCredits, 6);
  assert.deepEqual(result.terms.map(term => term.semester), ['2', '1']);
  assert.match(result.limitations.join(' '), /重修、抵免與採計/);
});

test('85 與 85.0 是不同原文，不逕行改寫後當成相同成績', () => {
  const result = read([record('1', { title: '資料庫', courseCode: '00123', grade: '85' }),
    record('2', { title: '資料庫', courseCode: '00123', grade: '85.0' })]);
  assert.deepEqual(result.records.map(row => row.grade), ['85', '85.0']);
  assert.equal(result.ambiguousGroups, 1);
  assert.equal(result.listedCredits, null);
});

test('小數學分保留原值，加總不暴露浮點累加誤差', () => {
  const result = read([record('1', { credits: 0.1 }), record('2', { credits: 0.2 })]);
  assert.equal(result.listedCredits, 0.3);
  assert.deepEqual(result.records.map(row => row.credits), [0.1, 0.2]);
});

test('上限內的完整輸入有分頁與學期摘要限制，超過上限整批拒絕', () => {
  const rows = Array.from({ length: 2_000 }, (_, index) => record(String(index), { semester: `期別${index}` }));
  const result = read(rows, { limit: 25 });
  assert.equal(result.status, 'ready');
  assert.equal(result.totalMatching, 2_000);
  assert.equal(result.records.length, 25);
  assert.equal(result.terms.length, 40);
  assert.equal(result.totalTerms, 2_000);
  assert.equal(result.termsTruncated, true);
  const capped = read([...rows, record('overflow')], { limit: 1 });
  assert.equal(capped.status, 'invalid');
  assert.equal(capped.reason, 'too-many-records');
  assert.deepEqual(capped.records, []);
});

test('同課大量重複的來源證據有上限與明示省略數量', () => {
  const rows = Array.from({ length: 12 }, (_, index) => record(String(index), { title: '資料庫', courseCode: '00123' }));
  const result = read(rows);
  assert.equal(result.duplicateRows, 11);
  assert.equal(result.listedCredits, 3);
  assert.equal(result.records[0].sources.length, 5);
  assert.equal(result.records[0].omittedSources, 7);
});

for (const change of [
  { credits: -1 }, { credits: 41 }, { credits: Infinity }, { credits: NaN }, { credits: '3' }, { credits: null },
  { grade: '101' }, { grade: '-1' }, { grade: 85 }, { grade: 'x'.repeat(41) },
  { title: '' }, { title: 'x'.repeat(201) }, { academicYear: '今年' }, { semester: '' },
  { semester: 'x'.repeat(31) }, { courseCode: 'x'.repeat(301) },
  { importedAt: '2026-02-30T00:00:00Z' }, { importedAt: '2026-11-01' }, { batchId: '' },
  { source: { type: 'url', line: 1, rawText: '' } },
  { source: { type: 'paste', line: 0, rawText: '' } },
  { source: { type: 'file', line: 1, rawText: 'x'.repeat(200_001) } },
]) {
  test(`拒絕損壞成績且不保留部分結果：${Object.keys(change)[0]} ${String(Object.values(change)[0]).slice(0, 40)}`, () => {
    const result = read([record('valid'), record('bad', change)]);
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.records, []);
    assert.equal(result.listedCredits, null);
  });
}

for (const changes of [
  { schoolId: '' }, { schoolId: ' pu' }, { schoolId: 'pu\n' },
  { academicYear: '115 OR 1=1' }, { academicYear: 115 }, { semester: '' }, { semester: '1\n' },
  { offset: -1 }, { offset: 0.5 }, { offset: 2_001 }, { offset: NaN },
  { limit: 0 }, { limit: 26 }, { limit: Infinity }, { limit: '10' },
  { fetchedAt: 'yesterday' }, { fetchedAt: '2026-11-07T13:30:00' },
  { updatedAt: '2026-02-30T10:00:00Z' }, { availability: 'loading' },
]) {
  test(`拒絕無效範圍或查詢：${Object.keys(changes)[0]} ${String(Object.values(changes)[0])}`, () => {
    const result = read([record('private')], changes);
    assert.equal(result.status, 'invalid');
    assert.deepEqual(result.records, []);
  });
}

test('不執行儲存內容的 getter、toString，也不接受稀疏陣列與重複識別碼', () => {
  let invoked = 0;
  const getter = record('1');
  Object.defineProperty(getter, 'grade', { get() { invoked++; return 'A'; } });
  assert.equal(read([getter]).status, 'invalid');
  const convert = { toString() { invoked++; return 'grades'; } };
  assert.equal(read([record('1', { kind: convert })]).status, 'invalid');
  assert.equal(read([record('1', { source: { type: convert, line: 1, rawText: '' } })]).status, 'invalid');
  const sparse = Array(2); sparse[1] = record('1');
  assert.equal(read(sparse).status, 'invalid');
  const arrayGetter = [];
  Object.defineProperty(arrayGetter, '0', { get() { invoked++; return record('1'); } });
  assert.equal(read(arrayGetter).status, 'invalid');
  assert.equal(read([record('same'), record('same')]).reason, 'duplicate-id');
  assert.equal(invoked, 0);
});

test('不修改來源且輸出物件與原始來源沒有共用可變參照', () => {
  const rows = [record('1')];
  Object.freeze(rows[0].source); Object.freeze(rows[0]); Object.freeze(rows);
  const before = JSON.stringify(rows);
  const result = read(rows);
  result.records[0].source.name = 'changed';
  result.records[0].sources[0].source.name = 'also changed';
  result.records[0].title = 'changed';
  assert.equal(JSON.stringify(rows), before);
});

const intents = [
  ['我匯入的成績', 'grades'],
  ['查看我的成績', 'grades'],
  ['查看我的匯入成績', 'grades'],
  ['查我的匯入成績', 'grades'],
  ['請幫我查成績', 'grades'],
  ['我的學分紀錄', 'credits'],
  ['顯示我儲存的學分紀錄', 'credits'],
  ['請看一下我的成績紀錄有哪些？', 'grades'],
  ['查看我的115學年度第一學期的成績', 'grades', '115', '1'],
  ['我115學年度上學期匯入的成績', 'grades', '115', '1'],
  ['我匯入的成績 115-2', 'grades', '115', '2'],
  ['查看我的１１５學年度下學期成績', 'grades', '115', '2'],
  ['查看我2026學年度的學分紀錄', 'credits', '2026'],
];
for (const [message, view, academicYear, semester] of intents) {
  test(`明確個人成績／學分紀錄查詢：${message}`, () => {
    assert.deepEqual(parse(message), {
      kind: 'imported-academics', view,
      ...(academicYear ? { academicYear } : {}), ...(semester ? { semester } : {}),
    });
  });
}

for (const message of [
  '', '成績', '學分', '我的學分', '我的GPA是多少', '我的平均成績', '我已取得幾學分',
  '我能畢業了嗎', '我的成績能不能畢業', '查老師的成績', '查看我同學的成績',
  '查看我的正式成績', '查看我的校方成績', '查看我的上學期成績', '我的今年成績',
  '查看我的115學年度第1學期與114學年度第2學期成績',
  '查看我的成績然後寄給老師', '不要查看我的成績', '刪除我匯入的成績',
  '查看我的成績中的資料庫幾分', '請幫我改成績', '查看我的115學年度第3學期成績',
  '查看我的成績' + ' '.repeat(501),
]) {
  test(`計算、他人、複合指令或相對學期交回既有引擎：${message.slice(0, 50)}`, () => {
    assert.equal(parse(message), null);
  });
}

test('文字區分查閱與來源更新時間；缺少更新時間不從匯入時間猜測', () => {
  const text = format(read([record('1')]));
  assert.match(text, /個人匯入紀錄/);
  assert.match(text, /查閱時間：2026-11-07 21:30:00（台灣時間）/);
  assert.match(text, /紀錄更新時間：2026-11-06 19:00:00（台灣時間）/);
  const missing = format(read([record('1')], { updatedAt: undefined }));
  assert.match(missing, /來源未提供紀錄更新時間/);
  assert.equal(missing.includes('2026-11-05'), false);
  assert.equal(text.includes('RAW_PRIVATE_SOURCE'), false);
});
