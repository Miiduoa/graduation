import { expect, it } from 'vitest';
import { extractSchoolPageTables, parsePersonalImport, SchoolPageImportError } from '@campus/shared';

const opts = {
  kind: 'timetable' as const,
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  periodProfile: 'pu' as const,
};

function page(rows: string) {
  return '<!doctype html><html><head><script>window.hiddenCredential="never-run";</script></head><body>' +
    '<table><tr><th>導覽</th></tr><tr><td>首頁</td></tr></table>' +
    rows + '</body></html>';
}

it('reads the actual course table while ignoring irrelevant site navigation', () => {
  const html = page('<table><thead><tr><th>課程名稱</th><th>星期</th><th>開始節次</th><th>結束節次</th>' +
    '<th>教師</th><th>教室</th></tr></thead><tbody>' +
    '<tr><td>資料庫</td><td>一</td><td>3</td><td>4</td><td>王老師</td><td>主顧303</td></tr>' +
    '</tbody></table>');
  const found = extractSchoolPageTables(html, 'timetable', 'pu');
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ layout: 'list', rowCount: 1 });
  const parsed = parsePersonalImport(found[0].text, opts);
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]).toMatchObject({
    title: '資料庫', dayOfWeek: 1, startPeriod: 3, endPeriod: 4,
    teacher: '王老師', location: '主顧303', schoolId: 'pu',
  });
  expect(parsed.issues.filter((item) => item.severity === 'error')).toEqual([]);
  expect(found[0].text).not.toContain('hiddenCredential');
  expect(found[0].text).not.toContain('<script');
});

it('expands consecutive rowspan cells into a single course time range', () => {
  const html = page('<table><tr><th>節次</th><th>星期一</th><th>星期二</th></tr>' +
    '<tr><td>第 1 節</td><td rowspan="2">程式設計</td><td>英文</td></tr>' +
    '<tr><td>第 2 節</td><td>微積分</td></tr></table>');
  const candidates = extractSchoolPageTables(html, 'timetable', 'pu');
  expect(candidates).toHaveLength(1);
  expect(candidates[0].layout).toBe('weekly');
  const parsed = parsePersonalImport(candidates[0].text, opts);
  expect(parsed.rows).toHaveLength(3);
  expect(parsed.rows.find((row) => row.title === '程式設計')).toMatchObject({
    dayOfWeek: 1, startPeriod: 1, endPeriod: 2,
  });
  expect(parsed.rows.find((row) => row.title === '英文')).toMatchObject({
    dayOfWeek: 2, startPeriod: 1, endPeriod: 1,
  });
  expect(parsed.rows.find((row) => row.title === '微積分')).toMatchObject({
    dayOfWeek: 2, startPeriod: 2, endPeriod: 2,
  });
});

it('imports grades from a user-saved school page without treating a login form as data', () => {
  const html = page('<table><tr><th>帳號</th><th>密碼</th></tr>' +
    '<tr><td><input name="uid"></td><td><input type="password"></td></tr></table>' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>統計學</td><td>3</td><td>87</td></tr></table>');
  const found = extractSchoolPageTables(html, 'grades');
  expect(found).toHaveLength(1);
  const result = parsePersonalImport(found[0].text, { ...opts, kind: 'grades' });
  expect(result.rows[0]).toMatchObject({ title: '統計學', grade: '87', credits: 3 });
  expect(found[0].text).not.toContain('密碼');
  expect(found[0].text).not.toContain('uid');
});

it('returns separate candidates when one page contains two valid grade tables', () => {
  const html = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>資料庫</td><td>3</td><td>80</td></tr></table>' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>英文</td><td>2</td><td>90</td></tr></table>';
  const found = extractSchoolPageTables(html, 'grades');
  expect(found).toHaveLength(2);
  expect(found.map((candidate) => candidate.rowCount)).toEqual([1, 1]);
});

it('rejects unrelated HTML and oversized pages without requesting a network resource', () => {
  expect(() => extractSchoolPageTables('<table><tr><th>帳號</th><th>密碼</th></tr><tr><td>123</td><td>secret</td></tr></table>', 'grades'))
    .toThrow(SchoolPageImportError);
  expect(() => extractSchoolPageTables('<table>' + 'a'.repeat(512_001) + '</table>', 'timetable'))
    .toThrow(/超過/);
  expect(() => extractSchoolPageTables('<html><body>登入頁</body></html>', 'timetable'))
    .toThrow(/沒有找到網頁表格/);
});

it('finds a grade table nested inside a school portal layout without duplicating rows', () => {
  const html = '<table class="layout"><tr><td><table class="grades">' +
    '<tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>演算法</td><td>3</td><td>93</td></tr>' +
    '</table></td></tr></table>';
  const found = extractSchoolPageTables(html, 'grades');
  expect(found).toHaveLength(1);
  expect(parsePersonalImport(found[0].text, { ...opts, kind: 'grades' }).rows[0])
    .toMatchObject({ title: '演算法', grade: '93', credits: 3 });
});

it('suggests an unambiguous academic term without overwriting the imported row', () => {
  const html = '<h2>115 學年度 第 1 學期 課表</h2>' +
    '<table><tr><th>課程名稱</th><th>星期</th><th>開始節次</th></tr>' +
    '<tr><td>資料庫</td><td>一</td><td>3</td></tr></table>';
  const found = extractSchoolPageTables(html, 'timetable', 'pu');
  expect(found[0].suggestedTerm).toEqual({ academicYear: '115', semester: '1' });
  const parsed = parsePersonalImport(found[0].text, opts);
  expect(parsed.rows[0]).toMatchObject({ academicYear: '115', semester: '1', dayOfWeek: 1 });
});

it('declines to guess the academic term when several distinct semesters appear', () => {
  const html = '<h1>114 學年度 第 2 學期</h1><h2>115 學年度 第 1 學期</h2>' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>統計</td><td>3</td><td>95</td></tr></table>';
  expect(extractSchoolPageTables(html, 'grades')[0].suggestedTerm).toBeUndefined();
});

it('does not treat script contents as reliable academic term evidence', () => {
  const html = '<script>var term="115 學年度第 1 學期";</script>' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>統計</td><td>3</td><td>90</td></tr></table>';
  expect(extractSchoolPageTables(html, 'grades')[0].suggestedTerm).toBeUndefined();
});

it('treats hostile script markup and escaped tags only as data, not a course table', () => {
  const markup = '<script>const leaked = "<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>" + ' +
    '"<tr><td>偽造課程</td><td>20</td><td>99</td></tr></table>";</script  data-x="1">' +
    '<!-- <table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>註解課程</td><td>1</td><td>90</td></tr></table> -->' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>真實課程 &lt;script&gt;</td><td>3</td><td>88</td></tr></table>';
  const found = extractSchoolPageTables(markup, 'grades');
  expect(found).toHaveLength(1);
  expect(found[0].rowCount).toBe(1);
  expect(found[0].text).not.toContain('偽造課程');
  expect(found[0].text).not.toContain('註解課程');
  expect(found[0].text).not.toContain('<script');
  const parsed = parsePersonalImport(found[0].text, { ...opts, kind: 'grades' });
  expect(parsed.rows).toHaveLength(1);
  expect(parsed.rows[0]).toMatchObject({ credits: 3, grade: '88' });
});

it('does not trust fake tables buried inside attributes or hidden elements', () => {
  const markup = '<div data-value="><table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>">' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr hidden><td>隱藏課程</td><td>4</td><td>99</td></tr>' +
    '<tr><td>真實課程</td><td>2</td><td>90</td></tr></table></div>';
  const found = extractSchoolPageTables(markup, 'grades');
  expect(found).toHaveLength(1);
  expect(found[0].rowCount).toBe(1);
  expect(found[0].text).not.toContain('隱藏課程');
  expect(found[0].text).toContain('真實課程');
});
