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
