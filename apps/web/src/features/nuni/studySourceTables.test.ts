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


describe('collapsible HTML lesson answers are not public source Markdown tables', () => {
  it('does not reveal an answer inside closed nested details after an inner details ends', () => {
    const source = [
      '<details>',
      '<summary>課堂練習解答</summary>',
      '<details>',
      '| 模擬答案 | 分數 |',
      '| --- | --- |',
      '| 不應額外呈現 | 999 |',
      '</details>',
      '| 外層仍收合 | 分數 |',
      '| --- | --- |',
      '| 尚未展開 | 888 |',
      '</details>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(12));
  });

  it('does not reconstruct source tables inside HTML dialog or even an open disclosure', () => {
    for (const wrapper of [
      ['<dialog>', '</dialog>'],
      ['<details open>', '</details>'],
    ]) {
      const source = [
        wrapper[0],
        '| 互動區內部範例 | 學分 |',
        '| --- | --- |',
        '| 非獨立表格 | 99 |',
        wrapper[1],
        ...visibleTable,
      ].join('\n');
      expect(extractStudySourceTables(source)).toEqual(realTable(6));
    }
  });

  it('does not activate details or dialog tags mentioned only as inline code', () => {
    const source = ['HTML 教學以 `<details>` 和 `<dialog>` 為例。', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

it('does not turn hidden inline HTML cells into visible study-source data', () => {
  const source = [
    '| 課程 | 備註 |',
    '| --- | --- |',
    '| 資料庫 | <span hidden>尚未公告的成績</span> |',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(4));
});

it('does not treat HTML-like text inside Markdown inline code as a hidden wrapper close', () => {
  const source = [
    '<details>',
    '使用 `</details>` 示範如何關閉答案。',
    '| 未公開結果 | 分數 |',
    '| --- | --- |',
    '| 仍在收合區 | 999 |',
    '</details>',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(7));
});

it('keeps a simple comparison expression in a genuine Markdown table', () => {
  const source = [
    '| 概念 | 公式 |',
    '| --- | --- |',
    '| 比較 | x < y |',
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual([{
    startLine: 1,
    headers: ['概念', '公式'],
    rows: [['比較', 'x < y']],
  }]);
});

it('does not let an escaped backtick hide a real HTML comment and expose fake rows', () => {
  const tick = String.fromCharCode(96);
  const source = [
    '教師備註：\\' + tick + '<!-- 尚未公布 ' + tick,
    '| 未發布科目 | 分數 |',
    '| --- | --- |',
    '| 測試 | 999 |',
    '-->',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(6));
});

it('does not let an escaped backtick hide the real end of a disclosure', () => {
  const tick = String.fromCharCode(96);
  const source = [
    '<details>',
    '示範：\\' + tick + '</details>' + tick,
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(3));
});

it('keeps a real inline-code span after a pair of literal backslashes', () => {
  const tick = String.fromCharCode(96);
  const source = [
    '示範：\\\\' + tick + '<!--' + tick + ' 只是程式碼文字。',
    ...visibleTable,
  ].join('\n');
  expect(extractStudySourceTables(source)).toEqual(realTable(2));
});

describe('quoted HTML attributes are not active table-boundary markup', () => {
  it('does not expose a hidden table when a quoted greater-than sign precedes hidden', () => {
    const source = [
      '<div title="教材 > 練習" hidden>',
      '| 未公開科目 | 學分 |',
      '| --- | --- |',
      '| 範例 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not accept a quoted fake closing tag inside an unrelated element', () => {
    const source = [
      '<div hidden>',
      '<span title="字面 </div> 並非關閉">範例</span>',
      '| 未公開科目 | 學分 |',
      '| --- | --- |',
      '| 範例 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('does not hide a legitimate table after an unrelated tag quotes an opening tag', () => {
    const source = [
      '<span title="字面 <details> 不是真實標記">範例</span>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('honors single-quoted attribute content before aria-hidden on a section', () => {
    const source = [
      "<section title='比較 x > y' aria-hidden='true'>",
      '| 未公開科目 | 學分 |',
      '| --- | --- |',
      '| 範例 | 99 |',
      '</section>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });
});
