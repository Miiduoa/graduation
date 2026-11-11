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
  expect(within(table).getByText('301')).toBeTruthy();
  expect(screen.getByRole('region', { name: /可左右捲動/ }).getAttribute('tabindex')).toBe('0');
});

it('does not render a guessed table for missing cells, escaped pipes or ordinary prose', () => {
  const invalid = [
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 | 教室301 |',
    '這不是表格，只有 | 隨意分隔的句子。',
    '| 章節 | 概念 |',
    '| --- | --- |',
    '| SQL \\| NoSQL | 資料庫 |',
  ].join('\n');
  expect(extractStudySourceTables(invalid)).toEqual([]);
  const view = render(<StudySourceTables text={invalid} />);
  expect(view.queryByRole('table')).toBeNull();
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
    '| SQL \\| NoSQL | 4 |',
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
