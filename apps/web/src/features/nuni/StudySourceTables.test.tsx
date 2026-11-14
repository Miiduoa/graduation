import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StudySourceTables } from './StudySourceTables';
import { extractStudySourceTables } from './studySourceTables';

const source = [
  '課堂資料（數值請依原始教材核對）：',
  '| 科目 | 學分 | 教室 |',
  '| :--- | ---: | --- |',
  '| 資料庫 | 3 | 301 |',
  '| 計算機概論 | 2 | 205 |',
].join('\n');

it('keeps exact original values and column order in accessible table cells', () => {
  expect(extractStudySourceTables(source)).toEqual([{
    startLine: 2,
    headers: ['科目', '學分', '教室'],
    rows: [['資料庫', '3', '301'], ['計算機概論', '2', '205']],
  }]);
  render(<StudySourceTables text={source} />);
  const table = screen.getByRole('table', { name: '原文第 2 行起的表格' });
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
    .toEqual(['科目', '學分', '教室']);
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  // Screen readers can now identify each source row by its first non-empty cell
  // while retaining the exact column headers and data values.
  expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent))
    .toEqual(['資料庫', '計算機概論']);
  expect(within(table).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(['3', '301', '2', '205']);
  expect(within(table).getByText('301')).toBeTruthy();
  expect(screen.getByRole('region', { name: /可左右捲動/ }).getAttribute('tabindex')).toBe('0');
});

it('does not render a guessed table for missing cells or ordinary prose', () => {
  const invalid = [
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 | 教室301 |',
    '這不是表格，只有 | 隨意分隔的句子。',
    '| 章節 | 概念 |',
    '| --- | --- |',
    '| SQL \\| NoSQL | 資料庫 | 多一欄 |',
  ].join('\n');
  expect(extractStudySourceTables(invalid)).toEqual([]);
  const view = render(<StudySourceTables text={invalid} />);
  expect(view.queryByRole('table')).toBeNull();
});

it('renders escaped pipes as one cell without inventing additional columns', () => {
  const markdown = ['| 課題 | 說明 |', '| --- | --- |', '| SQL \\| NoSQL | 資料庫 |'].join('\n');
  expect(extractStudySourceTables(markdown)).toEqual([{
    startLine: 1,
    headers: ['課題', '說明'],
    rows: [['SQL | NoSQL', '資料庫']],
  }]);
  render(<StudySourceTables text={markdown} />);
  expect(screen.getByText('SQL | NoSQL')).toBeTruthy();
});

it('ignores Markdown code fences and malformed captions rather than inventing data', () => {
  const tick = String.fromCharCode(96);
  const text = [
    tick.repeat(3) + 'markdown',
    '| 欄一 | 欄二 |',
    '| --- | --- |',
    '| 虛構 | 99 |',
    tick.repeat(3),
    '| 正確 | 單位 |',
    '| --- | --- |',
    '| 學分 | 3 |',
  ].join('\n');
  const parsed = extractStudySourceTables(text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].rows).toEqual([['學分', '3']]);
});

it('hides a table with more than 20 rows instead of showing an incomplete extract', () => {
  const longTable = [
    '| 第幾題 | 分數 |', '| --- | --- |',
    ...Array.from({ length: 21 }, (_, i) => '| ' + (i + 1) + ' | 1 |'),
  ].join('\n');
  expect(extractStudySourceTables(longTable)).toEqual([]);
});

it('keeps a source change isolated without retaining an earlier passage table', () => {
  const view = render(<StudySourceTables text={source} />);
  expect(screen.getByRole('table')).toBeTruthy();
  view.rerender(<StudySourceTables text="新教材只有段落，沒有表格。" />);
  expect(screen.queryByRole('table')).toBeNull();
});

it('does not mistake a shorter code fence for the end of a longer one', () => {
  const tick = String.fromCharCode(96);
  const content = [
    tick.repeat(4) + 'markdown',
    tick.repeat(3),
    '| 隱藏 | 結果 |',
    '| --- | --- |',
    '| 不是真正表格 | 999 |',
    tick.repeat(4),
    '| 已授權教材 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  const tables = extractStudySourceTables(content);
  expect(tables).toHaveLength(1);
  expect(tables[0].headers).toEqual(['已授權教材', '學分']);
  expect(tables[0].rows).toEqual([['資料庫', '3']]);
});

it('omits the entire table if a later source row is malformed, rather than showing a partial table', () => {
  for (const broken of [
    '| 資工 | 3 | 加選 |',
    '| 資工 |',
  ]) {
    const text = [
      '| 科目 | 學分 |',
      '| --- | --- |',
      '| 資料庫 | 3 |',
      broken,
      '| 網路概論 | 2 |',
    ].join('\n');
    expect(extractStudySourceTables(text)).toEqual([]);
  }
});

it('ignores code-indented pipe tables instead of presenting code text as data', () => {
  const text = [
    '    | 暫存標題 | 金額 |',
    '    | --- | --- |',
    '    | 測試資料 | 999 |',
    '\t| 其他欄 | 數值 |',
    '\t| --- | --- |',
    '\t| 測試 | 111 |',
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  const tables = extractStudySourceTables(text);
  expect(tables).toHaveLength(1);
  expect(tables[0].headers).toEqual(['課程', '學分']);
  expect(tables[0].rows).toEqual([['資料庫', '3']]);
});

it('keeps fenced code hidden when an apparent closing fence has trailing text', () => {
  const tick = String.fromCharCode(96);
  const text = [
    tick.repeat(3) + 'markdown',
    tick.repeat(3) + 'not-a-closing-fence',
    '| 虛構 | 金額 |',
    '| --- | --- |',
    '| 範例 | 999 |',
    tick.repeat(3),
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 程式設計 | 3 |',
  ].join('\n');
  const tables = extractStudySourceTables(text);
  expect(tables).toHaveLength(1);
  expect(tables[0].rows).toEqual([['程式設計', '3']]);
});

it('keeps a fenced code example hidden when a tab-indented marker resembles its closing fence', () => {
  const tick = String.fromCharCode(96);
  const text = [
    tick.repeat(3) + 'markdown',
    '\t' + tick.repeat(3),
    '| 虛構資料 | 學分 |',
    '| --- | --- |',
    '| 測試科目 | 999 |',
    tick.repeat(3),
    '| 真正教材 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(text)).toEqual([{
    startLine: 7,
    headers: ['真正教材', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('does not treat a tab-indented code marker as a new fenced block', () => {
  const text = [
    '\t~~~',
    '',
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(text)).toEqual([{
    startLine: 3,
    headers: ['科目', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('omits tables hidden inside Markdown HTML comments without losing visible material afterward', () => {
  const content = [
    '<!-- 以下資料僅供教師備註',
    '| 模擬科目 | 模擬分數 |',
    '| --- | --- |',
    '| 尚未發布 | 999 |',
    '-->',
    '| 公開教材 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  const tables = extractStudySourceTables(content);
  expect(tables).toEqual([{
    startLine: 6,
    headers: ['公開教材', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('does not turn an inline HTML comment into a fabricated or incomplete source table', () => {
  const content = [
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
    '<!-- | 尚未公布 | 999 | -->',
    '| 網路概論 | 2 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([]);
});

it('does not let a comment marker in a fenced code sample hide later source tables', () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const content = [
    ticks + 'markdown',
    '<!--',
    '| 範例 | 假分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    ticks,
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資管 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 7,
    headers: ['正式課程', '學分'],
    rows: [['資管', '3']],
  }]);
});

it('tracks a second HTML comment opened on the same line the first one closes', () => {
  const content = [
    '<!-- 第一段隱藏',
    '--> <!-- 第二段繼續隱藏',
    '| 假學分 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '-->',
    '| 正式科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 7,
    headers: ['正式科目', '學分'],
    rows: [['資料庫', '3']],
  }]);
});


it('ignores raw HTML code blocks rather than presenting sample data as course tables', () => {
  const content = [
    '<pre class="example">',
    '| 測試科目 | 分數 |',
    '| --- | --- |',
    '| 未發布 | 999 |',
    '</pre>',
    '<code>',
    '| 模擬題目 | 分數 |',
    '| --- | --- |',
    '| 測試 | 888 |',
    '</code>',
    '<script>',
    '| 隱藏欄位 | 數值 |',
    '| --- | --- |',
    '| 測試 | 777 |',
    '</script>',
    '<style>',
    '| 範例欄位 | 數值 |',
    '| --- | --- |',
    '| 測試 | 666 |',
    '</style>',
    '<textarea>',
    '| 輸入欄位 | 數值 |',
    '| --- | --- |',
    '| 測試 | 555 |',
    '</textarea>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 26,
    headers: ['正式課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('tracks HTML comments closing before a raw code block opens on the same line', () => {
  const content = [
    '<!-- 不展示 --> <pre class="notes">',
    '| 假科目 | 假學分 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '</pre> <!-- 再開啟註解',
    '| 內部數值 | 學分 |',
    '| --- | --- |',
    '| 假資料 | 888 |',
    '-->',
    '| 真正教材 | 學分 |',
    '| --- | --- |',
    '| 資管 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 10,
    headers: ['真正教材', '學分'],
    rows: [['資管', '3']],
  }]);
});

it('does not let raw HTML-looking examples inside fenced code hide subsequent real tables', () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const content = [
    ticks + 'html',
    '<pre>',
    '| 假欄 | 數值 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    ticks,
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 7,
    headers: ['課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('omits an ambiguous table row containing raw HTML code tags', () => {
  const content = [
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
    '| <code>測試</code> | 999 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([]);
});

it('recognizes --!> as an HTML comment end without showing hidden sample tables', () => {
  const content = [
    '<!-- 教師未公開的資料',
    '| 隱藏科目 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '--!> <!-- 第二段仍未公開',
    '| 假科目 | 分數 |',
    '| --- | --- |',
    '| 模擬 | 888 |',
    '--!> <pre>',
    '| 程式範例 | 分數 |',
    '| --- | --- |',
    '| 測試 | 777 |',
    '</pre>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 14,
    headers: ['正式課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('does not let a literal --!> inside fenced code alter HTML comment tracking', () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const content = [
    ticks + 'html',
    '<!--',
    '--!>',
    '| 假科目 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    ticks,
    '<!-- 真正 HTML 註解',
    '| 其他假資料 | 分數 |',
    '| --- | --- |',
    '| 測試 | 888 |',
    '--!>',
    '| 真正教材 | 學分 |',
    '| --- | --- |',
    '| 資管 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 13,
    headers: ['真正教材', '學分'],
    rows: [['資管', '3']],
  }]);
});

it('treats inline Markdown examples of HTML tags and comments as literal teaching content', () => {
  const content = [
    'HTML 課：`<pre>`、`<!--` 與 `--!>` 是要說明的字面符號。',
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 2,
    headers: ['課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('tracks a real HTML comment after an inline code example on the same line', () => {
  const content = [
    '用 `<pre>` 舉例 <!-- 教師未公布',
    '| 隱藏成績 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '-->',
    '| 正式教材 | 學分 |',
    '| --- | --- |',
    '| 資管 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 6,
    headers: ['正式教材', '學分'],
    rows: [['資管', '3']],
  }]);
});

it('handles an HTML-looking Markdown fence info string before reading later tables', () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const content = [
    ticks + 'html <pre>',
    '| 虛構課程 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    ticks,
    '| 正式教材 | 學分 |',
    '| --- | --- |',
    '| 資管 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 6,
    headers: ['正式教材', '學分'],
    rows: [['資管', '3']],
  }]);
});

it('does not let a fence-looking line inside an HTML code block swallow later tables', () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const content = [
    '<pre>',
    ticks,
    '| 範例 | 數值 |',
    '| --- | --- |',
    '| 模擬 | 999 |',
    '</pre>',
    '| 真正課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 7,
    headers: ['真正課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});


it('does not treat indented code examples as live HTML that hides later source tables', () => {
  const suffix = [
    '| 正式教材 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ];
  for (const example of [
    '    <!-- 這是縮排程式碼裡的字面註解，未關閉',
    '    <pre>這是四格空白縮排的原始碼範例',
    '\t<!-- 這是 Tab 縮排的字面註解，未關閉',
    '\t<pre>這是 Tab 縮排的原始碼範例',
    '   \t<!-- 三格空白加 Tab 也是程式碼',
    '   \t<pre>三格空白加 Tab 也是原始碼範例',
  ]) {
    const tables = extractStudySourceTables([example, ...suffix].join('\n'));
    expect(tables).toEqual([{
      startLine: 2,
      headers: ['正式教材', '學分'],
      rows: [['資料庫', '3']],
    }]);
  }
});

it('still recognizes indented closing HTML tags inside real HTML blocks', () => {
  for (const indent of ['    ', '\t', '   \t']) {
    const content = [
      '<pre>',
      indent + '</pre>',
      '<!-- 教師備註',
      indent + '-->',
      '| 課程 | 學分 |',
      '| --- | --- |',
      '| 資管 | 3 |',
    ].join('\n');
    expect(extractStudySourceTables(content)).toEqual([{
      startLine: 5,
      headers: ['課程', '學分'],
      rows: [['資管', '3']],
    }]);
  }
});

it('shows the visible table after preformatted HTML teaching code mentions nested tags', () => {
  const content = [
    '<pre class="lesson">',
    'HTML 教學的字面範例：<code> 與 <pre> 標記',
    '| 範例科目 | 假學分 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '</pre>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 7,
    headers: ['正式課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('omits hidden HTML template and noscript samples while keeping the following real table', () => {
  const content = [
    '<template id="unpublished">',
    '| 未公開成績 | 分數 |',
    '| --- | --- |',
    '| 範例 | 999 |',
    '</template>',
    '<noscript>',
    '| 備用頁面 | 分數 |',
    '| --- | --- |',
    '| 範例 | 888 |',
    '</noscript>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 11,
    headers: ['正式課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('does not invent a row label for an empty first source cell', () => {
  const markdown = [
    '| 課程 | 數值 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
    '|  | 尚未填寫 |',
  ].join('\n');
  render(<StudySourceTables text={markdown} />);
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent))
    .toEqual(['資料庫']);
  const rows = within(table).getAllByRole('row');
  expect(within(rows[2]).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(['', '尚未填寫']);
});


it('offers an opt-in comparison with only exact, positive source table values', () => {
  const material = [
    '| 科目 | 學分 |',
    '| --- | ---: |',
    '| 資料庫 | 3 |',
    '| 網路 | 2.5 |',
    '| 程式設計 | 0 |',
  ].join('\n');
  const { container, rerender } = render(<StudySourceTables text={material} />);
  const details = container.querySelector('details');
  expect(details?.open).toBe(false);
  expect(screen.getByText('展開第 2 欄「學分」的原文數值比較')).toBeTruthy();
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => ({
    min: bar.getAttribute('min'),
    max: bar.getAttribute('max'),
    value: bar.getAttribute('value'),
    label: bar.getAttribute('aria-label'),
    valueText: bar.getAttribute('aria-valuetext'),
  }))).toEqual([
    { min: '0', max: '3', value: '3', label: '資料庫：3', valueText: '3；本欄最大值 3' },
    { min: '0', max: '3', value: '2.5', label: '網路：2.5', valueText: '2.5；本欄最大值 3' },
    { min: '0', max: '3', value: '0', label: '程式設計：0', valueText: '0；本欄最大值 3' },
  ]);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['3', '2.5', '0']);
  // Switching source must drop the old comparison, not show stale measurements.
  rerender(<StudySourceTables text="這段沒有公開的數字表格。" />);
  expect(container.querySelector('meter')).toBeNull();
});

it('does not draw misleading bars for formulas, dates, percentages, units or ambiguous rows', () => {
  for (const secondColumn of [
    ['2+3', '4'], ['12%', '25%'], ['2026-11-14', '2026-11-15'],
    ['3 公斤', '5 公斤'], ['-1', '2'], ['.5', '1'], ['0', '0'],
    ['1,000', '200'], ['Infinity', '2'],
  ]) {
    const source = ['| 項目 | 值 |', '| --- | --- |',
      '| A | ' + secondColumn[0] + ' |', '| B | ' + secondColumn[1] + ' |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={source} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  const repeated = ['| 項目 | 分數 |', '| --- | --- |',
    '| A | 10 |', '| A | 20 |'].join('\n');
  const { container } = render(<StudySourceTables text={repeated} />);
  expect(container.querySelector('meter')).toBeNull();
});

it('does not compare numeric ordinals, class levels or pages as quantities', () => {
  for (const header of [
    '學年', '學年（民國）', '學期', '年級', '班級', '頁碼（PDF）', '頁次',
    '週次', '樓層', '排名', '名次', '月份', '民國年', '西元年',
    'Academic Year', 'Academic Term', 'Semester', 'Student ID',
    'Student Number', 'Course Code', 'Course Number', 'Postal Code',
    'ZIP code', 'Page Number', 'Sequence Number', 'Floor Number',
  ]) {
    const material = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 1 |', '| 乙 | 2 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    unmount();
  }
});

it('still compares actual amounts when an English header mentions a year or course', () => {
  for (const header of ['Annual Budget', 'Yearly Budget', 'Course Credits', '學期學分']) {
    const material = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2.50 |', '| 乙 | 3 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(container.querySelectorAll('meter')).toHaveLength(2);
    unmount();
  }
});

it('does not turn numeric years or identifiers into misleading comparison bars', () => {
  for (const header of ['年份', '學年度', '學號', '課程編號', '帳號', '郵遞區號', '年度', 'year', 'ID']) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| A | 2024 |', '| B | 2025 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // The calendar word in a real measure must not hide valid annual budget values.
  const annualBudget = ['| 項目 | 年度預算 |', '| --- | --- |',
    '| A | 120 |', '| B | 200 |'].join('\n');
  const { container } = render(<StudySourceTables text={annualBudget} />);
  expect(container.querySelectorAll('meter')).toHaveLength(2);
});

it('reads the exact source numeric spelling, rather than inferring a percentage', () => {
  const material = ['| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3.00 |', '| 網路 | 2.50 |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => bar.getAttribute('aria-valuetext')))
    .toEqual(['3.00；本欄最大值 3.00', '2.50；本欄最大值 3.00']);
});

it('visualizes exact source percentages on a fixed 100% scale without changing source cells', () => {
  const material = [
    '| 練習 | 完成率 |',
    '| --- | --- |',
    '| 資料庫 | 75% |',
    '| 網路 | 0％ |',
    '| 程式設計 | 100.00% |',
  ].join('\n');
  const { container, rerender } = render(<StudySourceTables text={material} />);
  expect(screen.getByText('展開第 2 欄「完成率」的原文百分比（100% 滿格）')).toBeTruthy();
  expect(Array.from(container.querySelectorAll('meter')).map((meter) => ({
    max: meter.getAttribute('max'),
    value: meter.getAttribute('value'),
    label: meter.getAttribute('aria-label'),
    reading: meter.getAttribute('aria-valuetext'),
  }))).toEqual([
    { max: '100', value: '75', label: '資料庫：75%', reading: '75%；滿格 100%' },
    { max: '100', value: '0', label: '網路：0％', reading: '0％；滿格 100%' },
    { max: '100', value: '100', label: '程式設計：100.00%', reading: '100.00%；滿格 100%' },
  ]);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['75%', '0％', '100.00%']);
  rerender(<StudySourceTables text="這段文字沒有表格。" />);
  expect(container.querySelector('meter')).toBeNull();
});

it('does not infer percentage charts from ambiguous headers or out-of-range source', () => {
  const examples = [
    { header: '分數', values: ['75%', '100%'] },
    { header: '完成率', values: ['75', '100'] },
    { header: '完成率', values: ['120%', '90%'] },
    { header: '完成率', values: ['100.01%', '99%'] },
    { header: '正確率', values: ['-1%', '25%'] },
    { header: '出席率', values: ['50.123%', '75%'] },
    { header: '通過率', values: ['50 %', '75%'] },
    { header: '完成率', values: ['50%', '25 公斤'] },
  ];
  for (const { header, values } of examples) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | ' + values[0] + ' |', '| 乙 | ' + values[1] + ' |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    unmount();
  }
  const repeated = ['| 項目 | 完成率 |', '| --- | --- |',
    '| 甲 | 20% |', '| 甲 | 30% |'].join('\n');
  const { container } = render(<StudySourceTables text={repeated} />);
  expect(container.querySelector('details')).toBeNull();
});
