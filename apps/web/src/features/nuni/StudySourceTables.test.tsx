import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StudySourceTables } from './StudySourceTables';
import { extractStudySourceTables } from './studySourceTables';

// A read-only source disclosure exists even when no chart is justified.
// Identify only derived comparisons when asserting that no meter is shown.
function comparisonSummaries(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('details > summary'))
    .map((node) => node.textContent ?? '')
    .filter((value) => value.startsWith('展開第 2 欄'));
}

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

it('shows the visible table after escaped preformatted HTML teaching code examples', () => {
  const content = [
    '<pre class="lesson">',
    'HTML 教學的字面範例：&lt;code&gt; 與 &lt;pre&gt; 標記',
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

it('keeps unpublished rows inside actual nested pre tags, even when one starts in prose', () => {
  const content = [
    '<pre class="lesson">',
    '這行是未跳脫的 HTML：<pre> 會真的建立巢狀元素',
    '</pre>',
    '| 教師尚未公開 | 分數 |',
    '| --- | --- |',
    '| 答案 | 99 |',
    '</pre>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(content)).toEqual([{
    startLine: 8,
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
  const details = Array.from(container.querySelectorAll('details')).find(
    (node) => node.querySelector('summary')?.textContent?.startsWith('展開第 2 欄'),
  );
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

it('compares strict thousands-grouped lesson quantities while preserving exact source numerals', () => {
  const markdown = [
    '| 項目 | 交易筆數 |',
    '| --- | --- |',
    '| 甲 | 1,200 |',
    '| 乙 | 2,450.50 |',
  ].join('\n');
  const { container } = render(<StudySourceTables text={markdown} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['1,200', '2,450.50']);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => ({
    value: bar.getAttribute('value'),
    max: bar.getAttribute('max'),
    label: bar.getAttribute('aria-label'),
    text: bar.getAttribute('aria-valuetext'),
  }))).toEqual([
    { value: '1200', max: '2450.5', label: '甲：1,200',
      text: '1,200；本欄最大值 2,450.50' },
    { value: '2450.5', max: '2450.5', label: '乙：2,450.50',
      text: '2,450.50；本欄最大值 2,450.50' },
  ]);
});

it('compares large but safely representable grouped cents without altering the source numerals', () => {
  const markdown = [
    '| 項目 | 金額 |', '| --- | --- |',
    '| 甲 | 1,234,567,890,123.45 |', '| 乙 | 1,234,567,890,123.46 |',
  ].join('\n');
  const { container } = render(<StudySourceTables text={markdown} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['1,234,567,890,123.45', '1,234,567,890,123.46']);
  expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('value')))
    .toEqual(['1234567890123.45', '1234567890123.46']);
});

it('never graphs grouped integers or fractional cents that JavaScript cannot represent exactly', () => {
  for (const [first, second] of [
    ['9,007,199,254,740,992', '9,007,199,254,740,993'],
    ['1,000,000,000,000,000.01', '1,000,000,000,000,000.02'],
    ['100,000,000,000,000.01', '100,000,000,000,000.02'],
  ] as const) {
    const markdown = [
      '| 項目 | 金額 |', '| --- | --- |',
      '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={markdown} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual([first, second]);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('never interprets mixed, invalid thousands separators or source identifiers as quantities', () => {
  for (const [first, second, header] of [
    ['1,000', '200', '交易筆數'], // Keep mixed grouping ambiguous.
    ['1,20', '2,400', '交易筆數'],
    ['12,34,567', '1,234', '交易筆數'],
    ['01,200', '02,400', '交易筆數'],
    ['0,000', '1,000', '交易筆數'],
    ['1,200%', '2,400%', '交易筆數'],
    ['1,200', '2,400.123', '交易筆數'],
    ['1,200', '2,400', '版本'], // Formatting does not make IDs measurable.
  ] as const) {
    const text = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={text} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual([first, second]);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
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

it.each([
  '期中考排名', '期末考排名', '班級名次', '全校排名', '系所排名',
  'Class Rank', 'Exam Ranking', 'Overall Rank', 'Rank Position',
  'Position in Class', 'Place in School', 'Cohort Ranking',
])('keeps academic rank positions as original text rather than ratio bars (%s)', (header) => {
  const material = ['| 學生 | ' + header + ' |', '| --- | --- |',
    '| 甲 | 1 |', '| 乙 | 4 |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['1', '4']);
  expect(comparisonSummaries(container)).toEqual([]);
  expect(container.querySelector('meter')).toBeNull();
});

it.each([
  '排名人數', '名次數量', '班級排名筆數', '每個名次的人數',
  'Rank Count', 'Ranking Total', 'Number of Rankings', 'Rank Quantity',
])('continues to compare explicit counts of ranks as quantities (%s)', (header) => {
  const material = ['| 班級 | ' + header + ' |', '| --- | --- |',
    '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) =>
    [bar.getAttribute('value'), bar.getAttribute('max')]))
    .toEqual([['2', '4'], ['4', '4']]);
});

it('does not turn ordinal priority, severity or difficulty levels into misleading bars', () => {
  for (const header of [
    '優先級', '優先順序', '嚴重程度', '風險等級', '難度', '難度等級',
    '危險等級', '等級', 'Priority', 'Priority Level', 'Severity',
    'Risk Level', 'Difficulty', 'Level', 'Tier', 'Level (1-5)', 'Tier No.',
  ]) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 1 |', '| 網路 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['1', '4']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still compares explicit counts of ordinal categories', () => {
  for (const header of [
    '優先級數', '風險等級數量', '各難度人數', '風險等級總數',
    'Level Count', 'Number of Levels', 'Priority Count',
    'Severity Count', 'Tier Count',
  ]) {
    const material = ['| 對象 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'))
      .map((meter) => [meter.getAttribute('value'), meter.getAttribute('max')]))
      .toEqual([['2', '4'], ['4', '4']]);
    unmount();
  }
});

it('does not compare numeric ordinals, class levels or pages as quantities', () => {
  for (const header of [
    '學年', '學年（民國）', '學期', '年級', '班級', '頁碼（PDF）', '頁次',
    '週次', '樓層', '排名', '名次', '月份', '民國年', '西元年',
    'Academic Year', 'Academic Term', 'Semester', 'Student ID',
    'Student Number', 'Course Code', 'Course Number', 'Postal Code',
    'ZIP code', 'Page Number', 'Sequence Number', 'Floor Number',
    '題號', '題次', '題號（試卷）', '作業題號', 'Question ID',
    'Question Number', 'Question No.', 'Problem Number', 'Exercise ID',
  ]) {
    const material = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 1 |', '| 乙 | 2 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
});

it('keeps software versions, editions and build identifiers as text, not misleading ratios', () => {
  for (const header of [
    '版本', '軟體版本', '版本號', '版次', '修訂版', '修訂號', '發行版', '發行號', '編譯號',
    'Version', 'Software Version', 'Version (major)', 'Revision', 'Revision No.',
    'Edition', 'Release', 'Build', 'Build Number', 'Build ID',
  ]) {
    const material = [
      '| 軟體 | ' + header + ' |', '| --- | --- |',
      '| 舊版 | 2 |', '| 新版 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['2', '4']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still compares explicit numbers of software releases rather than hiding real counts', () => {
  for (const header of [
    '版本數', '版本數量', '版本總數', '修訂次數', '發行次數',
    'Number of Versions', 'Version Count', 'Revision Count',
    'Release Total', 'Number of Editions',
  ]) {
    const material = [
      '| 專案 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map((node) => node.getAttribute('value')))
      .toEqual(['2', '4']);
    unmount();
  }
});

it('keeps binary state, access and completion codes as categories, not proportional bars', () => {
  for (const header of [
    '是否完成', '是否通過', '啟用狀態', '有無繳交', '狀態', '狀況（0/1）',
    '完成與否', '通過與否', '布林值', '真假值', '開關狀態',
    'Status', 'Status (0/1)', 'Enrollment Status', 'Enabled',
    'Is Active', 'Is Completed', 'Pass Flag', 'Boolean', 'Flag',
    'Activation State', 'Has Access', 'State', 'Access (0/1)', 'Access（１／０）',
  ]) {
    const material = [
      '| 項目 | ' + header + ' |', '| --- | --- |',
      '| 未啟用 | 0 |', '| 已啟用 | 1 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['0', '1']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('preserves actual counts even when a status-related word appears in the header', () => {
  for (const header of [
    '完成數量', '通過人數', '啟用數量', '狀態數量', '開關次數',
    'Status Count', 'Number of Enabled Users', 'Completed Task Count',
    'Boolean Count', 'State Population', 'Active Users',
  ]) {
    const material = [
      '| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'))
      .map((meter) => meter.getAttribute('value'))).toEqual(['2', '4']);
    unmount();
  }
});

it('still compares actual amounts when an English header mentions a year or course', () => {
  for (const header of ['Annual Budget', 'Yearly Budget', 'Course Credits', '學期學分',
    '練習題數', 'Number of Questions']) {
    const material = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2.50 |', '| 乙 | 3 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(container.querySelectorAll('meter')).toHaveLength(2);
    unmount();
  }
});

it('compares exact credit values with repeated units and keeps the original cells', () => {
  const material = [
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 學分 |',
    '| 網路 | 2.50學分 |',
    '| 體育 | 0 學分 |',
  ].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => ({
    max: bar.getAttribute('max'),
    value: bar.getAttribute('value'),
    label: bar.getAttribute('aria-label'),
    valueText: bar.getAttribute('aria-valuetext'),
  }))).toEqual([
    { max: '3', value: '3', label: '資料庫：3 學分', valueText: '3 學分；本欄最大值 3 學分' },
    { max: '3', value: '2.5', label: '網路：2.50學分', valueText: '2.50學分；本欄最大值 3 學分' },
    { max: '3', value: '0', label: '體育：0 學分', valueText: '0 學分；本欄最大值 3 學分' },
  ]);
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(['3 學分', '2.50學分', '0 學分']);
});

it('refuses to guess credits or mix explicit units and plain numbers', () => {
  const cases = [
    { heading: '數值', values: ['3 學分', '2 學分'] },
    { heading: '學分', values: ['3 學分', '2'] },
    { heading: '學分', values: ['3 學分', '2 小時'] },
    { heading: '學分', values: ['3 credits', '2 credits'] },
    { heading: '學分', values: ['3 學分', '2.123 學分'] },
    { heading: '學分', values: ['0 學分', '0 學分'] },
  ];
  for (const { heading, values } of cases) {
    const material = [
      '| 課程 | ' + heading + ' |', '| --- | --- |',
      '| 甲 | ' + values[0] + ' |', '| 乙 | ' + values[1] + ' |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
});

it('does not imply zero-based ratios for temperatures, pH, decibels or earthquake scales', () => {
  const science = [
    ['攝氏溫度', '20', '40'],
    ['華氏溫度', '32', '64'],
    ['酸鹼值', '4', '8'],
    ['地震規模', '4', '6'],
    ['噪音分貝', '30', '60'],
    ['Temperature', '20', '40'],
    ['Celsius', '20', '40'],
    ['Fahrenheit', '32', '64'],
    ['pH', '4', '8'],
    ['Noise (dB)', '30', '60'],
    ['Richter Scale', '4', '6'],
  ] as const;
  for (const [header, first, second] of science) {
    const material = ['| 樣本 | ' + header + ' |', '| --- | --- |',
      '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual([first, second]);
    expect(container.querySelectorAll('meter')).toHaveLength(0);
    unmount();
  }
  // Real quantities must continue to offer the opt-in exact-source comparison.
  const quantity = ['| 樣本 | 數量 |', '| --- | --- |',
    '| 甲 | 20 |', '| 乙 | 40 |'].join('\n');
  const { container } = render(<StudySourceTables text={quantity} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => bar.getAttribute('max')))
    .toEqual(['40', '40']);
});

it('does not turn numeric years or identifiers into misleading comparison bars', () => {
  for (const header of ['年份', '學年度', '學號', '課程編號', '帳號', '郵遞區號', '年度', 'year', 'ID']) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| A | 2024 |', '| B | 2025 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // The calendar word in a real measure must not hide valid annual budget values.
  const annualBudget = ['| 項目 | 年度預算 |', '| --- | --- |',
    '| A | 120 |', '| B | 200 |'].join('\n');
  const { container } = render(<StudySourceTables text={annualBudget} />);
  expect(container.querySelectorAll('meter')).toHaveLength(2);
});

it('keeps textbook chapter and lesson ordinals as source text, not quantity bars', () => {
  // A lesson index or course week is an ordinal even when the cells contain
  // plain digits. Do not imply that the fourth lesson is twice the second.
  for (const header of [
    '章節', '章次', '單元', '單元編號', '課次', '講次', '節次', '單元（教材）',
    'Week', 'Week No.', 'Week Number', 'Week #', 'Chapter', 'Chapter Number',
    'Chapter No.', 'Unit ID', 'Lesson', 'Lesson Number', 'Module (Textbook)',
    'Lecture No.', 'Section ID', 'Session',
  ]) {
    const material = [
      '| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 2 |', '| 網路 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['2', '4']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still compares explicit numbers of weeks, chapters and learning units', () => {
  for (const header of [
    '章節數量', '單元數', '課程時數',
    'Number of Weeks', 'Week Count', 'Number of Chapters',
    'Chapter Count', 'Lesson Count', 'Sessions Completed',
  ]) {
    const material = [
      '| 班級 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map(bar => [
      bar.getAttribute('value'), bar.getAttribute('max'),
    ])).toEqual([['2', '4'], ['4', '4']]);
    unmount();
  }
});

it('keeps room and seat identifiers as locations, not ratio-style bars', () => {
  for (const header of ['教室', '實驗室', '房號', '宿舍房號', '寢室', '座位',
    '位置', '地點', 'Room', 'Room Number', 'Room #', 'Classroom', 'Lab No.',
    'Building', 'Location', 'Seat Number']) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 301 |', '| 網路 | 205 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['301', '205']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }

  // Counts of rooms/seats are measures and must not be blocked by the
  // location-identifier guard above.
  for (const header of ['教室數', '實驗室數量', '座位數', 'Number of Rooms',
    'Room Count', 'Classroom Count']) {
    const material = ['| 校區 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'))
      .map((bar) => bar.getAttribute('value'))).toEqual(['2', '4']);
    unmount();
  }
});

it('keeps database keys and VLAN / ASN namespace identifiers as source values, not proportional bars', () => {
  for (const header of [
    '主鍵', '外鍵', '候選鍵', '代理鍵', '主鍵值', '主鍵（資料庫）',
    'Primary Key', 'Foreign Key', 'Candidate Key', 'Surrogate Key',
    'Primary Key (SQL)', 'Foreign Key Number', 'VLAN', 'VLAN ID',
    'VLAN 編號', 'ASN', 'AS Number', 'Autonomous System Number',
    '虛擬區域網路編號', '自治系統號碼',
  ]) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 第一筆 | 100 |', '| 第二筆 | 200 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['100', '200']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still graphs genuine database-key counts and network amounts without guessing identifiers', () => {
  for (const header of [
    '主鍵數量', '外鍵總數', '主鍵數', 'Primary Key Count',
    'Number of Foreign Keys', 'Candidate Key Count',
    'VLAN Count', 'VLAN Throughput', 'VLAN Bandwidth',
    'ASN Count', '自治系統數量', '虛擬區域網路數量',
  ]) {
    const material = ['| 站點 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'))
      .map((bar) => [bar.getAttribute('value'), bar.getAttribute('max')]))
      .toEqual([['2', '4'], ['4', '4']]);
    unmount();
  }
});

it('keeps network ports, radio channels and protocol layers as identifiers, not ratio bars', () => {
  for (const header of [
    'TCP 埠號', 'UDP 埠號', '來源埠', '目的埠', '連接埠', '服務埠',
    '埠號', '通訊埠', '無線頻道', 'Wi-Fi 頻道', '頻道編號', '通道號碼',
    '網路層級', '協定號碼', '連接埠編號', 'Wi-Fi 通道號',
    'TCP 埠號（常用）', 'Port', 'TCP Port', 'UDP Port', 'Source Port',
    'Destination Port', 'Port Number', 'Port No.', 'Channel',
    'Wi-Fi Channel', 'Channel #', 'OSI Layer', 'Layer', 'Protocol Number',
    'TCP Port (%)',
  ]) {
    const material = ['| 服務 | ' + header + ' |', '| --- | --- |',
      '| HTTPS | 443 |', '| HTTP | 80 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['443', '80']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('continues to compare measured counts and throughput instead of hiding real network quantities', () => {
  for (const header of [
    '連接埠數', '開放埠數量', '埠號數量', '通道總數', '頻道數', '網路層數',
    'Port Count', 'Number of Ports', 'Open Port Count', 'Channel Count',
    'Number of Channels', 'Layer Count', 'Number of Layers',
    'Port Throughput', 'Layer Thickness', 'Channel Width',
    '連接埠吞吐量', '通訊埠流量', '頻道頻寬', '通道寬度',
    '無線頻道速率', '傳輸速率', '下載速率', 'Wi-Fi 頻道容量', '網路埠負載',
  ]) {
    const material = ['| 範圍 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'))
      .map((bar) => [bar.getAttribute('value'), bar.getAttribute('max')]))
      .toEqual([['2', '4'], ['4', '4']]);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['2', '4']);
    unmount();
  }
});

it('keeps non-speed rates and proportions from becoming unitless quantity bars', () => {
  for (const header of ['錯誤率', '合格率', '利率', '比率', '占比']) {
    const material = ['| 課題 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['2', '4']);
    unmount();
  }
});

it('reads the exact source numeric spelling, rather than inferring a percentage', () => {
  const material = ['| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3.00 |', '| 網路 | 2.50 |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => bar.getAttribute('aria-valuetext')))
    .toEqual(['3.00；本欄最大值 3.00', '2.50；本欄最大值 3.00']);
});

it.each([
  ['風險等級百分比', true], ['風險等級（%）', true],
  ['排名前十佔比', true], ['班級名次前十名百分比', true],
  ['排名前１０名比例', false], ['排名前十（%）', true], ['Top 10 Rank Share (%)', true],
] as const)('charts %s against a fixed 100%% scale (merge base charted: %s)', (header, _mergeBaseCharted) => {
  const material = [`| 風險 | ${header} |`, '| --- | --- |', '| 低 | 25% |', '| 高 | 75% |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(screen.getByText(`展開第 2 欄「${header}」的原文百分比（100% 滿格）`)).toBeTruthy();
  expect(Array.from(container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
    .toEqual([[25, 100], [75, 100]]);
});

it.each(['全校排名（%）', '班級名次 %', 'Rank Position (%)', 'Position in Class (%)'])(
  'keeps %s as a table because the merge-base percentage meter misrepresents an ordinal', (header) => {
    const material = [`| 分組 | ${header} |`, '| --- | --- |', '| 甲 | 25% |', '| 乙 | 75% |'].join('\n');
    const { container } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    expect(container.querySelector('meter')).toBeNull();
  },
);

it.each([
  '完成狀況（%）', '各題號完成狀況（%）', '各題號的完成狀況及正答率（%）', '各題號正答率', '各題次正確率（％）',
  'Completion status (%)', 'Accuracy by question number (%)', '依帳號完成狀況（%）', 'Coverage by student ID (%)',
])(
  'charts the bounded measurement for %s', (header) => {
    const material = [`| 題目 | ${header} |`, '| --- | --- |', '| 甲 | 50% |', '| 乙 | 75% |'].join('\n');
    const { container } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
      .toEqual([[50, 100], [75, 100]]);
  },
);

it.each(['題號 (%)', '各題號 (%)', '作業題號 (%)', 'Question Number (%)', '郵遞區號 (%)', '狀態 (%)'])(
  'keeps a percentage unit on the identifier %s from enabling a chart', (header) => {
    const material = [`| 名稱 | ${header} |`, '| --- | --- |', '| 甲 | 50% |', '| 乙 | 75% |'].join('\n');
    const { container } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
  },
);

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

it.each([
  { name: 'regular space', values: ['75 %', '25 %'], amounts: ['75', '25'] },
  { name: 'no-break space and fullwidth digits', values: ['７５\u00a0％', '２５\u00a0％'], amounts: ['75', '25'] },
  { name: 'narrow no-break space and fullwidth decimals', values: ['７５．５０\u202f％', '２４．５０\u202f％'], amounts: ['75.5', '24.5'] },
  { name: 'mixed spaced and unspaced fullwidth percentage rows', values: ['７５ ％', '５０％'], amounts: ['75', '50'] },
])('compares percent signs separated by a single source space ($name), without rewriting evidence', ({ values, amounts }) => {
  const material = ['| 課程 | 完成率 |', '| --- | --- |',
    '| 資料庫 | ' + values[0] + ' |', '| 網路 | ' + values[1] + ' |'].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) =>
    [bar.getAttribute('value'), bar.getAttribute('max'), bar.getAttribute('aria-valuetext')]))
    .toEqual(amounts.map((amount, index) => [amount, '100', values[index] + '；滿格 100%']));
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(values);
});

it('does not infer percentage charts from ambiguous headers or out-of-range source', () => {
  const examples = [
    { header: '分數', values: ['75%', '100%'] },
    { header: '完成率', values: ['75', '100'] },
    { header: '完成率', values: ['120%', '90%'] },
    { header: '完成率', values: ['100.01%', '99%'] },
    { header: '正確率', values: ['-1%', '25%'] },
    { header: '出席率', values: ['50.123%', '75%'] },
    { header: '通過率', values: ['50  %', '75%'] },
    { header: '通過率', values: ['50\t%', '75%'] },
    { header: '通過率', values: ['５０ %', '75%'] },
    { header: '完成率', values: ['50%', '25 公斤'] },
  ];
  for (const { header, values } of examples) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | ' + values[0] + ' |', '| 乙 | ' + values[1] + ' |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
});

it('keeps repeated percentage labels independently traceable to each original source row', () => {
  const repeated = ['| 項目 | 完成率 |', '| --- | --- |',
    '| 甲 | 20% |', '| 甲 | 30% |'].join('\n');
  const { container } = render(<StudySourceTables text={repeated} />);
  expect(comparisonSummaries(container)).toEqual([
    '展開第 2 欄「完成率」的原文百分比（100% 滿格）',
  ]);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => ({
    value: bar.getAttribute('value'),
    max: bar.getAttribute('max'),
    label: bar.getAttribute('aria-label'),
  }))).toEqual([
    { value: '20', max: '100', label: '甲：20%；教材原文第 3 行' },
    { value: '30', max: '100', label: '甲：30%；教材原文第 4 行' },
  ]);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(['20%', '30%']);
});


it('scales explicit English percent and rate columns to 100%, not to the highest row', () => {
  for (const header of [
    'Percent', 'Percentage', 'Completion Rate', 'Attendance Rate',
    'Accuracy', 'Pass Rate', 'Passing Rate', 'Success Rate',
  ]) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 75% |', '| 網路 | 25% |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container).join(' ')).toContain('原文百分比（100% 滿格）');
    expect(Array.from(container.querySelectorAll('meter')).map((bar) => [
      bar.getAttribute('value'), bar.getAttribute('max'),
    ])).toEqual([['75', '100'], ['25', '100']]);
    unmount();
  }
});

it.each([
  ['Status Code (%)', '0%', '1%'],
  ['Access (0/1) %', '0%', '1%'],
  ['Build (%)', '0%', '1%'],
  ['Room # (%)', '0%', '1%'],
  ['Build (CI)', '100', '300'],
  ['Build (CI) (%)', '10%', '20%'],
  ['Access (0 or 1)', '0', '1'],
  ['Access (0 or 1) (%)', '0%', '1%'],
  ['Build Number (Progress) (%)', '25%', '75%'],
])(
  'keeps identifiers and binary codes in the source table (%s)', (header, first, second) => {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | ' + first + ' |', '| 乙 | ' + second + ' |'].join('\n');
    const { container } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual([first, second]);
    expect(comparisonSummaries(container)).toEqual([]);
  },
);

it('does not compare unlabeled English rates as quantities or block real numeric amounts', () => {
  for (const header of ['Percent', 'Percentage', 'Completion Rate', 'Accuracy', 'Passing Rate']) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 75 |', '| 網路 | 25 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
  const budget = ['| 課程 | Annual Budget |', '| --- | --- |',
    '| 資料庫 | 75 |', '| 網路 | 25 |'].join('\n');
  const { container } = render(<StudySourceTables text={budget} />);
  expect(Array.from(container.querySelectorAll('meter')).map((bar) => bar.getAttribute('max')))
    .toEqual(['75', '75']);
});

it('guards progress and additional rate headers with source-grounded 100% scaling', () => {
  const columns = [
    '學習進度', '完成度', '達成率', '合格率', '參與率', '缺席率',
    'Progress', 'Progress Rate', 'Participation Rate', 'Retention Rate',
    'Conversion Rate', 'Error Rate', 'Dropout Rate', '啟用率 (%)', 'Release Completion Rate',
  ];
  for (const column of columns) {
    const material = [
      '| 項目 | ' + column + ' |',
      '| --- | --- |',
      '| 甲 | 75% |',
      '| 乙 | 25% |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container).join(' ')).toContain('原文百分比（100% 滿格）');
    expect(Array.from(container.querySelectorAll('meter')).map((meter) => [
      meter.getAttribute('value'), meter.getAttribute('max'),
    ])).toEqual([['75', '100'], ['25', '100']]);
    unmount();
  }
});

it('does not misrepresent bare progress or rate numbers as max-relative percentages', () => {
  for (const column of ['學習進度', '完成度', '達成率', '參與率', '缺席率',
    'Progress', 'Participation Rate', 'Retention Rate', 'Conversion Rate',
    'Error Rate', 'Dropout Rate']) {
    const material = [
      '| 項目 | ' + column + ' |',
      '| --- | --- |',
      '| 甲 | 75 |',
      '| 乙 | 25 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // A genuinely quantified budget remains eligible for a max-relative comparison.
  const budget = ['| 項目 | Yearly Budget |', '| --- | --- |',
    '| 甲 | 75 |', '| 乙 | 25 |'].join('\n');
  const { container } = render(<StudySourceTables text={budget} />);
  expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('max')))
    .toEqual(['75', '75']);
});

it('does not scale bare rates or ratios as if the largest student value were 100%', () => {
  const headers = [
    '成長率', '報酬率', '年增率', '存活率', '學生通過比例',
    'Growth Rate', 'Interest Rate', 'Profit Ratio', 'Market Share',
  ];
  for (const header of headers) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 75 |', '| 乙 | 25 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('does not force an artificial 100% ceiling on growth or return percentages', () => {
  const headers = [
    '成長率', '年增率', '報酬率', '利率', '營業利潤率',
    'Growth Rate', 'Interest Rate (%)', 'Percent Change', 'Profit Margin (%)',
  ];
  for (const header of headers) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 75% |', '| 乙 | 25% |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['75%', '25%']);
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
});

it('keeps fixed 100% charts for bounded completion rates and numeric budgets', () => {
  for (const header of ['完成率', 'Attendance Rate']) {
    const material = ['| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 75% |', '| 乙 | 25% |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('max')))
      .toEqual(['100', '100']);
    unmount();
  }
  const budget = ['| 項目 | 年度預算 |', '| --- | --- |',
    '| 甲 | 75 |', '| 乙 | 25 |'].join('\n');
  const { container } = render(<StudySourceTables text={budget} />);
  expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('max')))
    .toEqual(['75', '75']);
});

it('does not mislead on abbreviated temperature or decibel source columns', () => {
  // 40 °C is not twice 20 °C, and 60 dBA is not twice 30 dBA.
  // Only the literal source cells should remain, not a zero-based meter.
  for (const header of [
    '氣溫', '室溫', '體溫', '水溫', '氣溫 (°C)', '室溫（°F）',
    '℃', '℉', 'Temp', 'Temp.', 'Temp (°C)', 'Noise dBA',
    'Sound Level dB(A)', 'Noise dBC', 'Sound dBFS', 'Signal dBm',
  ]) {
    const material = [
      '| 樣本 | ' + header + ' |',
      '| --- | --- |',
      '| 甲 | 20 |',
      '| 乙 | 40 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['20', '40']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // Database abbreviations and true amounts must remain usable.
  for (const header of ['DB Record Count', '年度預算', 'Course Credits']) {
    const material = [
      '| 項目 | ' + header + ' |',
      '| --- | --- |',
      '| 甲 | 20 |',
      '| 乙 | 40 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('max')))
      .toEqual(['40', '40']);
    unmount();
  }
});


it('keeps clock readings and map coordinates as exact text rather than ratio bars', () => {
  // Neither noon / 8 AM nor 120° / 60° longitude implies a twofold quantity.
  for (const header of [
    '時刻', '當地時間', '臺北時間', '標準時間', '上課時間', '開始時間', '抵達時間', '經緯度', '經度', '緯度',
    '座標', '海拔', 'Time of Day', 'Clock Time', 'Local Time', 'UTC Time', 'GMT Time', 'Time of Arrival', 'Time of Departure', 'Start Time',
    'Departure Time', 'Latitude', 'Longitude', 'Coordinates', 'Elevation',
  ]) {
    const material = [
      '| 樣本 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 8 |', '| 乙 | 12 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['8', '12']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // A study duration or travelled distance still has a meaningful zero.
  for (const header of ['學習時數', 'Study Hours', 'Distance', 'Course Credits']) {
    const material = [
      '| 項目 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 8 |', '| 乙 | 12 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map((meter) => meter.getAttribute('max')))
      .toEqual(['12', '12']);
    unmount();
  }
});

it('preserves source scores, GPAs, ratings and indexes without implying ratio magnitudes', () => {
  // Both columns contain the same exact raw values, but 4 GPA points or 4 stars
  // must not be presented as twice 2 GPA points or twice 2 stars.
  for (const header of [
    '成績', '平均成績', '分數', '考試得分', '滿意度', '平均績點',
    '星等', '智商', '物價指數', 'GPA', 'Grade', 'Score',
    'Rating', 'Satisfaction', 'Likert Scale', 'IQ', 'Consumer Price Index',
  ]) {
    const material = ['| 學生 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['2', '4']);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still compares actual counts of ratings and other measurable quantities', () => {
  for (const header of [
    '評分人數', '成績筆數', 'Rating Count', 'Number of Scores',
    'Index Entries', '學分', 'Study Hours', 'Distance', 'Annual Budget',
  ]) {
    const material = ['| 名稱 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map((bar) =>
      [bar.getAttribute('value'), bar.getAttribute('max')]))
      .toEqual([['2', '4'], ['4', '4']]);
    unmount();
  }
});


it('lets students select verbatim Markdown table lines, including CRLF and escaped pipes', () => {
  const original = [
    '閱讀前言，這行不能加入複製範圍。',
    '| 課程 | 學分 |',
    '| :--- | ---: |',
    '| SQL \\| NoSQL | 3 |',
    '| 網頁程式 | 2 |',
    '結尾不是表格。',
  ].join('\r\n');
  const { container } = render(<StudySourceTables text={original} />);
  const field = container.querySelector('textarea');
  expect(field?.readOnly).toBe(true);
  expect(field?.getAttribute('aria-label')).toBe('原文表格 1 的可選取文字');
  // Browsers normalize textarea.value newlines to LF even if source used CRLF.
  expect(field?.value.replace(/\r\n?/gu, '\n')).toBe([
    '| 課程 | 學分 |',
    '| :--- | ---: |',
    '| SQL \\| NoSQL | 3 |',
    '| 網頁程式 | 2 |',
  ].join('\n'));
  expect(field?.value).not.toContain('閱讀前言');
  expect(field?.value).not.toContain('結尾');
});

it('selects only visible original Markdown, never HTML-hidden teacher answers', () => {
  const material = [
    '<div hidden>',
    '| 未公布答案 | 分數 |',
    '| --- | --- |',
    '| 秘密 | 999 |',
    '</div>',
    '| 正式科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  const { container } = render(<StudySourceTables text={material} />);
  expect(container.querySelectorAll('textarea')).toHaveLength(1);
  const field = container.querySelector('textarea');
  expect(field?.value).toBe('| 正式科目 | 學分 |\n| --- | --- |\n| 資料庫 | 3 |');
  expect(field?.value).not.toContain('秘密');
});

it('does not invent a zero-based duration chart for ambiguous clock/time headers', () => {
  // 8 and 12 could be clock hours rather than four and twelve hours elapsed.
  // Even parenthesized qualifiers do not by themselves establish a duration.
  for (const header of ['時間', '時間（UTC）', '時段', 'Time', 'Time (UTC)']) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 8 |', '| 乙 | 12 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
});

it('still compares explicitly named elapsed hours rather than disabling useful duration values', () => {
  for (const header of ['學習時數', 'Study Hours', 'Duration Minutes']) {
    const material = ['| 課程 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('meter')).map(node => node.getAttribute('value')))
      .toEqual(['2', '4']);
    unmount();
  }
});

it('keeps calendar dates, timestamps and time-zone positions as source text, not ratio bars', () => {
  // The integer 20 can be a calendar date or an offset, not twice the date or
  // time-zone position of 10. Preserve the original table and source values.
  for (const header of [
    '日期', '截止日期', '到期日', '時間戳', '時間戳記', '時區偏移',
    'Date', 'Due Date', 'Datetime', 'Timestamp', 'Unix Time',
    'Unix Timestamp', 'POSIX Time', 'Epoch Seconds',
    'UTC Offset', 'GMT Offset', 'Time Zone', 'Timezone',
    'Day', 'Day of Month', '時間（UTC）',
  ]) {
    const material = ['| 範例 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 10 |', '| 乙 | 20 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['10', '20']);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  }
  // Quantities still have a meaningful zero, even if they use time units.
  for (const header of ['學習時數', 'Study Hours', 'Duration Minutes', 'Elapsed Days', 'Event Count']) {
    const material = ['| 範例 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 10 |', '| 乙 | 20 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(Array.from(container.querySelectorAll('meter')).map(meter => [
      meter.getAttribute('value'), meter.getAttribute('max'),
    ])).toEqual([['10', '20'], ['20', '20']]);
    unmount();
  }
});

it('selects verbatim source table lines with a focusable one-tap control', () => {
  const sourceText = [
    '序言不要複製',
    '| 課程 | 學分 |', '| --- | --- |',
    '| SQL \\| NoSQL | 3 |', '| 網頁程式 | 2 |',
    '結尾不要複製',
  ].join('\n');
  const { container } = render(<StudySourceTables text={sourceText} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const field = container.querySelector('textarea');
  expect(field?.readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格原文' }));
  expect(document.activeElement).toBe(field);
  expect(field?.selectionStart).toBe(0);
  expect(field?.selectionEnd).toBe(field?.value.length);
  expect(screen.getByRole('status').textContent).toContain('瀏覽器回報已全選');
  expect(field?.value).toContain('SQL \\| NoSQL');
  expect(field?.value).not.toContain('序言');
  expect(field?.value).not.toContain('結尾');
});

it('select-all uses the replaced source and excludes HTML-hidden answers', () => {
  const oldText = ['| 舊講義 | 數值 |', '| --- | --- |', '| 舊 | 9 |'].join('\n');
  const fresh = [
    '<div hidden>', '| 教師答案 | 數值 |', '| --- | --- |', '| 祕密 | 999 |', '</div>',
    '| 新講義 | 學分 |', '| --- | --- |', '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={oldText} />);
  view.rerender(<StudySourceTables text={fresh} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格原文' }));
  const field = view.container.querySelector('textarea');
  expect(field?.value).toBe('| 新講義 | 學分 |\n| --- | --- |\n| 資料庫 | 3 |\n| 網路 | 2 |');
  expect(field?.value).not.toContain('祕密');
  expect(field?.value).not.toContain('舊講義');
  expect(field?.selectionStart).toBe(0);
  expect(field?.selectionEnd).toBe(field?.value.length);
  expect(comparisonSummaries(view.container)).toHaveLength(1);
});

it('selects all the readonly table source when a WebView rejects textarea.select()', () => {
  const view = render(<StudySourceTables text={source} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const field = view.container.querySelector('textarea');
  expect(field).not.toBeNull();
  if (!field) return;
  Object.defineProperty(field, 'select', {
    configurable: true,
    value: () => { throw new Error('mobile readonly selection blocked'); },
  });
  field.setSelectionRange(1, 2);
  fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格原文' }));
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  expect(field.value).toContain('| 資料庫 | 3 | 301 |');
});

it('leaves the original text available if both selection APIs fail', () => {
  const view = render(<StudySourceTables text={source} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const field = view.container.querySelector('textarea');
  expect(field).not.toBeNull();
  if (!field) return;
  Object.defineProperty(field, 'select', {
    configurable: true,
    value: () => { throw new Error('select unavailable'); },
  });
  Object.defineProperty(field, 'setSelectionRange', {
    configurable: true,
    value: () => { throw new Error('selection range unavailable'); },
  });
  expect(() => fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格原文' }))).not.toThrow();
  expect(field.readOnly).toBe(true);
  expect(field.value).toContain('| 計算機概論 | 2 | 205 |');
  expect(document.activeElement).toBe(field);
  expect(screen.getByRole('status').textContent).toContain('瀏覽器未確認全選');
});

it('reports silently ignored WebView selection instead of promising a copy', () => {
  const view = render(<StudySourceTables text={source} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const field = view.container.querySelector('textarea');
  expect(field).not.toBeNull();
  if (!field) return;
  field.setSelectionRange(1, 2);
  field.blur();
  for (const method of ['focus', 'select', 'setSelectionRange'] as const) {
    Object.defineProperty(field, method, {
      configurable: true,
      value: () => { /* A WebView can ignore selection without throwing. */ },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格原文' }));
  expect(field.selectionStart).toBe(1);
  expect(field.selectionEnd).toBe(2);
  expect(screen.getByRole('status').textContent).toContain('瀏覽器未確認全選');
  expect(field.readOnly).toBe(true);
  expect(field.value).toContain('| 計算機概論 | 2 | 205 |');
});

it('selects an exact individual source row without reconstructing cells or copying other rows', () => {
  const view = render(<StudySourceTables text={source} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const range = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }) as HTMLSelectElement;
  fireEvent.change(range, { target: { value: '1' } });
  const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  expect(field.value).toBe('| 計算機概論 | 2 | 205 |');
  expect(field.value).not.toContain('資料庫');
  fireEvent.click(screen.getByRole('button', { name: '全選第 1 張表格第 2 列原文' }));
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  fireEvent.change(range, { target: { value: '-1' } });
  expect(field.value).toContain('| 資料庫 | 3 | 301 |');
  expect(view.container.querySelectorAll('table')).toHaveLength(1);
});

it('preserves exact escaped pipes and does not expose hidden teacher rows in single-row selection', () => {
  const sourceText = [
    '<div hidden>', '| 教師解答 | 分數 |', '| --- | --- |', '| 秘密 | 999 |', '</div>',
    '| 課程 | 定義 |', '| --- | --- |', '| SQL \\| NoSQL | 兩種資料庫 |',
    '| 網路 | 通訊 |',
  ].join('\r\n');
  render(<StudySourceTables text={sourceText} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }), { target: { value: '0' } });
  const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  expect(field.value).toBe('| SQL \\| NoSQL | 兩種資料庫 |');
  expect(field.value).not.toContain('秘密');
  expect(field.value).not.toContain('網路');
});

it('resets a previously selected row when a same-position source is replaced', () => {
  const old = ['| 科目 | 次數 |', '| --- | --- |', '| A | 1 |', '| B | 2 |'].join('\n');
  const replacement = ['| 科目 | 次數 |', '| --- | --- |', '| 新教材 | 7 |'].join('\n');
  const view = render(<StudySourceTables text={old} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const range = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }) as HTMLSelectElement;
  fireEvent.change(range, { target: { value: '1' } });
  view.rerender(<StudySourceTables text={replacement} />);
  const refreshed = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }) as HTMLSelectElement;
  const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  expect(refreshed.value).toBe('-1');
  expect(field.value).toBe(replacement);
  expect(field.value).not.toContain('| B | 2 |');
});

/** Restore the real browser property after each WebView clipboard simulation. */
async function withSourceClipboard(descriptor: PropertyDescriptor, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, ...descriptor });
  try {
    await run();
  } finally {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
}


it('copies an exact selected lesson row together with optional original headers, never hidden teacher rows', async () => {
  const original = [
    '<div hidden>',
    '| 教師未公布 | 數字 |',
    '| --- | --- |',
    '| 答案 | 999 |',
    '</div>',
    '| 課程 | 學分 |',
    '| :--- | ---: |',
    '| SQL \\| NoSQL | 3 |',
    '| 網路 | 2 |',
  ].join('\r\n');
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    render(<StudySourceTables text={original} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    const range = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' });
    fireEvent.change(range, { target: { value: '0' } });
    const option = screen.getByRole('checkbox', { name: '連同原文欄名與分隔列' }) as HTMLInputElement;
    expect(option.checked).toBe(false);
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toBe('| SQL \\| NoSQL | 3 |');
    fireEvent.click(option);
    const selected = ['| 課程 | 學分 |', '| :--- | ---: |', '| SQL \\| NoSQL | 3 |'];
    expect(field.value).toBe(selected.join('\n'));
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 1 列原文' }));
    expect(copy).toHaveBeenCalledWith(selected.join('\r\n'));
    expect(copy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('瀏覽器已接受複製指令'));
    fireEvent.change(range, { target: { value: '1' } });
    expect((screen.getByRole('checkbox', { name: '連同原文欄名與分隔列' }) as HTMLInputElement).checked).toBe(false);
    expect(field.value).toBe('| 網路 | 2 |');
  });
});

it('copies only the exact chosen source row and confirms only after a clipboard promise resolves', async () => {
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
      { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 2 列原文' }));
    expect(copy).toHaveBeenCalledWith('| 計算機概論 | 2 | 205 |');
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('瀏覽器已接受複製指令'));
  });
});

it('preserves selectable original source when the clipboard permission rejects', async () => {
  await withSourceClipboard({ value: {
    writeText: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
  } }, async () => {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('未確認複製'));
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toContain('| 資料庫 | 3 | 301 |');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});

it('does not claim success when a WebView clipboard getter throws or returns no promise', async () => {
  await withSourceClipboard({ get() { throw new DOMException('blocked', 'SecurityError'); } }, async () => {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    expect(() => fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }))).not.toThrow();
    expect(screen.getByRole('status').textContent).toContain('未確認複製');
  });
  await withSourceClipboard({ value: { writeText: () => undefined } }, async () => {
    render(<StudySourceTables text={source.replace('課堂資料', '本週資料')} />);
    fireEvent.click(screen.getAllByText('選取第 1 張表格的原文（可複製）')[1]);
    fireEvent.click(screen.getAllByRole('button', { name: '複製第 1 張表格原文' })[1]);
    expect(screen.getAllByRole('status')[1].textContent).toContain('未確認複製');
  });
});

it.each([
  { acknowledgement: false, label: 'false' },
  { acknowledgement: 0, label: '0' },
  { acknowledgement: null, label: 'null' },
  { acknowledgement: 'false', label: 'string false' },
  { acknowledgement: { success: false }, label: 'object failure' },
])('does not claim clipboard success for a WebView bridge returning $label', async ({ acknowledgement }) => {
  const copy = vi.fn(() => Promise.resolve(acknowledgement));
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    const view = render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
      { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 2 列原文' }));
    expect(copy).toHaveBeenCalledWith('| 計算機概論 | 2 | 205 |');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('未確認複製'));
    expect(screen.getByRole('status').textContent).not.toContain('已接受複製指令');
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toBe('| 計算機概論 | 2 | 205 |');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    view.unmount();
  });
});

it('accepts an explicit true acknowledgement without losing the manual source', async () => {
  await withSourceClipboard({ value: { writeText: () => Promise.resolve(true) } }, async () => {
    const view = render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已接受複製指令'));
    expect((screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement).value)
      .toContain('| 資料庫 | 3 | 301 |');
    view.unmount();
  });
});

it('ignores late clipboard success after the selected source row changes', async () => {
  let acknowledge: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { acknowledge = resolve; });
  await withSourceClipboard({ value: { writeText: () => pending } }, async () => {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    const choice = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' });
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
    fireEvent.change(choice, { target: { value: '1' } });
    await act(async () => { acknowledge?.(); await pending; });
    expect(screen.getByRole('status').textContent).toBe('');
    expect((screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement).value)
      .toBe('| 計算機概論 | 2 | 205 |');
  });
});

it('falls back to selectable source when WebView clipboard permission never settles', async () => {
  let acknowledge: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { acknowledge = resolve; });
  await withSourceClipboard({ value: { writeText: () => pending } }, async () => {
    vi.useFakeTimers();
    try {
      const view = render(<StudySourceTables text={source} />);
      fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
      fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
      expect(screen.getByRole('status').textContent).toContain('正在等待瀏覽器確認複製');
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(screen.getByRole('status').textContent).toContain('未確認複製');
      const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
      await act(async () => { acknowledge?.(); await pending; });
      expect(screen.getByRole('status').textContent).toContain('未確認複製');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('clears an unconfirmed clipboard timeout when the student changes source row', async () => {
  const pending = new Promise<void>(() => undefined);
  await withSourceClipboard({ value: { writeText: () => pending } }, async () => {
    vi.useFakeTimers();
    try {
      const view = render(<StudySourceTables text={source} />);
      fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
      const choice = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' });
      fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
      fireEvent.change(choice, { target: { value: '1' } });
      await act(async () => { vi.advanceTimersByTime(6000); });
      expect(screen.getByRole('status').textContent).toBe('');
      expect((screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement).value)
        .toBe('| 計算機概論 | 2 | 205 |');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('copies exact CRLF from the course table, not normalized textarea line endings', async () => {
  const crlfSource = source.replace(/\n/gu, '\r\n');
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    const view = render(<StudySourceTables text={crlfSource} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    const field = view.container.querySelector('textarea');
    expect(field?.value).not.toContain('\r');
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
    expect(copy).toHaveBeenCalledWith(source.split('\n').slice(1).join('\r\n'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('瀏覽器已接受複製指令'));
  });
});

it('repairs stale readonly WebView text before selecting and copying the authorized row', async () => {
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    const view = render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }), { target: { value: '1' } });
    const field = view.container.querySelector('textarea');
    expect(field).not.toBeNull();
    field!.value = '| 其他教材 | 999 |';
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 2 列原文' }));
    expect(field!.value).toBe('| 計算機概論 | 2 | 205 |');
    expect(copy).toHaveBeenCalledWith('| 計算機概論 | 2 | 205 |');
  });
});


it('exports the exact authorized CRLF table or chosen row as a local TXT blob', () => {
  const rawSource = source.replace(/\n/gu, '\r\n');
  const NativeBlob = Blob;
  const parts: BlobPart[][] = [];
  class TrackedBlob extends NativeBlob {
    constructor(blobParts: BlobPart[], options?: BlobPropertyBag) {
      super(blobParts, options);
      parts.push(blobParts);
    }
  }
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const create = vi.fn(() => 'blob:nuni-table-test');
  const revoke = vi.fn();
  const downloads: Array<{ filename: string; href: string }> = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href });
    expect(document.body.contains(this)).toBe(true);
  });
  vi.stubGlobal('Blob', TrackedBlob);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  vi.useFakeTimers();
  try {
    const view = render(<StudySourceTables text={rawSource} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.click(screen.getByRole('button', { name: '下載第 1 張表格原文 TXT' }));
    expect(parts[0]).toEqual([source.split('\n').slice(1).join('\r\n')]);
    expect(downloads[0]).toEqual({ filename: 'nuni-study-table-1.txt', href: 'blob:nuni-table-test' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('請確認下載項目');

    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
      { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '下載第 1 張表格第 2 列原文 TXT' }));
    expect(parts[1]).toEqual(['| 計算機概論 | 2 | 205 |']);
    expect(downloads[1]).toEqual({ filename: 'nuni-study-table-1-row-2.txt', href: 'blob:nuni-table-test' });
    expect(parts.every((entry) => entry.length === 1)).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(revoke).toHaveBeenCalledTimes(2);
    view.unmount();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    click.mockRestore();
    if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});

it('preserves the selectable source if local TXT download cannot start', () => {
  const previous = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => { throw new Error('WebView download blocked'); },
  });
  try {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.click(screen.getByRole('button', { name: '下載第 1 張表格原文 TXT' }));
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toContain('| 計算機概論 | 2 | 205 |');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.getByRole('status').textContent).toContain('無法啟動 TXT 下載');
  } finally {
    if (previous) Object.defineProperty(URL, 'createObjectURL', previous);
    else Reflect.deleteProperty(URL, 'createObjectURL');
  }
});


it.each([
  { name: 'undefined', returnedUrl: undefined },
  { name: 'empty', returnedUrl: '' },
  { name: 'incomplete blob scheme', returnedUrl: 'blob:' },
  { name: 'unexpected external URL', returnedUrl: 'https://example.invalid/not-a-local-export' },
])('keeps a manual TXT source without following a malformed $name download URL', ({ returnedUrl }) => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => returnedUrl),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  try {
    render(<StudySourceTables text={source} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.click(screen.getByRole('button', { name: '下載第 1 張表格原文 TXT' }));
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('無法啟動 TXT 下載');
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toContain('| 計算機概論 | 2 | 205 |');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  } finally {
    click.mockRestore();
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});


it.each([
  {
    label: 'classic Mac CR-only',
    material: source.replace(/\n/gu, '\r'),
    expected: source.split('\n').slice(1).join('\r'),
  },
  {
    label: 'mixed CR / CRLF / LF with a later paragraph',
    material: [
      '導言\r', '| 科目 | 學分 | 教室 |\r\n', '| :--- | ---: | --- |\n',
      '| 資料庫 | 3 | 301 |\r', '| 計算機概論 | 2 | 205 |\n', '後續段落不可複製',
    ].join(''),
    expected: [
      '| 科目 | 學分 | 教室 |\r\n', '| :--- | ---: | --- |\n',
      '| 資料庫 | 3 | 301 |\r', '| 計算機概論 | 2 | 205 |',
    ].join(''),
  },
])('copies verbatim $label course-table source without a stale or empty selection', async ({
  material, expected,
}) => {
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    expect(extractStudySourceTables(material)).toHaveLength(1);
    const view = render(<StudySourceTables text={material} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toContain('資料庫');
    expect(field.value).not.toContain('後續段落');
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格原文' }));
    expect(copy).toHaveBeenLastCalledWith(expected);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('瀏覽器已接受複製指令'));
    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
      { target: { value: '1' } });
    expect(field.value).toBe('| 計算機概論 | 2 | 205 |');
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 2 列原文' }));
    expect(copy).toHaveBeenLastCalledWith('| 計算機概論 | 2 | 205 |');
    view.unmount();
  });
});


it('shows the exact authorized source line beside each derived bar and updates it on lesson replacement', () => {
  const numeric = [
    '教材說明：這些數字均來自下表。',
    '',
    '| 課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
    '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={numeric} />);
  const valueMeters = Array.from(view.container.querySelectorAll('meter'));
  expect(valueMeters).toHaveLength(2);
  expect(valueMeters[0].closest('li')?.textContent).toContain('資料庫3原文第 5 行');
  expect(valueMeters[1].closest('li')?.textContent).toContain('網路2原文第 6 行');

  const percentages = [
    '另一份教材',
    '| 課程 | 完成率 |',
    '| --- | --- |',
    '| 資料庫 | 75% |',
    '| 網路 | 50% |',
  ].join('\n');
  view.rerender(<StudySourceTables text={percentages} />);
  const percentMeters = Array.from(view.container.querySelectorAll('meter'));
  expect(percentMeters).toHaveLength(2);
  expect(percentMeters[0].closest('li')?.textContent).toContain('資料庫75%原文第 4 行');
  expect(percentMeters[1].closest('li')?.textContent).toContain('網路50%原文第 5 行');
  expect(screen.queryByText('原文第 6 行')).toBeNull();
});

it('returns from numeric and percentage bars to the exact original row with keyboard focus', () => {
  const numeric = [
    '教材段落', '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={numeric} />);
  const jump = (label: string): HTMLButtonElement => {
    const button = Array.from(view.container.querySelectorAll('button'))
      .find((node) => node.textContent?.includes(label));
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  };
  const originalRows = () => Array.from(view.container.querySelectorAll('tbody tr'));
  const sourceBefore = originalRows().map((row) => row.textContent);
  fireEvent.click(jump('原文第 4 行 · 回表格核對'));
  expect(document.activeElement).toBe(originalRows()[0]);
  fireEvent.click(jump('原文第 5 行 · 回表格核對'));
  expect(document.activeElement).toBe(originalRows()[1]);
  expect(originalRows().map((row) => row.textContent)).toEqual(sourceBefore);

  const percentages = [
    '新版資料', '', '| 課程 | 完成率 |', '| --- | --- |',
    '| 新資料 | 80% |', '| 新網路 | 50% |',
  ].join('\n');
  view.rerender(<StudySourceTables text={percentages} />);
  fireEvent.click(jump('原文第 6 行 · 回表格核對'));
  expect(document.activeElement).toBe(originalRows()[1]);
  expect(document.activeElement?.textContent).toContain('新網路50%');
  expect(view.container.textContent).not.toContain('資料庫');
  view.unmount();
});


it('returns keyboard focus to the exact comparison button after inspecting a source row', () => {
  const material = [
    '閱讀前言', '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  fireEvent.click(screen.getByText('展開第 2 欄「學分」的原文數值比較'));
  const jump = screen.getByRole('button', { name: '原文第 4 行 · 回表格核對' });
  const firstRow = view.container.querySelector('tbody tr');
  expect(firstRow).not.toBeNull();
  fireEvent.click(jump);
  expect(document.activeElement).toBe(firstRow);
  const back = screen.getByRole('button', { name: '返回原文第 4 行的圖表' });
  if (!firstRow) throw new Error('Expected a source row for chart focus navigation');
  expect(firstRow.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(back);
  expect(document.activeElement).toBe(jump);
  expect(screen.queryByRole('button', { name: '返回原文第 4 行的圖表' })).toBeNull();
});

it('falls back to the first source cell when a mobile WebView cannot focus a table row', () => {
  const material = [
    '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const firstRow = view.container.querySelector('tbody tr');
  expect(firstRow).not.toBeNull();
  if (!firstRow) return;
  Object.defineProperty(firstRow, 'focus', { configurable: true, value: () => {} });
  fireEvent.click(screen.getByText('展開第 2 欄「學分」的原文數值比較'));
  fireEvent.click(screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' }));
  const firstCell = firstRow.querySelector('th');
  expect(firstCell?.tabIndex).toBe(-1);
  expect(document.activeElement).toBe(firstCell);
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 3 行的圖表' }));
  expect(document.activeElement?.textContent).toContain('原文第 3 行 · 回表格核對');
});

it('focuses the original table region when a WebView silently ignores row and cell focus', () => {
  const material = [
    '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const sourceRow = view.container.querySelector('tbody tr');
  const sourceCell = sourceRow?.querySelector('th');
  const region = sourceRow?.closest<HTMLElement>('[role="region"]');
  if (!sourceRow || !sourceCell || !region) throw new Error('Missing original table');
  Object.defineProperty(sourceRow, 'focus', { configurable: true, value: () => {} });
  Object.defineProperty(sourceCell, 'focus', { configurable: true, value: () => {} });
  fireEvent.click(screen.getByText('展開第 2 欄「學分」的原文數值比較'));
  const jump = screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' });
  fireEvent.click(jump);
  expect(document.activeElement).toBe(region);
  expect(region.getAttribute('aria-label')).toContain('原文表格 1');
  expect(sourceRow.textContent).toBe('資料庫3');
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 3 行的圖表' }));
  expect(document.activeElement).toBe(jump);
});

it('keeps the source and return action when row, cell and region focus all fail', () => {
  const material = [
    '| 課程 | 完成率 |', '| --- | --- |',
    '| 資料庫 | 75% |', '| 網路 | 50% |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const sourceRow = view.container.querySelector('tbody tr');
  const sourceCell = sourceRow?.querySelector('th');
  const region = sourceRow?.closest<HTMLElement>('[role="region"]');
  if (!sourceRow || !sourceCell || !region) throw new Error('Missing original table');
  for (const element of [sourceRow, sourceCell, region]) {
    Object.defineProperty(element, 'focus', {
      configurable: true,
      value: () => { throw new Error('WebView refused focus'); },
    });
  }
  fireEvent.click(screen.getByText('展開第 2 欄「完成率」的原文百分比（100% 滿格）'));
  const jump = screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' });
  expect(() => fireEvent.click(jump)).not.toThrow();
  expect(sourceRow.textContent).toBe('資料庫75%');
  expect(screen.getByRole('button', { name: '返回原文第 3 行的圖表' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 3 行的圖表' }));
  expect(document.activeElement).toBe(jump);
});

it('reopens a collapsed comparison to return from its exact authorized source row', () => {
  const material = [
    '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const summary = screen.getByText('展開第 2 欄「學分」的原文數值比較');
  const disclosure = summary.closest('details');
  expect(disclosure).not.toBeNull();
  if (!disclosure) throw new Error('Expected a comparison disclosure');
  disclosure.open = true;
  const jump = screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' });
  fireEvent.click(jump);
  const sourceRow = view.container.querySelector('tbody tr');
  expect(document.activeElement).toBe(sourceRow);
  // The user may close this disclosure while studying the original row.
  disclosure.open = false;
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 3 行的圖表' }));
  expect(disclosure.open).toBe(true);
  expect(document.activeElement).toBe(jump);
  expect(screen.queryByRole('button', { name: '返回原文第 3 行的圖表' })).toBeNull();
  expect(sourceRow?.textContent).toBe('資料庫3');
});

it('falls back to a comparison summary when a WebView rejects chart button focus', () => {
  const material = [
    '| 課程 | 完成率 |', '| --- | --- |',
    '| 資料庫 | 75% |', '| 網路 | 50% |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const summary = screen.getByText('展開第 2 欄「完成率」的原文百分比（100% 滿格）');
  const disclosure = summary.closest('details');
  expect(disclosure).not.toBeNull();
  if (!disclosure) throw new Error('Expected a percentage disclosure');
  disclosure.open = true;
  summary.setAttribute('tabindex', '0');
  const jump = screen.getByRole('button', { name: '原文第 4 行 · 回表格核對' });
  fireEvent.click(jump);
  expect(document.activeElement).toBe(view.container.querySelectorAll('tbody tr')[1]);
  Object.defineProperty(jump, 'focus', { configurable: true, value: () => { throw new Error('WebView focus refused'); } });
  disclosure.open = false;
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 4 行的圖表' }));
  expect(disclosure.open).toBe(true);
  expect(document.activeElement).toBe(summary);
  expect(view.container.querySelectorAll('tbody tr')[1]?.textContent).toBe('網路50%');
});

it('retains the return control when a WebView refuses both chart and summary focus', () => {
  const material = [
    '| 課程 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const summary = screen.getByText('展開第 2 欄「學分」的原文數值比較');
  const disclosure = summary.closest('details');
  if (!disclosure) throw new Error('Expected comparison disclosure');
  disclosure.open = true;
  const jump = screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' });
  fireEvent.click(jump);
  const sourceRow = view.container.querySelector('tbody tr');
  expect(document.activeElement).toBe(sourceRow);
  const back = screen.getByRole('button', { name: '返回原文第 3 行的圖表' });
  Object.defineProperty(jump, 'focus', { configurable: true, value: () => { throw new Error('chart focus blocked'); } });
  Object.defineProperty(summary, 'focus', { configurable: true, value: () => { throw new Error('summary focus blocked'); } });
  const scrollChart = vi.fn();
  const scrollSummary = vi.fn();
  Object.defineProperty(jump, 'scrollIntoView', { value: scrollChart });
  Object.defineProperty(summary, 'scrollIntoView', { value: scrollSummary });
  disclosure.open = false;
  fireEvent.click(back);
  expect(disclosure.open).toBe(true);
  expect(scrollChart).not.toHaveBeenCalled();
  expect(scrollSummary).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(sourceRow);
  // The student must not lose the only working return action after the focus
  // attempt fails. Native keyboard navigation can still reach this button.
  expect(screen.getByRole('button', { name: '返回原文第 3 行的圖表' })).toBe(back);
  expect(view.container.querySelector('tbody tr')?.textContent).toBe('資料庫3');
  Reflect.deleteProperty(jump, 'focus');
  Reflect.deleteProperty(summary, 'focus');
  fireEvent.click(back);
  expect(document.activeElement).toBe(jump);
  expect(scrollChart).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '返回原文第 3 行的圖表' })).toBeNull();
});

it('never shows a stale return-to-chart control after the authorized source changes', () => {
  const oldMaterial = [
    '| 舊課程 | 學分 |', '| --- | --- |',
    '| 舊課程一 | 3 |', '| 舊課程二 | 2 |',
  ].join('\n');
  const newMaterial = [
    '新教材前言', '| 新課程 | 學分 |', '| --- | --- |',
    '| 新課程一 | 4 |', '| 新課程二 | 1 |',
  ].join('\n');
  const view = render(<StudySourceTables text={oldMaterial} />);
  fireEvent.click(screen.getByText('展開第 2 欄「學分」的原文數值比較'));
  fireEvent.click(screen.getByRole('button', { name: '原文第 3 行 · 回表格核對' }));
  expect(screen.getByRole('button', { name: '返回原文第 3 行的圖表' })).toBeTruthy();
  view.rerender(<StudySourceTables text={newMaterial} />);
  expect(screen.queryByRole('button', { name: /返回原文第 .* 行的圖表/ })).toBeNull();
  fireEvent.click(screen.getByText('展開第 2 欄「學分」的原文數值比較'));
  fireEvent.click(screen.getByRole('button', { name: '原文第 4 行 · 回表格核對' }));
  expect(document.activeElement?.textContent).toContain('新課程一4');
  expect(screen.getByRole('button', { name: '返回原文第 4 行的圖表' })).toBeTruthy();
});

it.each([
  { header: '學分', values: ['3', '2'] },
  { header: '完成率', values: ['75%', '50%'] },
])('keeps same-named source rows separately navigable in the $header chart', ({ header, values }) => {
  const material = [
    '教材說明',
    '| 分類 | ' + header + ' |',
    '| --- | --- |',
    '| 必修 | ' + values[0] + ' |',
    '| 必修 | ' + values[1] + ' |',
  ].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const meters = Array.from(view.container.querySelectorAll('meter'));
  expect(meters).toHaveLength(2);
  expect(meters.map((bar) => bar.getAttribute('aria-label'))).toEqual([
    '必修：' + values[0] + '；教材原文第 4 行',
    '必修：' + values[1] + '；教材原文第 5 行',
  ]);
  // Row identity is the exact source line, not the repeated text label.
  expect(meters.map((bar) => bar.closest('li')?.textContent)).toEqual([
    '必修' + values[0] + '原文第 4 行 · 回表格核對',
    '必修' + values[1] + '原文第 5 行 · 回表格核對',
  ]);
  fireEvent.click(screen.getByText(/展開第 2 欄/));
  const jump = screen.getByRole('button', { name: '原文第 5 行 · 回表格核對' });
  fireEvent.click(jump);
  expect(document.activeElement).toBe(view.container.querySelectorAll('tbody tr')[1]);
  fireEvent.click(screen.getByRole('button', { name: '返回原文第 5 行的圖表' }));
  expect(document.activeElement).toBe(jump);
  // The two original source rows remain separate and unchanged.
  expect(Array.from(view.container.querySelectorAll('tbody tr')).map((row) => row.textContent))
    .toEqual(['必修' + values[0], '必修' + values[1]]);
  view.unmount();
});

it('compares English network transfer speeds without treating their rate unit as a percentage', () => {
  for (const header of [
    'Data Rate', 'Bit Rate', 'Transfer Rate', 'Transmission Rate',
    'Download Rate', 'Upload Rate', 'Network Rate', 'Link Rate',
    'Baud Rate', 'Sample Rate', 'Data Rate (Mbps)', 'Download Rate (MB/s)',
  ]) {
    const original = ['| 連線 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2.50 |', '| 乙 | 4.00 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={original} />);
    expect(comparisonSummaries(container)).toEqual([
      '展開第 2 欄「' + header + '」的原文數值比較',
    ]);
    expect(Array.from(container.querySelectorAll('meter')).map(bar => [
      bar.getAttribute('value'), bar.getAttribute('max'), bar.getAttribute('aria-valuetext'),
    ])).toEqual([
      ['2.5', '4', '2.50；本欄最大值 4.00'],
      ['4', '4', '4.00；本欄最大值 4.00'],
    ]);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['2.50', '4.00']);
    unmount();
  }
});

it('does not treat English business rates or explicit percent-unit speed rates as plain amounts', () => {
  for (const header of [
    'Rate', 'Exchange Rate', 'Interest Rate', 'Error Rate', 'Success Rate',
    'Conversion Rate', 'Growth Rate', 'Data Rate (%)',
    'Download Rate (%)', 'Data Rate Percent', 'Data Rate / Error Rate',
  ]) {
    const original = ['| 連線 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 2 |', '| 乙 | 4 |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={original} />);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['2', '4']);
    unmount();
  }
  // Only literal percentages, never bare figures, can produce a fixed 100% chart.
  const literalPercent = ['| 連線 | Download Rate (%) |', '| --- | --- |',
    '| 甲 | 20% |', '| 乙 | 40% |'].join('\n');
  const { container } = render(<StudySourceTables text={literalPercent} />);
  expect(Array.from(container.querySelectorAll('meter')).map(bar =>
    [bar.getAttribute('value'), bar.getAttribute('max')]))
    .toEqual([['20', '100'], ['40', '100']]);
});

it('keeps fiscal quarter positions as source-only ordinals', () => {
  for (const header of [
    '季度', '季別', '季次', '第幾季', '第幾季度', '季度序號',
    '財務季度', '會計季度', '季度編號', '季度代碼',
    'Quarter', 'Qtr', 'Quarter Number', 'Quarter ID',
    'Fiscal Quarter', 'Calendar Quarter', 'Academic Qtr',
  ]) {
    const original = [
      '| 科目 | ' + header + ' |', '| --- | --- |',
      '| 經濟學 | 1 |', '| 管理學 | 4 |',
    ].join('\n');
    const view = render(<StudySourceTables text={original} />);
    expect(comparisonSummaries(view.container)).toEqual([]);
    expect(view.container.querySelector('meter')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['1', '4']);
    view.unmount();
  }
});

it('still compares actual counts of quarters and quarterly quantities', () => {
  for (const header of [
    '季度數量', '季度總數', '季度營收', '每季教學時數',
    'Quarter Count', 'Number of Quarters', 'Quarterly Revenue', 'Fiscal Quarter Total',
  ]) {
    const original = [
      '| 科目 | ' + header + ' |', '| --- | --- |',
      '| 經濟學 | 2 |', '| 管理學 | 4 |',
    ].join('\n');
    const view = render(<StudySourceTables text={original} />);
    expect(comparisonSummaries(view.container)).toEqual([
      '展開第 2 欄「' + header + '」的原文數值比較',
    ]);
    expect(Array.from(view.container.querySelectorAll('meter')).map((node) =>
      [node.getAttribute('value'), node.getAttribute('max')])).toEqual([
      ['2', '4'], ['4', '4'],
    ]);
    view.unmount();
  }
});

it('does not draw ratio bars from numeric weekdays in class schedules', () => {
  for (const header of [
    '星期', '星期幾', '禮拜幾', '上課星期', '開課週別', '週幾', '周序號',
    '考試星期', 'Weekday', 'Weekday Number', 'Week Day',
    'Day of Week', 'Day of the Week', 'Day-of-Week (ISO 8601)', 'Class Day of Week',
  ]) {
    const material = [
      '| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 1 |', '| 網路概論 | 5 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(comparisonSummaries(container)).toEqual([]);
    expect(container.querySelector('meter')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('cell').map(cell => cell.textContent))
      .toEqual(['1', '5']);
    unmount();
  }
});

it('retains real weekday counts and study-hour quantities as source comparisons', () => {
  for (const header of [
    '每週上課天數', '星期數量', '上課天數', 'Number of Weekdays',
    'Weekday Count', 'Study Hours', 'Lab Hours', '出席天數', 'Day Count',
  ]) {
    const material = [
      '| 課程 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 2 |', '| 網路概論 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(comparisonSummaries(container)).toEqual([
      '展開第 2 欄「' + header + '」的原文數值比較',
    ]);
    expect(Array.from(container.querySelectorAll('meter')).map(item => [
      item.getAttribute('value'), item.getAttribute('max'),
    ])).toEqual([['2', '4'], ['4', '4']]);
    unmount();
  }
});


it('keeps the original table but omits derived bars for invisible row labels', () => {
  for (const label of ['\u200b', '\u2800', '\u0301', '\u200e\u200f']) {
    for (const [heading, first, second] of [
      ['學習時數', '3', '5'],
      ['完成率', '30%', '50%'],
    ]) {
      const markdown = [
        '| 項目 | ' + heading + ' |', '| --- | --- |',
        '| ' + label + ' | ' + first + ' |', '| 完整標籤 | ' + second + ' |',
      ].join('\n');
      const view = render(<StudySourceTables text={markdown} />);
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
      expect(comparisonSummaries(view.container)).toEqual([]);
      expect(screen.getByText(second)).toBeTruthy();
      view.unmount();
    }
  }
});

it('keeps comparisons for visible CJK, emoji, math and Braille row labels', () => {
  for (const label of ['資料庫', '👩‍💻', '數學−', '⠁']) {
    for (const [heading, first, second] of [
      ['學習時數', '3', '5'],
      ['完成率', '30%', '50%'],
    ]) {
      const markdown = [
        '| 項目 | ' + heading + ' |', '| --- | --- |',
        '| ' + label + ' | ' + first + ' |', '| 對照 | ' + second + ' |',
      ].join('\n');
      const view = render(<StudySourceTables text={markdown} />);
      expect(comparisonSummaries(view.container)).toHaveLength(1);
      expect(screen.getByRole('table')).toBeTruthy();
      view.unmount();
    }
  }
});


it('does not derive numeric or percentage charts from visually reordered Unicode labels', () => {
  // These controls can reverse a displayed label even when its raw source
  // contains meaningful letters. The verbatim table must remain available.
  const controls = ['\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
  for (const [heading, values] of [
    ['金額', ['100', '200']],
    ['出席率', ['25%', '75%']],
  ] as const) {
    for (const control of controls) {
      for (const inHeader of [false, true]) {
        const column = inHeader ? heading + control : heading;
        const firstLabel = inHeader ? '班級A' : '班級' + control + 'A';
        const text = [
          '| 項目 | ' + column + ' |',
          '| --- | --- |',
          '| ' + firstLabel + ' | ' + values[0] + ' |',
          '| 班級B | ' + values[1] + ' |',
        ].join('\n');
        const view = render(<StudySourceTables text={text} />);
        const table = within(view.container).getByRole('table');
        expect(within(table).getByText(firstLabel)).toBeTruthy();
        expect(within(table).getByText(values[0])).toBeTruthy();
        expect(within(table).getByText(values[1])).toBeTruthy();
        expect(comparisonSummaries(view.container)).toEqual([]);
        view.unmount();
      }
    }
  }
});

it('still allows charts for readable RTL names, ordinary Chinese and complete emoji without direction controls', () => {
  for (const [heading, values] of [
    ['金額', ['100', '200']],
    ['出席率', ['25%', '75%']],
  ] as const) {
    const text = [
      '| 項目 | ' + heading + ' |',
      '| --- | --- |',
      '| العربية | ' + values[0] + ' |',
      '| 👩‍💻 עברית | ' + values[1] + ' |',
    ].join('\n');
    const view = render(<StudySourceTables text={text} />);
    expect(comparisonSummaries(view.container)).toHaveLength(1);
    expect(within(view.container).getByRole('table')).toBeTruthy();
    view.unmount();
  }
});


it('announces exact original lines for full-table, chosen row, and row plus headers', () => {
  const lesson = [
    '前言', '| 科目 | 學分 |', '| --- | --- |',
    '| 資料庫 | 3 |', '| 網路 | 2 |', '後記',
  ].join('\r\n');
  const view = render(<StudySourceTables text={lesson} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const message = view.container.querySelector('[aria-live="polite"][aria-atomic="true"]');
  expect(message?.textContent?.trim()).toBe(
    '目前選取整張表格：原文第 2 至 5 行，包含欄名、分隔列與全部資料列。',
  );
  fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
    { target: { value: '1' } });
  expect(message?.textContent?.trim()).toBe(
    '目前只選取第 2 列：原文第 5 行資料列，未包含欄名與分隔列。',
  );
  const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  expect(field.value).toBe('| 網路 | 2 |');
  fireEvent.click(screen.getByRole('checkbox', { name: '連同原文欄名與分隔列' }));
  expect(message?.textContent?.trim()).toBe(
    '目前選取第 2 列：原文第 2、3 行欄名與分隔列，以及第 5 行資料列；不包含其他資料列。',
  );
  expect(field.value).toBe(['| 科目 | 學分 |', '| --- | --- |', '| 網路 | 2 |'].join('\n'));
  expect(field.value).not.toContain('| 資料庫 | 3 |');

  // A new authorized source must reset the announcement and selected excerpt.
  view.rerender(<StudySourceTables text={
    ['新教材', '| 科目 | 次數 |', '| --- | --- |', '| 新課 | 8 |'].join('\n')
  } />);
  expect(message?.textContent?.trim()).toBe(
    '目前選取整張表格：原文第 2 至 4 行，包含欄名、分隔列與全部資料列。',
  );
  expect(field.value).toBe(['| 科目 | 次數 |', '| --- | --- |', '| 新課 | 8 |'].join('\n'));
});

it('makes each numeric and percentage meter announce its precise original source-line action', () => {
  // A screen reader jumping directly between meter controls otherwise misses
  // the provenance button, particularly for unique row labels.
  for (const [heading, first, second] of [
    ['學習時數', '3', '5'],
    ['出席率', '30%', '50%'],
  ] as const) {
    const lesson = [
      '教材前言',
      '| 項目 | ' + heading + ' |',
      '| --- | --- |',
      '| 資料庫 | ' + first + ' |',
      '| 網路 | ' + second + ' |',
    ].join('\n');
    const view = render(<StudySourceTables text={lesson} />);
    const meters = Array.from(view.container.querySelectorAll('meter'));
    expect(meters).toHaveLength(2);
    const descriptionIds = meters.map((meter) => meter.getAttribute('aria-describedby'));
    expect(descriptionIds[0]).toBeTruthy();
    expect(new Set(descriptionIds).size).toBe(2);
    for (const [index, meter] of meters.entries()) {
      const sourceButton = Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.id === meter.getAttribute('aria-describedby'));
      expect(sourceButton?.textContent?.trim()).toBe('原文第 ' + (index + 4) + ' 行 · 回表格核對');
      expect(meter.getAttribute('aria-label')).toContain(index === 0 ? first : second);
    }

    // Rerendering a different authorized lesson must not leave accessible
    // descriptions pointing to the previous lesson's line numbers.
    view.rerender(<StudySourceTables text={[
      '新的教材前言', '第二行', '第三行',
      '| 項目 | ' + heading + ' |', '| --- | --- |',
      '| 資料庫 | ' + first + ' |', '| 網路 | ' + second + ' |',
    ].join('\n')} />);
    const revisedMeters = Array.from(view.container.querySelectorAll('meter'));
    expect(revisedMeters).toHaveLength(2);
    for (const [index, meter] of revisedMeters.entries()) {
      const sourceButton = Array.from(view.container.querySelectorAll('button'))
        .find((button) => button.id === meter.getAttribute('aria-describedby'));
      expect(sourceButton?.textContent?.trim()).toBe('原文第 ' + (index + 6) + ' 行 · 回表格核對');
      expect(meter.getAttribute('aria-describedby')).toBeTruthy();
    }
    view.unmount();
  }
});


it('adds optional non-contiguous source-line evidence to copied study excerpts without unrelated rows', async () => {
  const lesson = [
    '本週課程',
    '| 課程 | 學分 |',
    '| :--- | ---: |',
    '| SQL \\| NoSQL | 3 |',
    '| 統計 | 2 |',
    '| 網路 | 1 |',
  ].join('\r\n');
  const copy = vi.fn(() => Promise.resolve());
  await withSourceClipboard({ value: { writeText: copy } }, async () => {
    const view = render(<StudySourceTables text={lesson} />);
    fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
    fireEvent.change(screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' }),
      { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '連同原文欄名與分隔列' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '摘錄開頭加上教材原文行號（註記非原文）' }));
    const expected = [
      '[教材原文第 2、3、6 行（非連續）]',
      '| 課程 | 學分 |',
      '| :--- | ---: |',
      '| 網路 | 1 |',
    ].join('\r\n');
    const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
    expect(field.value).toBe(expected.replace(/\r\n/gu, '\n'));
    expect(field.value).not.toContain('| 統計 | 2 |');
    fireEvent.click(screen.getByRole('button', { name: '複製第 1 張表格第 3 列原文' }));
    expect(copy).toHaveBeenCalledWith(expected);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('瀏覽器已接受複製指令'));
    view.unmount();
  });
});

it('switches citation between full table, adjacent first row and exact single row, resetting on source replacement', () => {
  const lesson = ['| 科目 | 學分 |', '| --- | --- |', '| A | 3 |', '| B | 2 |'].join('\n');
  const view = render(<StudySourceTables text={lesson} />);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  const field = screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement;
  const citation = screen.getByRole('checkbox', { name: '摘錄開頭加上教材原文行號（註記非原文）' });
  const range = screen.getByRole('combobox', { name: '第 1 張表格的原文選取範圍' });
  expect(field.value).toBe(lesson);
  fireEvent.click(citation);
  expect(field.value).toBe('[教材原文第 1 至 4 行]\n' + lesson);
  fireEvent.change(range, { target: { value: '0' } });
  expect(field.value).toBe('[教材原文第 3 行]\n| A | 3 |');
  fireEvent.click(screen.getByRole('checkbox', { name: '連同原文欄名與分隔列' }));
  expect(field.value).toBe('[教材原文第 1 至 3 行]\n| 科目 | 學分 |\n| --- | --- |\n| A | 3 |');
  fireEvent.change(range, { target: { value: '1' } });
  expect(field.value).toBe('[教材原文第 4 行]\n| B | 2 |');
  fireEvent.click(citation);
  expect(field.value).toBe('| B | 2 |');
  view.rerender(<StudySourceTables text={lesson.replace('| A | 3 |', '| C | 4 |')} />);
  expect((screen.getByRole('checkbox', { name: '摘錄開頭加上教材原文行號（註記非原文）' }) as HTMLInputElement).checked).toBe(false);
  expect(field.value).toContain('| C | 4 |');
  view.unmount();
});


it.each([
  { header: '完成率', values: ['７５％', '２５％'], expected: ['75', '25'] },
  { header: '正確率', values: ['７５．５０％', '０％'], expected: ['75.5', '0'] },
  { header: 'Completion Rate', values: ['１００．００%', '９９．５％'], expected: ['100', '99.5'] },
])('keeps fullwidth percentage source bytes while comparing against a fixed 100% ($header)', ({ header, values, expected }) => {
  const material = ['| 科目 | ' + header + ' |', '| --- | --- |',
    '| 資料庫 | ' + values[0] + ' |', '| 網路 | ' + values[1] + ' |'].join('\n');
  const view = render(<StudySourceTables text={material} />);
  const meters = Array.from(view.container.querySelectorAll('meter'));
  expect(meters.map((bar) => bar.getAttribute('value'))).toEqual(expected);
  expect(meters.map((bar) => bar.getAttribute('max'))).toEqual(['100', '100']);
  expect(meters.map((bar) => bar.getAttribute('aria-valuetext'))).toEqual(
    values.map((source) => source + '；滿格 100%'),
  );
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(values);
  fireEvent.click(screen.getByText('選取第 1 張表格的原文（可複製）'));
  expect((screen.getByRole('textbox', { name: '原文表格 1 的可選取文字' }) as HTMLTextAreaElement).value)
    .toBe(material);
  expect(meters[0].getAttribute('aria-describedby')).toBeTruthy();
  view.unmount();
});

it.each([
  ['１００．０１％', '９９％'], // Greater than 100
  ['０１％', '１０％'], // Leading zero
  ['７５.５％', '５０％'], // Mixed decimal punctuation
  ['７5％', '５０％'], // Mixed digits within one value
  ['７５％', '25%'], // Mixed digit formats in one table
  ['７５％', '５０．１２３％'], // Unsupported precision
  ['７５  ％', '５０％'], // Two inserted spaces remain ambiguous; one is intentionally supported
])('retains invalid or ambiguous fullwidth percentage source without derived meters (%s, %s)', (first, second) => {
  const material = ['| 科目 | 完成率 |', '| --- | --- |',
    '| 資料庫 | ' + first + ' |', '| 網路 | ' + second + ' |'].join('\n');
  const view = render(<StudySourceTables text={material} />);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(comparisonSummaries(view.container)).toEqual([]);
  expect(view.container.querySelector('meter')).toBeNull();
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual([first, second]);
  view.unmount();
});

it('does not depict source line, data row or procedural step positions as magnitudes', () => {
  const positionHeaders = [
    '行號', '列號', '資料行號', '原始碼行號', '操作步驟', '步驟編號', '步序號',
    'Line Number', 'Source Line', 'Row No.', 'Record Number',
    'Step Index', 'Data Row ID', 'Code Line (Python)',
  ];
  for (const header of positionHeaders) {
    const lesson = [
      '| 教材 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 2 |', '| 網路 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={lesson} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['2', '4']);
    expect(container.querySelectorAll('meter')).toHaveLength(0);
    expect(comparisonSummaries(container)).toEqual([]);
    unmount();
  }
});

it.each([
  '程式碼行數', '資料列數', '步驟數量', '步驟總數',
  'Lines of Code', 'Number of Lines of Code', 'Count of Lines of Code',
  'Line Count', 'Row Count', 'Number of Steps', 'Step Count', 'Record Count',
])('still compares explicit quantities of lines, rows and steps (%s)', (header) => {
  const lesson = [
    '| 教材 | ' + header + ' |', '| --- | --- |',
    '| 資料庫 | 2 |', '| 網路 | 4 |',
  ].join('\n');
  const { container, unmount } = render(<StudySourceTables text={lesson} />);
  expect(Array.from(container.querySelectorAll('meter'))
    .map((bar) => [bar.getAttribute('value'), bar.getAttribute('max')]))
    .toEqual([['2', '4'], ['4', '4']]);
  unmount();
});

it.each(['Course Code', 'Verification Code', 'Code', 'Student ID'])
  ('keeps identifiers as source text without derived quantity bars (%s)', (header) => {
    const lesson = [
      '| 教材 | ' + header + ' |', '| --- | --- |',
      '| 資料庫 | 2 |', '| 網路 | 4 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={lesson} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  });

it.each([
  '郵遞區碼', '郵遞編碼', '郵政區碼', '郵政編碼', '郵編', '郵遞區碼（臺灣）',
  'Postcode', 'Post Code', 'Post-Code', 'ZIP', 'ZIP Code', 'ZIP (US)',
])('retains postal identifiers without implying a numerical ratio (%s)', (header) => {
  // Numeric 100 and 200 would produce a false 2x meter without the guard.
  const lesson = [
    '| 收件區域 | ' + header + ' |', '| --- | --- |',
    '| 甲區 | 100 |', '| 乙區 | 200 |',
  ].join('\n');
  const { container, unmount } = render(<StudySourceTables text={lesson} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(['100', '200']);
  expect(comparisonSummaries(container)).toEqual([]);
  expect(container.querySelectorAll('meter')).toHaveLength(0);
  unmount();
});

it.each([
  'Serial Number', 'Serial No.', 'Invoice Number', 'Order No.', 'Order Number (ERP)',
  'Transaction ID', 'Receipt #', 'Tracking Number', 'Reference Number',
  '發票號碼', '訂單號', '交易號碼', '收據號', '流水號', '物流單號',
])('keeps document and purchase identifiers as exact source text, not 2x quantity bars (%s)', (header) => {
  const source = [
    '| 項目 | ' + header + ' |', '| --- | --- |',
    '| 甲 | 100 |', '| 乙 | 200 |',
  ].join('\n');
  const { container, unmount } = render(<StudySourceTables text={source} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
    .toEqual(['100', '200']);
  expect(comparisonSummaries(container)).toEqual([]);
  expect(container.querySelectorAll('meter')).toHaveLength(0);
  unmount();
});

it.each([
  'Order Count', 'Number of Orders', 'Invoice Count', 'Transaction Total',
  '訂單數量', '發票張數', '交易筆數', 'Invoice Amount',
])('still permits genuine counts and amounts beside document identifiers (%s)', (header) => {
  const source = [
    '| 組別 | ' + header + ' |', '| --- | --- |',
    '| 甲 | 100 |', '| 乙 | 200 |',
  ].join('\n');
  const { container, unmount } = render(<StudySourceTables text={source} />);
  expect(Array.from(container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
    .toEqual([[100, 200], [200, 200]]);
  unmount();
});

it.each(['寄送件數', '郵件件數', 'Parcel Count'])(
  'still compares genuine delivered-item quantities (%s)', (header) => {
    const lesson = [
      '| 區域 | ' + header + ' |', '| --- | --- |',
      '| 甲區 | 100 |', '| 乙區 | 200 |',
    ].join('\n');
    const { container, unmount } = render(<StudySourceTables text={lesson} />);
    expect(Array.from(container.querySelectorAll('meter')).map((meter) =>
      [meter.getAttribute('value'), meter.getAttribute('max')]))
      .toEqual([['100', '200'], ['200', '200']]);
    unmount();
  },
);

it.each([
  '滿意度（%）', '完成狀況（%）', '服務等級佔比', '評級百分比', 'Satisfaction (%)',
  'Percentage by Risk Level', 'Rating (%)', '風險等級（％）',
])('charts the measured percentage on a fixed scale (%s)', (header) => {
  const material = ['| 組別 | ' + header + ' |', '| --- | --- |',
    '| 甲 | 25% |', '| 乙 | 75% |'].join('\n');
  const view = render(<StudySourceTables text={material} />);
  expect(Array.from(view.container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
    .toEqual([[25, 100], [75, 100]]);
  view.unmount();
});

it.each(['文件編號（%）', '訂單編號（%）', 'Serial Number (%)', 'Order Number (ERP) (%)'])(
  'does not chart identifiers even when the header and values use percent signs (%s)', (header) => {
    const material = ['| 組別 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 25% |', '| 乙 | 75% |'].join('\n');
    const { container, unmount } = render(<StudySourceTables text={material} />);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['25%', '75%']);
    expect(container.querySelector('meter')).toBeNull();
    unmount();
  },
);

it.each([
  ['百分位', ['25', '75']],
  ['第 75 百分位數', ['25', '75']],
  ['百分等級', ['25', '75']],
  ['Percentile Rank', ['25', '75']],
  ['Percentile Score', ['25', '75']],
  ['百分位 (%)', ['25%', '75%']],
  ['Percentile (%)', ['25%', '75%']],
  ['百分等級完成率', ['25%', '75%']],
  ['Percentile Count (%)', ['25%', '75%']],
])('retains source %s without a misleading ratio-scale percentile chart', (header, values) => {
  const material = ['| 學生 | ' + header + ' |', '| --- | --- |',
    '| 甲 | ' + values[0] + ' |', '| 乙 | ' + values[1] + ' |'].join('\n');
  const view = render(<StudySourceTables text={material} />);
  expect(within(screen.getByRole('table')).getAllByRole('cell')
    .map((cell) => cell.textContent)).toEqual(values);
  expect(comparisonSummaries(view.container)).toEqual([]);
  expect(view.container.querySelector('meter')).toBeNull();
  view.unmount();
});

it.each(['百分位人數', '百分等級的總數', 'Percentile Count', 'Percentile Rank Count', 'Number of Percentiles'])(
  'keeps explicit counts comparable even when the header mentions percentiles (%s)', (header) => {
    const material = ['| 組別 | ' + header + ' |', '| --- | --- |',
      '| 甲 | 20 |', '| 乙 | 40 |'].join('\n');
    const view = render(<StudySourceTables text={material} />);
    expect(Array.from(view.container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
      .toEqual([[20, 40], [40, 40]]);
    expect(within(screen.getByRole('table')).getAllByRole('cell')
      .map((cell) => cell.textContent)).toEqual(['20', '40']);
    view.unmount();
  },
);

it.each([
  '提交日期別完成率', '依截止日期統計完成率', '按繳交期間統計完成率',
  '開課週別通過率', '到期日別達成率', '截止時間別完成率',
  'Pass Rate by Due Date', 'Pass Rate per Reporting Period',
  'Completion Rate each Week', 'Completion Rate by Day of Month',
  'Pass Rate per Timestamp Window',
])('matches merge-base 100%% meters for grouped percentages in %s', (header) => {
  const table = (values: string[]) => [
    '| 組別 | ' + header + ' |', '| --- | --- |',
    '| 甲 | ' + values[0] + ' |', '| 乙 | ' + values[1] + ' |',
  ].join('\n');
  const { container, rerender } = render(<StudySourceTables text={table(['25%', '75%'])} />);
  expect(Array.from(container.querySelectorAll('meter')).map((meter) => [meter.value, meter.max]))
    .toEqual([[25, 100], [75, 100]]);
  for (const values of [['2026-11-19', '2026-11-20'], ['11/19', '11/20'], ['第 2 週', '第 4 週']]) {
    rerender(<StudySourceTables text={table(values)} />);
    expect(container.querySelector('meter')).toBeNull();
    expect(screen.getByRole('table').textContent).toContain(values[0]);
  }
});


it('preserves source tables but skips charts with corrupt Unicode or control-code labels', () => {
  // Derived charts require stable labels. Original licensed text stays intact.
  const unsafeLabels = [
    '班級\uD800A', '班級\uDC00A', '\uD800班級',
    '班級\u0000A', '班級\u001BA', '班級\u007FA',
  ];
  for (const label of unsafeLabels) {
    for (const [metric, first, second] of [
      ['學習時數', '3', '5'],
      ['完成率', '30%', '50%'],
    ]) {
      for (const inHeader of [false, true]) {
        const heading = inHeader ? metric + label : metric;
        const row = inHeader ? '班級A' : label;
        const text = [
          '| 組別 | ' + heading + ' |', '| --- | --- |',
          '| ' + row + ' | ' + first + ' |', '| 班級B | ' + second + ' |',
        ].join('\n');
        const view = render(<StudySourceTables text={text} />);
        const table = screen.getByRole('table');
        expect(table.textContent).toContain(heading);
        expect(table.textContent).toContain(row);
        expect(table.textContent).toContain(first);
        expect(table.textContent).toContain(second);
        expect(comparisonSummaries(view.container)).toEqual([]);
        view.unmount();
      }
    }
  }
});

it('keeps intact emoji, RTL text and combining accents in chart labels', () => {
  for (const label of ['👩‍💻', '🇹🇼', 'עברית', 'e\u0301', '⠁']) {
    const text = [
      '| 組別 | 學習時數 |', '| --- | --- |',
      '| ' + label + ' | 3 |', '| 對照 | 5 |',
    ].join('\n');
    const view = render(<StudySourceTables text={text} />);
    expect(comparisonSummaries(view.container)).toHaveLength(1);
    expect(Array.from(view.container.querySelectorAll('meter'), (meter) => [meter.value, meter.max]))
      .toEqual([[3, 5], [5, 5]]);
    view.unmount();
  }
});
