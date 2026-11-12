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

describe('raw HTML text inside a hidden lesson wrapper cannot close its parent', () => {
  it.each(['script', 'style', 'textarea'])('keeps unpublished answers hidden when <%s> contains a literal </div>', (tag) => {
    const source = [
      '<div hidden>',
      `<${tag}>`,
      '</div>', // Text inside the raw/RCDATA element, not an HTML closing tag.
      `</${tag}>`,
      '| 教師未公開答案 | 分數 |',
      '| --- | --- |',
      '| 不得額外展示 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(9));
  });

  it('does not let a literal disclosure close inside nested script release its answer', () => {
    const source = [
      '<details>',
      '<script>',
      '</details>',
      '</script>',
      '| 收合中的練習答案 | 分數 |',
      '| --- | --- |',
      '| 未公布 | 100 |',
      '</details>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(9));
  });

  it('restores the public table after the real hidden wrapper close', () => {
    const source = [
      '<section aria-hidden="true">',
      '<style>',
      '</section>',
      '</style>',
      '| 尚未發布 | 分數 |',
      '| --- | --- |',
      '| 範例 | 99 |',
      '</section>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(9));
  });
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

describe('visibility attributes must be outside HTML quoted values', () => {
  it.each([
    ['<div title="教材 hidden 說明">', '</div>'],
    ['<section data-caption="example aria-hidden=true flag">', '</section>'],
    ['<aside title="example aria-hidden=\'true\' hidden">', '</aside>'],
  ])('keeps the visible course table after %s', (opening, closing) => {
    expect(extractStudySourceTables([opening, ...visibleTable, closing].join('\n')))
      .toEqual(realTable(2));
  });

  it('still suppresses an actual hidden attribute after an unrelated quoted title', () => {
    const source = [
      '<div title="課堂示範 hidden 狀態" aria-hidden="true">',
      '| 尚未公布 | 學分 |',
      '| --- | --- |',
      '| 測試 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('treats HTML hidden="false" as a present Boolean hidden attribute', () => {
    const source = [
      '<div title="sample" hidden="false">',
      '| 尚未公布 | 學分 |',
      '| --- | --- |',
      '| 測試 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps an explicitly aria-hidden="false" table visible', () => {
    expect(extractStudySourceTables([
      '<section aria-hidden="false">', ...visibleTable, '</section>',
    ].join('\n'))).toEqual(realTable(2));
  });
});

describe('explicit inline display:none on HTML lesson wrappers', () => {
  it.each([
    '<div style="display:none">',
    "<section style='color: blue; DISPLAY : NONE !important'>",
    '<aside title="demo" style="display: none; display: block; display:none">',
  ])('does not expose hidden example rows inside %s', (opening) => {
    const tag = /^<([a-z]+)/i.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 暫不公開 | 學分 |',
      '| --- | --- |',
      '| 模擬資料 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps rows visible when a later display declaration overrides none', () => {
    const source = [
      '<div style="display:none; display:block">',
      ...visibleTable,
      '</div>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('honors an earlier important display value against a later normal declaration', () => {
    const source = [
      '<div style="display:none !important; display:block">',
      '| 暫不公開 | 學分 |',
      '| --- | --- |',
      '| 模擬資料 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not mistake a quoted explanation or custom property for actual display:none', () => {
    const source = [
      '<section title="demo display:none" style="--example:display:none; display:block">',
      ...visibleTable,
      '</section>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('does not let a nested visible div expose its display:none parent', () => {
    const source = [
      '<div style="display: none">',
      '<div class="example">',
      '| 測試答案 | 分數 |',
      '| --- | --- |',
      '| 隱藏 | 999 |',
      '</div>',
      '| 外層仍隱藏 | 分數 |',
      '| --- | --- |',
      '| 隱藏 | 888 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });
});


describe('inline CSS strings and comments do not leak or hide lesson tables', () => {
  it.each([
    '<div style="display:none /* teacher-only example */">',
    '<section style="display: /* explanation */ none !important; display:block">',
    '<aside style="visibility:hidden/* not public */; content-visibility:visible">',
  ])('keeps an explicitly hidden answer private with CSS comments in %s', (opening) => {
    const tag = /^<([a-z]+)/i.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([
      opening,
      '| 教師答案 | 分數 |',
      '| --- | --- |',
      '| 暫不公開 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n'))).toEqual(realTable(6));
  });

  it('keeps a visible table when a quoted CSS string only mentions a fake visibility declaration', () => {
    expect(extractStudySourceTables([
      '<div style="content:\'note; visibility:hidden; example\'; display:block">',
      ...visibleTable,
      '</div>',
    ].join('\n'))).toEqual(realTable(2));
  });

  it('respects later CSS overrides despite comments and semicolons inside URL functions', () => {
    expect(extractStudySourceTables([
      '<section style="background:url(data:image/svg+xml;utf8,example); display:none/* draft */; display:block">',
      ...visibleTable,
      '</section>',
    ].join('\n'))).toEqual(realTable(2));
  });
});

describe('explicit inline CSS visibility in course source wrappers', () => {
  it.each([
    '<div style="visibility:hidden">',
    "<section style='CONTENT-VISIBILITY: hidden !important'>",
    '<aside style="visibility:collapse">',
    '<div style="visibility: hidden !important; visibility: visible">',
  ])('does not reconstruct hidden source rows inside %s', (opening) => {
    const tag = /^<([a-z]+)/i.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 未公開答案 | 學分 |',
      '| --- | --- |',
      '| 測試資料 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="visibility:hidden; visibility:visible">',
    '<section style="content-visibility:hidden; content-visibility:visible">',
    '<aside style="visibility:hidden; visibility:visible !important">',
    '<div style="display:none !important; display:block !important">',
  ])('keeps source rows when later declarations restore visibility in %s', (opening) => {
    const tag = /^<([a-z]+)/i.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([opening, ...visibleTable, '</' + tag + '>'].join('\n')))
      .toEqual(realTable(2));
  });

  it('does not let visibility:visible override display:none from a different property', () => {
    const source = [
      '<div style="display:none; visibility:visible">',
      '| 未發布內容 | 學分 |',
      '| --- | --- |',
      '| 測試 | 99 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not treat title text or custom CSS properties as actual visibility settings', () => {
    expect(extractStudySourceTables([
      '<div title="visibility:hidden" style="--example:visibility:hidden; visibility:visible">',
      ...visibleTable,
      '</div>',
    ].join('\n'))).toEqual(realTable(2));
  });

  it('does not let nested containers expose a visibility-hidden parent', () => {
    const source = [
      '<section style="visibility:hidden">',
      '<div class="nested">',
      '| 未發布成績 | 學分 |',
      '| --- | --- |',
      '| 模擬資料 | 99 |',
      '</div>',
      '| 仍在隱藏區 | 學分 |',
      '| --- | --- |',
      '| 模擬資料 | 88 |',
      '</section>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });
});

describe('CSS important tokens with legal whitespace in hidden source wrappers', () => {
  it.each([
    '<div style="display:none ! important; display:block">',
    '<section style="display:none ! /* teacher-only */ important; display:block">',
    '<aside style="visibility:hidden ! important; visibility:visible">',
    '<div style="content-visibility:hidden ! important; content-visibility:visible">',
  ])('does not reveal teacher-only rows when the priority marker is spaced in %s', (opening) => {
    const tag = /^<([a-z]+)/i.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([
      opening,
      '| 教師尚未發布 | 學分 |',
      '| --- | --- |',
      '| 隱藏範例 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n'))).toEqual(realTable(6));
  });

  it('allows a later equally important declaration to make a table visible', () => {
    expect(extractStudySourceTables([
      '<div style="display:none ! important; display:block !important">',
      ...visibleTable,
      '</div>',
    ].join('\n'))).toEqual(realTable(2));
  });

  it('does not mistake an invalid important-like word for a priority flag', () => {
    expect(extractStudySourceTables([
      '<div style="display:none ! importantish; display:block">',
      ...visibleTable,
      '</div>',
    ].join('\n'))).toEqual(realTable(2));
  });
});

describe('hidden semantic HTML wrappers must not publish lesson answer tables', () => {
  it.each([
    ['article', 'hidden'],
    ['figure', 'style="display:none"'],
    ['blockquote', 'aria-hidden="true"'],
    ['main', 'hidden'],
    ['fieldset', 'style="visibility:hidden"'],
  ])('omits answers inside <%s %s> but keeps the following public table', (tag, attribute) => {
    const source = [
      `<${tag} ${attribute}>`,
      '| 教師未公開答案 | 分數 |',
      '| --- | --- |',
      '| 不應重建 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps a hidden outer article closed until its matching closing tag', () => {
    const source = [
      '<article hidden>',
      '<article>',
      '| 尚未公布 | 分數 |',
      '| --- | --- |',
      '| 巢狀練習 | 99 |',
      '</article>',
      '| 外層仍隱藏 | 分數 |',
      '| --- | --- |',
      '| 尚未公布 | 88 |',
      '</article>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });

  it('does not suppress a visible figure just because its title mentions hidden', () => {
    const source = [
      '<figure title="教材示範 hidden 屬性" style="display:block">',
      ...visibleTable,
      '</figure>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});


describe('Markdown programming tables with escaped pipes and inline code', () => {
  it('keeps an escaped pipe as content inside one example cell', () => {
    const source = [
      '| 運算 | 範例 |',
      '| --- | --- |',
      '| OR | a\\|b |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['運算', '範例'],
      rows: [['OR', 'a|b']],
    }]);
  });

  it('keeps one- and two-backtick code spans containing pipe characters', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '| 指令 | 範例 |',
      '| --- | --- |',
      '| OR | ' + tick + 'a|b' + tick + ' |',
      '| 程式 | ' + tick + tick + 'a|' + tick + 'b' + tick + tick + ' |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['指令', '範例'],
      rows: [['OR', tick + 'a|b' + tick], ['程式', tick + tick + 'a|' + tick + 'b' + tick + tick]],
    }]);
  });

  it('splits after a pair of literal backslashes', () => {
    const source = [
      '| 主題 | 範例 | 備註 |',
      '| --- | --- | --- |',
      '| 轉義 | a\\\\|b |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['主題', '範例', '備註'],
      rows: [['轉義', 'a\\', 'b']],
    }]);
  });

  it('closes inline code even when a literal backslash precedes the closing backtick', () => {
    const tick = String.fromCharCode(96);
    const slash = String.fromCharCode(92);
    const source = [
      '| 語法 | 範例 |',
      '| --- | --- |',
      '| 原始碼 | ' + tick + 'a' + slash + tick + ' |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['語法', '範例'],
      rows: [['原始碼', tick + 'a' + slash + tick]],
    }]);
  });

  it('rejects unmatched inline-code markup without shifting table cells', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '| 範例 | 說明 |',
      '| --- | --- |',
      '| OR | ' + tick + 'a|b |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });

  it('never reconstructs teacher-only HTML cells even alongside escaped pipes', () => {
    const source = [
      '| 例子 | 答案 |',
      '| --- | --- |',
      '| a\\|b | <span hidden>教師答案</span> |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });

  it('still omits source rows enclosed in a collapsed HTML disclosure', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '<details>',
      '| 語法 | 範例 |',
      '| --- | --- |',
      '| OR | ' + tick + 'a|b' + tick + ' |',
      '</details>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });
});

describe('HTML slash endings cannot expose hidden lesson tables', () => {
  it.each([
    ['div', 'hidden'],
    ['section', 'style="display:none"'],
    ['article', 'aria-hidden="true"'],
    ['details', ''],
    ['dialog', ''],
    ['pre', ''],
    ['script', ''],
    ['template', ''],
  ])('treats a slash-ended <%s> as an HTML start tag', (tag, attrs) => {
    // In text/html, the slash is ignored on non-void HTML elements.
    // These source rows must not appear before the actual closing tag.
    const source = [
      `<${tag}${attrs ? ' ' + attrs : ''} />`,
      '| 尚未公開答案 | 分數 |',
      '| --- | --- |',
      '| 不應額外呈現 | 999 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps an outer hidden div active after a nested slash-ended div closes', () => {
    const source = [
      '<div hidden />',
      '<div />',
      '| 私有答案 | 分數 |',
      '| --- | --- |',
      '| 尚未公布 | 999 |',
      '</div>',
      '| 外層仍不可見 | 分數 |',
      '| --- | --- |',
      '| 測試 | 888 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });

  it('preserves actual self-closing SVG and MathML foreign elements', () => {
    const source = [
      '<svg viewBox="0 0 10 10" />',
      '<math />',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(3));
  });

  it('does not suppress an ordinary visible block solely because it uses a slash', () => {
    const source = ['<div style="display:block" />', ...visibleTable, '</div>'].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});


describe('HTML numeric references and CSS escapes cannot disclose hidden source answers', () => {
  const visible = ['| 科目 | 學分 |', '| --- | --- |', '| 資料庫 | 3 |'];
  it.each([
    ['<div style="display:&#110;one">', '</div>'],
    ['<section style="dis&#112;lay:none">', '</section>'],
    ['<aside style="display:&#x6e;one">', '</aside>'],
    ['<article style="display:\\6e one">', '</article>'],
    ['<figure style="dis\\70 lay:none">', '</figure>'],
    ['<blockquote style="display:&#92;6e one">', '</blockquote>'],
    ['<div style="visibility:\\68 idden">', '</div>'],
    ['<section aria-hidden="tr&#117;e">', '</section>'],
  ])('omits teacher-only rows with encoded visibility in %s', (opening, closing) => {
    const source = [
      opening, '| 教師答案 | 分數 |', '| --- | --- |', '| 暫不公開 | 99 |',
      closing, ...visible,
    ].join('\n');
    const tables = extractStudySourceTables(source);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toEqual([['資料庫', '3']]);
  });

  it.each([
    '<div style="display:&#110;one; display:block">',
    '<div style="display:\\6e one; display:block !important">',
  ])('keeps a legitimately visible table after a stronger override in %s', (opening) => {
    const source = [opening, ...visible, '</div>'].join('\n');
    expect(extractStudySourceTables(source)[0]?.rows).toEqual([['資料庫', '3']]);
  });

  it('preserves an important encoded hidden rule against a later ordinary display', () => {
    const source = [
      '<div style="display:\\6e one !important; display:block">',
      '| 教師答案 | 分數 |', '| --- | --- |', '| 暫不公開 | 99 |',
      '</div>', ...visible,
    ].join('\n');
    expect(extractStudySourceTables(source).map((table) => table.rows))
      .toEqual([[['資料庫', '3']]]);
  });
});
