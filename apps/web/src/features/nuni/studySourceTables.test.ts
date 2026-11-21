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

describe('HTML form controls are not independently readable source tables', () => {
  it.each([
    ['select', '<select><option value="lesson">', '</option></select>'],
    ['datalist', '<datalist id="answers"><option value="private">', '</option></datalist>'],
    ['optgroup', '<optgroup label="teacher">', '</optgroup>'],
    ['option', '<option value="not-markdown">', '</option>'],
    ['button', '<button type="button">', '</button>'],
  ])('does not derive a public table inside a %s control', (_name, opening, closing) => {
    const source = [
      opening,
      '| 未公布答案 | 分數 |',
      '| --- | --- |',
      '| 不可複製的選項內容 | 100 |',
      closing,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('retains original line numbers after a multi-line select opener', () => {
    const source = [
      '<select',
      '  data-course="private">',
      '| 非獨立表格 | 分數 |',
      '| --- | --- |',
      '| 尚未發布 | 99 |',
      '</select>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('does not suppress an ordinary table after an escaped form-control example', () => {
    const source = ['範例：\\<select> 不會開啟真實表單。', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('valid Markdown fence boundaries for course source tables', () => {
  it('keeps a public table after an invalid backtick-fence info string', () => {
    // A backtick in a backtick fence info string makes that opener invalid.
    // The following blank line starts an ordinary, visible source table.
    const source = ['```js`example', '', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(3));
  });

  it('still suppresses table-looking code inside a valid tilde fence', () => {
    // Backticks are legal in the info string of a tilde fence.
    const source = ['~~~language`example', ...visibleTable, '~~~', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });
});

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

describe('nested non-rendered HTML wrappers preserve the outer source boundary', () => {
  it.each(['template', 'pre', 'code', 'svg', 'math'])(
    'does not expose a table after an inner <%s> closes', (tag) => {
      const source = [
        `<${tag}>`,
        `<${tag}>`,
        '| 內層教師範例 | 成績 |',
        '| --- | --- |',
        '| 不可複製的答案 | 99 |',
        `</${tag}>`,
        '| 外層仍未公開 | 成績 |',
        '| --- | --- |',
        '| 不可複製的答案 | 88 |',
        `</${tag}>`,
        ...visibleTable,
      ].join('\\n');
      expect(extractStudySourceTables(source)).toEqual(realTable(11));
    },
  );

  it('keeps the following public table selectable after all nested wrappers close', () => {
    const source = [
      '<template>', '<template>',
      '| 教師答案 | 數量 |', '| --- | --- |', '| 隱藏 | 99 |',
      '</template>', '</template>',
      ...visibleTable,
    ].join('\\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(8));
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


describe('comments inside suppressed HTML cannot expose unpublished tables', () => {
  it.each([
    { label: 'hidden div', open: '<div hidden>', close: '</div>' },
    { label: 'collapsed disclosure', open: '<details>', close: '</details>' },
    { label: 'preformatted example', open: '<pre>', close: '</pre>' },
  ])('keeps a fake closing $label tag in an HTML comment inert', ({ open, close }) => {
    const source = [
      open,
      `<!-- ${close} is only an example -->`,
      '| 未公開解答 | 分數 |',
      '| --- | --- |',
      '| 應被隱藏 | 99 |',
      close,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('honors multiline comments and the valid --!> terminator inside a hidden wrapper', () => {
    const source = [
      '<section hidden>',
      '<!-- 下方關閉標記只是註解',
      '</section>',
      '--!>',
      '| 教師答案 | 分數 |',
      '| --- | --- |',
      '| 尚未公開 | 88 |',
      '</section>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(9));
  });

  it('does not treat <!-- inside script text as a comment hiding later public rows', () => {
    const source = [
      '<div hidden>',
      '<script>const marker = "<!--";</script>',
      '| 教師答案 | 分數 |',
      '| --- | --- |',
      '| 尚未公開 | 88 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('still shows an ordinary table after a real comment outside any hidden wrapper', () => {
    const source = ['<!-- 這只是一段註解 -->', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('multiline HTML markup cannot reveal hidden course tables', () => {
  it.each([
    { label: 'hidden attribute after a newline', opening: ['<div', '  hidden>'], closing: ['</div>'] },
    { label: 'hidden inline style after a newline', opening: ['<section', '  style="display:none">'], closing: ['</section>'] },
    { label: 'quoted greater-than and aria-hidden across lines',
      opening: ['<article', '  title="進度 > 結果"', '  aria-hidden="true">'], closing: ['</article>'] },
    { label: 'open HTML disclosure with multiline attributes',
      opening: ['<details', '  open>'], closing: ['</details>'] },
  ])('does not reconstruct teacher-only rows inside $label', ({ opening, closing }) => {
    const source = [
      ...opening,
      '| 教師未公布 | 成績 |',
      '| --- | --- |',
      '| 隱藏答案 | 99 |',
      ...closing,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(opening.length + closing.length + 4));
  });

  it('keeps nested hidden containers balanced when a closing tag spans lines', () => {
    const source = [
      '<div hidden>',
      '<div',
      '  class="example">',
      '| 未公開解答 | 分數 |',
      '| --- | --- |',
      '| 假資料 | 90 |',
      '</div',
      '>',
      '| 外層仍未公開 | 分數 |',
      '| --- | --- |',
      '| 假資料 | 88 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(13));
  });

  it('does not hide legitimate source tables after a visible multiline wrapper', () => {
    const source = [
      '<section',
      '  title="教材 > 公開">',
      '</section>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });

  it('does not interpret multiline markup inside a fenced code example as active HTML', () => {
    const source = [
      '```html',
      '<div',
      ' hidden>',
      '```',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(5));
  });
});

describe('visible Markdown inline-code examples in course source tables', () => {
  it('keeps literal HTML tags and comments in a programming worksheet', () => {
    const source = [
      '| 語法 | 說明 |',
      '| --- | --- |',
      '| `<section hidden>` | 原始 HTML 語法範例 |',
      '| `<!-- 草稿 -->` | 註解符號示範 |',
      '| `<svg viewBox="0 0 20 20">` | 繪圖標籤示範 |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['語法', '說明'],
      rows: [
        ['`<section hidden>`', '原始 HTML 語法範例'],
        ['`<!-- 草稿 -->`', '註解符號示範'],
        ['`<svg viewBox="0 0 20 20">`', '繪圖標籤示範'],
      ],
    }]);
  });

  it('still rejects an active hidden HTML cell beside a safe inline-code example', () => {
    const source = [
      '| 名稱 | 內容 |',
      '| --- | --- |',
      '| 示範 | `<span hidden>` 和 <span hidden>未公布答案</span> |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });

  it('rejects an unmatched inline-code delimiter around an HTML element', () => {
    const source = [
      '| 名稱 | 內容 |',
      '| --- | --- |',
      '| 範例 | `<span hidden>尚未公開</span> |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });

  it('does not misclassify escaped backticks as a paired code span', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '| 名稱 | 內容 |',
      '| --- | --- |',
      '| 範例 | \\' + tick + '<span hidden>' + tick + ' 不是程式碼開頭 </span> |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(4));
  });
});

describe('ambiguous inline HTML and literal comment terminators', () => {
  it('does not release a later table from an unclosed hidden span in malformed inline code', () => {
    const source = [
      '| 名稱 | 內容 |',
      '| --- | --- |',
      '| 範例 | `<span hidden>尚未公開 |',
      ...visibleTable,
    ].join('\n');
    // Fail closed: this is not an isolated, valid source-table boundary.
    expect(extractStudySourceTables(source)).toEqual([]);
  });

  it('does not let an escaped tick make an unclosed hidden span safe', () => {
    const tick = String.fromCharCode(96);
    const source = [
      '| 名稱 | 內容 |',
      '| --- | --- |',
      '| 範例 | \\' + tick + '<span hidden>' + tick + ' 尚未公開 |',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([]);
  });

  it('keeps standalone HTML comment terminators as visible course syntax', () => {
    const source = [
      '| 記號 | 用法 |',
      '| --- | --- |',
      '| --> | HTML 註解結束符號 |',
      '| --!> | 另一種合法的結束符號 |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['記號', '用法'],
      rows: [
        ['-->', 'HTML 註解結束符號'],
        ['--!>', '另一種合法的結束符號'],
      ],
    }]);
  });
});

describe('hidden inline and list wrappers never become extra public source tables', () => {
  it.each([
    { tag: 'span', attribute: 'hidden' },
    { tag: 'span', attribute: 'style="display:none"' },
    { tag: 'ul', attribute: 'aria-hidden="true"' },
    { tag: 'ol', attribute: 'style="visibility:hidden"' },
    { tag: 'li', attribute: 'hidden' },
  ])('suppresses a table inside explicitly hidden <$tag $attribute>', ({ tag, attribute }) => {
    const source = [
      `<${tag} ${attribute}>`,
      '| 教師未公開答案 | 分數 |',
      '| --- | --- |',
      '| 不能提前揭露 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps a hidden outer span active when a nested span closes first', () => {
    const source = [
      '<span hidden>',
      '<span>',
      '| 第一段未公開 | 分數 |',
      '| --- | --- |',
      '| 隱藏 | 99 |',
      '</span>',
      '| 第二段未公開 | 分數 |',
      '| --- | --- |',
      '| 仍然隱藏 | 88 |',
      '</span>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });

  it('does not hide a public table merely because visible span attributes mention hidden', () => {
    const source = [
      '<span title="hidden CSS property example" style="display:inline">',
      ...visibleTable,
      '</span>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('keeps an inline-code span example as visible lesson text', () => {
    const source = [
      '| 程式 | 說明 |',
      '| --- | --- |',
      '| `<span hidden>` | 這是可見的 HTML 語法範例 |',
    ].join('\n');
    expect(extractStudySourceTables(source)[0]?.rows).toEqual([
      ['`<span hidden>`', '這是可見的 HTML 語法範例'],
    ]);
  });
});

describe('legacy HTML raw text cannot leak hidden lesson answers into source tables', () => {
  it.each(['xmp', 'iframe', 'noembed', 'noframes', 'title'])(
    'keeps ancestor closing tags inside <%s> as literal text',
    (tag) => {
      const source = [
        '<div hidden>',
        `<${tag}>`,
        '</div>', // Not a real end tag while parsing raw text / RCDATA.
        `</${tag}>`,
        '| 教師未公布解答 | 分數 |',
        '| --- | --- |',
        '| 不得提前揭露 | 99 |',
        '</div>',
        ...visibleTable,
      ].join('\n');
      expect(extractStudySourceTables(source)).toEqual(realTable(9));
    },
  );

  it('treats plaintext as consuming source to EOF, ignoring even a closing-looking tag', () => {
    const source = [
      '<div hidden>',
      '<plaintext>',
      '</plaintext>',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([]);
  });

  it('resumes public source tables after a correctly closed raw text example', () => {
    const source = [
      '<xmp>',
      '| 示範資料 | 分數 |',
      '| --- | --- |',
      '| 非正式表格 | 99 |',
      '</xmp>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not treat a paired Markdown inline-code xmp example as active HTML', () => {
    const source = ['這裡示範 `<xmp>` 的寫法。', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('Markdown backslash escapes do not create hidden HTML lesson blocks', () => {
  const slash = String.fromCharCode(92);

  it('retains visible course syntax tables with escaped HTML in a cell', () => {
    const tag = slash + '<span hidden>';
    const source = [
      '| HTML 寫法 | 意義 |',
      '| --- | --- |',
      '| ' + tag + ' | 可見的語法教學文字 |',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([{
      startLine: 1,
      headers: ['HTML 寫法', '意義'],
      rows: [[tag, '可見的語法教學文字']],
    }]);
  });

  it('preserves a public table following an escaped opening tag', () => {
    const source = ['範例：' + slash + '<div hidden>', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('does not start a hidden comment from an escaped HTML comment opener', () => {
    const source = ['註解示例：' + slash + '<!-- 未公開資訊？', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });

  it('does not fold an escaped multiline tag into an active hidden wrapper', () => {
    const source = [slash + '<section', ' hidden>', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(3));
  });

  it('still suppresses active hidden HTML after an even number of slashes', () => {
    // Paired Markdown slashes produce one visible slash and an active tag.
    const source = [slash.repeat(2) + '<div hidden>', ...visibleTable].join('\n');
    expect(extractStudySourceTables(source)).toEqual([]);
  });
});


describe('HTML named entities must not expose explicitly hidden answer tables', () => {
  it.each([
    '<div style="display&colon;none">',
    '<section style="color:red&semi;visibility&colon;hidden">',
    '<aside style="display&Tab;&colon;none">',
    '<div style="display&colon;none&semi;display&colon;block&semi;display&colon;none">',
    '<section style="display&colon;none&excl;important&semi;display&colon;block">',
    // Equally important declarations use the last one: here it is hidden.
    '<div style="display&colon;block&excl;important&semi;display&colon;none&excl;important">',
  ])('keeps unpublished rows private when the HTML attribute is %s', (opening) => {
    const tag = /^<([a-z]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 尚未公布的解答 | 分數 |',
      '| --- | --- |',
      '| 教師專用 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="display&colon;none&semi;display&colon;block">',
    // The later important display:block wins; these rows are actually visible.
    '<div style="display&colon;none&semi;display&colon;block&excl;important">',
    '<div style="display&colon;none&excl;important&semi;display&colon;block&excl;important">',
    '<section style="display&amp;colon;none">',
    '<aside style="display&#38;colon;none">',
    '<div title="display&colon;none" style="display:block">',
  ])('preserves a visible source table and does not double-decode %s', (opening) => {
    const tag = /^<([a-z]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [opening, ...visibleTable, `</${tag}>`].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('explicitly hidden paragraph, label and heading notes', () => {
  it.each([
    '<p hidden>',
    '<p aria-hidden="true">',
    '<p style="visibility:hidden">',
    '<label hidden>',
    '<h2 style="display:none">',
  ])('does not promote a hidden teacher-only source table from %s', (opening) => {
    const tag = /^<([a-z][a-z0-9]*)/iu.exec(opening)?.[1] ?? 'p';
    const source = [
      opening,
      '| 教師用答案 | 學分 |',
      '| --- | --- |',
      '| 尚未公布 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<p aria-hidden="false">',
    '<p title="hidden is a sample">',
    '<label style="display:block">',
    '<h2 class="example">',
  ])('retains a visible course table inside %s', (opening) => {
    const tag = /^<([a-z][a-z0-9]*)/iu.exec(opening)?.[1] ?? 'p';
    const source = [opening, ...visibleTable, `</${tag}>`].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('source table boundaries for explicitly zero-opacity HTML wrappers', () => {
  it.each([
    '<div style="opacity:0">',
    '<section style="opacity:0%">',
    '<aside style="opacity:.000!important; opacity:1">',
    '<p style="opacity:1; opacity:-0.00">',
    '<section style="opacity&colon;0&semi;display&colon;block">',
    '<div style="opacity:0; visibility:visible">',
  ])('does not reconstruct invisible teacher-only rows inside %s', (opening) => {
    const tag = /^<([a-z]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 尚未公布的答案 | 分數 |',
      '| --- | --- |',
      '| 教師用資料 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="opacity:0; opacity:1">',
    '<section style="opacity:0!important; opacity:1!important">',
    '<aside style="opacity:0; opacity:.2">',
    '<p title="opacity:0" style="opacity:1">',
    '<div style="--opacity:0; opacity:1">',
    '<section style="opacity:1; display:block">',
  ])('preserves visible or non-literal-opacity course source tables in %s', (opening) => {
    const tag = /^<([a-z]+)/u.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([opening, ...visibleTable, `</${tag}>`].join('\n')))
      .toEqual(realTable(2));
  });

  it('keeps the important zero opacity even when a later ordinary value says 1', () => {
    const source = [
      '<div style="opacity:0!important; opacity:1">',
      '| 教師答案 | 分數 |',
      '| --- | --- |',
      '| 不應另外顯示 | 100 |',
      '</div>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });
});

describe('zero-opacity CSS exponent notation cannot expose unpublished source tables', () => {
  it.each([
    '<div style="opacity:0e0">',
    '<section style="opacity:0E+3">',
    '<aside style="opacity:.0e-2">',
    '<p style="opacity:-0.00e+4">',
    '<h2 style="opacity:+00e2%">',
    '<div style="opacity:0e0!important; opacity:1">',
  ])('omits teacher-only rows for an explicitly transparent wrapper: %s', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 教師尚未公布 | 分數 |',
      '| --- | --- |',
      '| 不可額外顯示 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="opacity:1e-2">',
    '<div style="opacity:0e0; opacity:1">',
    '<div style="opacity:0e0; opacity:1!important">',
    '<div style="opacity:1!important; opacity:0e0">',
  ])('preserves visible tables when opacity is nonzero or overridden: %s', (opening) => {
    const source = [opening, ...visibleTable, '</div>'].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('dynamic inline CSS never promotes ambiguous lesson content into a source table', () => {
  it.each([
    '<div style="display:var(--answer-display)">',
    '<section style="visibility:var(--lesson-visibility)">',
    '<aside style="content-visibility:var(--answer-visibility)">',
    '<p style="opacity:calc(0)">',
    '<h2 style="opacity:clamp(0, 0, 1)">',
    '<div style="display:none;display:var(--answer-display)">',
    '<span style="opacity:0;opacity:calc(1)">',
    '<div style="display:block;display:var(--answer-display)">',
    '<section style="visibility:env(safe-area-inset-top)">',
    '<div style="display:future-display(block)">',
    '<p style="opacity:future-alpha(1)">',
  ])('omits an unresolved %s while retaining the later public table', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 尚未授權的表格 | 分數 |',
      '| --- | --- |',
      '| 教師答案 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('keeps normal static visible declarations and unrelated CSS functions readable', () => {
    const source = [
      '<div style="display:block; opacity:1; transform:translateX(0)">',
      ...visibleTable,
      '</div>',
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(2));
  });
});

describe('invalid CSS declarations cannot override hidden teacher-only source tables', () => {
  it.each([
    '<div style="display:none;display:banana">',
    '<div style="display:none!important;display:banana!important">',
    '<section style="visibility:hidden;visibility:pretend">',
    '<section style="content-visibility:hidden;content-visibility:private">',
    '<aside style="opacity:0;opacity:transparent">',
    '<aside style="opacity:0!important;opacity:broken!important">',
    '<p style="opacity:0e0;opacity:not-a-number">',
    '<div style="display:none;display:banana block">',
    '<div style="display:none!important;display:banana block!important">',
    '<section style="visibility:hidden;visibility:visible hidden">',
    '<aside style="content-visibility:hidden;content-visibility:auto unknown">',
    '<p style="opacity:0;opacity:0 1">',
    '<div style="display:none;display:future-display(block)">',
    '<div style="opacity&colon;0&period;0">',
    '<section style="opacity&colon;0&percnt;">',
    '<p style="opacity&colon;&plus;0">',
  ])('does not disclose explicitly invisible source rows when style contains %s', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 教師尚未公開 | 分數 |',
      '| --- | --- |',
      '| 不應另列 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="display:none;display:flex">',
    '<div style="display:none!important;display:grid!important">',
    '<section style="visibility:hidden;visibility:visible">',
    '<section style="content-visibility:hidden;content-visibility:auto">',
    '<aside style="opacity:0;opacity:0.5">',
    '<aside style="opacity:0!important;opacity:1e0!important">',
    '<div style="opacity:0;opacity:initial">',
    '<div style="display:none;display:inline flex">',
    '<div style="display:none!important;display:block grid!important">',
  ])('keeps legitimate visible CSS overrides eligible for source tables: %s', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([opening, ...visibleTable, `</${tag}>`].join('\n')))
      .toEqual(realTable(2));
  });
});


describe('context-dependent CSS-wide values must not publish derived teacher tables', () => {
  it.each([
    '<div style="display:none;display:inherit">',
    '<section style="display:none!important;display:revert!important">',
    '<aside style="visibility:hidden;visibility:unset">',
    '<p style="opacity:0;opacity:inherit">',
    '<div style="content-visibility:hidden;content-visibility:revert-layer">',
    // No literal hidden declaration is required: an ancestor or stylesheet
    // can make these context-dependent values invisible at render time.
    '<section style="display:inherit">',
    '<div style="visibility:unset">',
    '<aside style="opacity:revert">',
    '<p style="content-visibility:revert-layer">',
  ])('withholds a context-dependent table but preserves later public rows: %s', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    const source = [
      opening,
      '| 尚未確認可見的教材 | 分數 |',
      '| --- | --- |',
      '| 必須略過 | 99 |',
      `</${tag}>`,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it.each([
    '<div style="display:none;display:initial">',
    '<section style="visibility:hidden;visibility:initial">',
    '<aside style="opacity:0;opacity:initial">',
    '<p style="content-visibility:hidden;content-visibility:initial">',
    '<div style="color:inherit;display:block">',
  ])('still reads tables with known visible values or unrelated CSS properties: %s', (opening) => {
    const tag = /^<([a-z0-9]+)/u.exec(opening)?.[1] ?? 'div';
    expect(extractStudySourceTables([opening, ...visibleTable, `</${tag}>`].join('\n')))
      .toEqual(realTable(2));
  });
});

describe('classic Mac and mixed-line-ending course handouts', () => {
  it('reconstructs a public Markdown table from CR-only TXT without changing the source line', () => {
    const source = ['講義封面', '', ...visibleTable].join('\r');
    expect(extractStudySourceTables(source)).toEqual(realTable(3));
  });

  it('keeps a CR-only multiline hidden wrapper closed until its real end tag', () => {
    const source = [
      '<section', ' hidden>',
      '| 教師未公開答案 | 分數 |', '| --- | --- |', '| 私有資料 | 99 |',
      '</section>',
      ...visibleTable,
    ].join('\r');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('keeps CR-only multiline display:none CSS inside its hidden wrapper', () => {
    const source = [
      '<div', ' style="display:none">',
      '| 尚未公開 | 分數 |', '| --- | --- |', '| 答案 | 99 |',
      '</div>', ...visibleTable,
    ].join('\r');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('keeps CR-only multiline aria-hidden teacher notes out of later public tables', () => {
    const source = [
      '<section', ' aria-hidden="true">',
      '| 私人筆記 | 分數 |', '| --- | --- |', '| 未發布 | 100 |',
      '</section>', ...visibleTable,
    ].join('\r');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('ignores a fenced example across CR line endings but finds later CRLF public rows', () => {
    const source = ['~~~markdown', ...visibleTable, '~~~'].join('\r') +
      '\n' + visibleTable.join('\r\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('counts CRLF as one source line while preserving mixed CR, LF and CRLF boundaries', () => {
    const source = ['第一節', '第二節', ...visibleTable].join('\r\n')
      .replace('第一節\r\n第二節\r\n', '第一節\r第二節\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(3));
  });
});


describe('hyphenated custom HTML lesson wrappers keep teacher-only rows hidden', () => {
  it.each([
    '<teacher-answer hidden>',
    '<nuni-lesson-key aria-hidden="true">',
    '<course-answer style="display:none">',
  ])('omits a concealed custom element %s but retains the later public source', (opening) => {
    const tag = /^<([a-z][a-z0-9-]*)/u.exec(opening)?.[1] ?? 'teacher-answer';
    const source = [
      opening,
      '| 尚未公開答案 | 分數 |',
      '| --- | --- |',
      '| 教師專用 | 99 |',
      '</' + tag + '>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not let an inner custom element with the same name release its hidden parent', () => {
    const source = [
      '<lesson-answer hidden>',
      '<lesson-answer>',
      '| 內層未公布 | 分數 |',
      '| --- | --- |',
      '| 答案 | 99 |',
      '</lesson-answer>',
      '| 外層仍未公布 | 分數 |',
      '| --- | --- |',
      '| 答案 | 88 |',
      '</lesson-answer>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });

  it('folds multiline hidden custom tags without shifting the public table source line', () => {
    const source = [
      '<course-answer',
      ' aria-hidden="true">',
      '| 隱藏 | 分數 |',
      '| --- | --- |',
      '| 教師答案 | 100 |',
      '</course-answer>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('preserves an ordinary visible custom element and an escaped hidden example', () => {
    const source = [
      '<course-outline>',
      ...visibleTable,
      '</course-outline>',
      '\\<course-answer hidden>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([
      ...realTable(2),
      ...realTable(7),
    ]);
  });
});


describe('global hidden HTML attributes on standard course handout wrappers', () => {
  it.each([
    { opening: '<center hidden>', closing: '</center>' },
    { opening: '<address aria-hidden="true">', closing: '</address>' },
    { opening: '<dl style="display:none">', closing: '</dl>' },
    { opening: '<a hidden="false">', closing: '</a>' },
    { opening: '<em style="visibility:hidden">', closing: '</em>' },
    { opening: '<hgroup hidden>', closing: '</hgroup>' },
    { opening: '<strong aria-hidden="true">', closing: '</strong>' },
    { opening: '<time style="opacity:0">', closing: '</time>' },
  ])('omits a teacher-only table in $opening, then keeps a public table', ({ opening, closing }) => {
    const source = [
      opening,
      '| 教師未公布答案 | 分數 |',
      '| --- | --- |',
      '| 隱藏答案 | 99 |',
      closing,
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(6));
  });

  it('does not release a hidden center when its same-name inner element closes', () => {
    const source = [
      '<center hidden>',
      '<center>',
      '| 內層答案 | 分數 |',
      '| --- | --- |',
      '| 不可見 | 99 |',
      '</center>',
      '| 外層仍隱藏 | 分數 |',
      '| --- | --- |',
      '| 不可見 | 88 |',
      '</center>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(11));
  });

  it('folds a multiline hidden definition-list tag and keeps the actual public line number', () => {
    const source = [
      '<dl',
      ' aria-hidden="true">',
      '| 隱藏 | 分數 |',
      '| --- | --- |',
      '| 未公開 | 100 |',
      '</dl>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual(realTable(7));
  });

  it('does not suppress ordinary visible wrappers or Markdown-escaped tag examples', () => {
    const source = [
      '<center>',
      ...visibleTable,
      '</center>',
      '\\<center hidden>',
      ...visibleTable,
    ].join('\n');
    expect(extractStudySourceTables(source)).toEqual([
      ...realTable(2),
      ...realTable(7),
    ]);
  });
});
