// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractStudySourceTables } from './studySourceTables';

const visibleTable = [
  '| 課程 | 學分 |',
  '| --- | --- |',
  '| 資料庫 | 3 |',
];
const realTable = (startLine: number) => [{
  startLine,
  headers: ['課程', '學分'],
  rows: [['資料庫', '3']],
}];

describe('raw HTML figures and tables are not source Markdown tables', () => {
  it.each([
    { label: 'SVG graphic', open: '<svg viewBox="0 0 20 20">', close: '</svg>' },
    { label: 'MathML formula', open: '<math><mrow>', close: '</math>' },
    { label: 'HTML table', open: '<table><tbody>', close: '</table>' },
  ])('ignores fabricated rows inside a $label while retaining later real rows', ({ open, close }) => {
    const source = [
      open,
      '| 虛構課程 | 學分 |',
      '| --- | --- |',
      '| 假資料 | 99 |',
      close,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not let a self-closing SVG hide a following real source table', () => {
    const source = ['<svg viewBox="0 0 20 20" />', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('treats a literal SVG tag inside paired Markdown backticks as text', () => {
    const source = ['使用 `<svg>` 是程式碼說明，不是實際圖片。', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('does not display a table found only inside an SVG or HTML table', () => {
    const source = [
      '<svg>',
      '| 虛構 | 學分 |',
      '| --- | --- |',
      '| 想像 | 99 |',
      '</svg>',
      '<table>',
      '| 另一筆假資料 | 學分 |',
      '| --- | --- |',
      '| 想像 | 77 |',
      '</table>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([]);
  });
});


it('does not reveal hidden HTML course rows after an inner div closes', () => {
  const source = [
    '<div hidden>',
    '<div class="example">',
    '| 未發布科目 | 分數 |',
    '| --- | --- |',
    '| 假資料 | 999 |',
    '</div>',
    '| 仍然隱藏 | 分數 |',
    '| --- | --- |',
    '| 測試 | 888 |',
    '</div>',
    '| 正式課程 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual([{
    startLine: 11,
    headers: ['正式課程', '學分'],
    rows: [['資料庫', '3']],
  }]);
});

it('omits aria-hidden course samples without hiding the later visible Markdown table', () => {
  const source = [
    '<section aria-hidden="true">',
    '| 未公開結果 | 分數 |',
    '| --- | --- |',
    '| 範例 | 999 |',
    '</section>',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(6));
});

it('does not activate literal hidden tags in inline code or data-hidden attributes', () => {
  const source = [
    'HTML 課以 `<div hidden>` 為例。',
    '<div data-hidden="example">',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(3));
});
