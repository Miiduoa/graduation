// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { schoolPortalCaptureScript, readPortalCapture, schoolPortalFor } from '@campus/shared/src/imports/portalCapture';
import { extractSchoolPageTables } from '@campus/shared/src/imports/schoolPageTables';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';

type PortalWindow = {
  document: Document;
  eval(source: string): unknown;
  close(): void;
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => { window: PortalWindow };
};
const portal = schoolPortalFor('pu')!;
const origin = 'https://alcat.pu.edu.tw';
const request = { id: 'grid_capture_123456', origin };
const header = '<div role="row"><div role="columnheader">課程名稱</div><div role="columnheader">學分</div><div role="columnheader">成績</div></div>';
const data = '<div role="row"><div role="gridcell">統計學</div><div role="gridcell">3</div><div role="gridcell">0</div></div>';
const grid = (attributes = '', rows = header + data, role = 'grid') => `<div role="${role}" ${attributes}>${rows}</div>`;
const native = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>英文</td><td>2</td><td>90</td></tr></table>';
function capture(html: string, prepare?: (window: PortalWindow) => void) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: `${origin}/grades`, runScripts: 'outside-only' });
  try {
    const messages: string[] = [];
    Object.defineProperty(dom.window, 'ReactNativeWebView', { value: { postMessage: (value: string) => messages.push(value) } });
    prepare?.(dom.window);
    const before = dom.window.document.body.innerHTML;
    dom.window.eval(schoolPortalCaptureScript(request));
    expect(dom.window.document.body.innerHTML).toBe(before);
    expect(messages).toHaveLength(1);
    const result = JSON.parse(messages[0]) as { html?: string; error?: string; blockedFrames?: number };
    const accepted = readPortalCapture(portal, request, `${origin}/grades`, `${origin}/grades`, messages[0]);
    expect(accepted.status).toBe(result.error ? 'error' : 'ok');
    return result;
  } finally { dom.window.close(); }
}
function expectUnavailable(html: string) {
  const result = capture(html);
  expect(result.error).toBe('unavailable');
  expect(result.html).toBeUndefined();
}
it.each(['grid', 'table'])('reads explicit ARIA %s cells into the existing grade parser', (role) => {
  const captured = capture('<h2>115 學年度第 1 學期</h2>' + grid('aria-rowcount="2" aria-colcount="3"', header + data, role));
  expect(captured.html).toContain('<th>課程名稱</th>');
  expect(captured.html).not.toContain('課程名稱 /');
  const candidates = extractSchoolPageTables(captured.html!, 'grades');
  expect(candidates).toHaveLength(1);
  expect(candidates[0].suggestedTerm).toEqual({ academicYear: '115', semester: '1' });
  const parsed = parsePersonalImport(candidates[0].text, { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' });
  expect(parsed.rows[0]).toMatchObject({ title: '統計學', credits: 3, grade: '0' });
  expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
});
it('supports rowgroups and cell roles without copying their DOM IDs or labels', () => {
  const result = capture(grid('id="private-name" aria-label="private-label"', '<div role="rowgroup">' + header + data.replaceAll('gridcell', 'cell') + '</div>'));
  expect(result.html).toContain('統計學');
  expect(result.html).not.toMatch(/private-name|private-label|role=|id=/);
});
it('preserves ARIA row spans and column indices in a weekly timetable', () => {
  const rows = '<div role="row" aria-rowindex="1"><div role="columnheader">節次</div><div role="columnheader">星期一</div><div role="columnheader">星期二</div></div>' +
    '<div role="row" aria-rowindex="2"><div role="rowheader">1</div><div role="gridcell" aria-rowspan="2" aria-colindex="2">程式設計</div><div role="gridcell" aria-colindex="3">英文</div></div>' +
    '<div role="row" aria-rowindex="3"><div role="rowheader">2</div><div role="gridcell" aria-colindex="3">數學</div></div>';
  const result = capture(grid('aria-rowcount="3" aria-colcount="3"', rows));
  expect(result.html).toContain('rowspan="2"');
  const [candidate] = extractSchoolPageTables(result.html!, 'timetable', 'pu');
  const parsed = parsePersonalImport(candidate.text, { kind: 'timetable', schoolId: 'pu', academicYear: '115', semester: '1', periodProfile: 'pu' });
  expect(parsed.rows.find((row) => row.title === '程式設計')).toMatchObject({ dayOfWeek: 1, startPeriod: 1, endPeriod: 2 });
  expect(parsed.rows).toHaveLength(3);
});
it('normalizes ARIA column spans without copying original attributes', () => {
  const rows = '<div role="row"><div role="columnheader" aria-colspan="2">分組</div><div role="columnheader">成績</div></div>' + data;
  expect(capture(grid('aria-colcount="3"', rows)).html).toContain('<th colspan="2">分組</th>');
});
it('uses HTML spans for a native table with grid semantics', () => {
  const html = '<table role="grid" aria-rowcount="3" aria-colcount="2"><tr><th>科目</th><th>成績</th></tr><tr><td rowspan="2" aria-rowspan="99">統計</td><td>90</td></tr><tr><td>91</td></tr></table>';
  const result = capture(html);
  expect(result.html).toContain('rowspan="2"');
  expect(result.html).not.toContain('99');
});
it('does not duplicate nested layout grids or native tables', () => {
  const result = capture(grid('', '<div role="row"><div role="gridcell">' + native + '</div></div>') +
    '<table><tr><td>' + grid() + '</td></tr></table>');
  expect(result.html!.match(/<table>/g)).toHaveLength(2);
  expect(result.html!.match(/統計學/g)).toHaveLength(1);
  expect(result.html!.match(/英文/g)).toHaveLength(1);
});
it('ignores CSS-only card layouts rather than guessing a table schema', () => {
  expect(capture('<div class="grid"><div>統計學</div><div>90</div></div>').error).toBe('no-table');
});
it.each(['aria-rowcount="30"', 'aria-rowcount="-1"', 'aria-colcount="8"', 'aria-colcount="-1"'])('rejects incomplete or unknown table coverage: %s', (attributes) => {
  expectUnavailable(grid(attributes));
});
it.each(['aria-rowcount="2x"', 'aria-rowcount="1.5"', 'aria-colcount="NaN"', 'aria-rowcount="9007199254740992"'])('rejects malformed declared dimensions: %s', (attributes) => {
  expectUnavailable(grid(attributes));
});
it.each(['aria-rowindex="4"', 'aria-rowindex="0"'])('rejects missing or invalid row positions: %s', (attribute) => {
  expectUnavailable(grid('', header + data.replace('role="row"', `role="row" ${attribute}`)));
});
it('rejects columns scrolled out of the DOM instead of shifting their values into another field', () => {
  expectUnavailable(grid('', header + data.replace('role="gridcell"', 'role="gridcell" aria-colindex="2"')));
});
it('honors a row-level starting column indicator', () => {
  expectUnavailable(grid('', header + data.replace('role="row"', 'role="row" aria-colindex="2"')));
});
it('rejects contradictory cell-level row positions', () => {
  expectUnavailable(grid('', header + data.replace('role="gridcell"', 'role="gridcell" aria-rowindex="3"')));
});
it('also rejects native virtualized tables', () => {
  expectUnavailable(native.replace('<table>', '<table role="grid" aria-rowcount="100">'));
});
it('does not expose partial data from a valid table when another table is incomplete', () => {
  expectUnavailable(native + grid('aria-rowcount="100"'));
});
it.each(['aria-busy="true"', 'aria-owns="elsewhere"'])('does not read unsettled or externally owned tables: %s', (attribute) => {
  expectUnavailable(grid(attribute));
});
it('does not claim completeness while an ancestor is loading', () => {
  expectUnavailable('<section aria-busy="true">' + grid() + '</section>');
});
it('does not follow external rowgroup ownership references', () => {
  expectUnavailable(grid('', '<div role="rowgroup" aria-owns="private-records">' + header + data + '</div>'));
});
it('does not flatten a treegrid into independent course records', () => {
  expectUnavailable(grid('', header + data, 'treegrid'));
});
it('rejects an ARIA row that is missing a column', () => {
  expectUnavailable(grid('', header + data.replace('<div role="gridcell">3</div>', '')));
});
it('rejects spans that overlap a carried cell in the next row', () => {
  const rows = '<div role="row"><div role="gridcell">A</div><div role="gridcell" aria-rowspan="2">B</div><div role="gridcell">C</div></div>' +
    '<div role="row"><div role="gridcell" aria-colspan="2">X</div><div role="gridcell">Y</div></div>';
  expectUnavailable(grid('', rows));
});
it.each(['aria-rowspan="0"', 'aria-rowspan="3"'])('rejects unsupported or out-of-range row spans: %s', (attribute) => {
  expectUnavailable(grid('', header + data.replace('role="gridcell"', `role="gridcell" ${attribute}`)));
});
it('preserves the existing capacity limits for ARIA rows, cells, text and spans', () => {
  for (const html of [
    grid('', data.repeat(1201)),
    grid('', '<div role="row">' + '<div role="gridcell">X</div>'.repeat(33) + '</div>'),
    grid('', header + data.replace('統計學', '字'.repeat(501))),
    grid('', header + data.replace('role="gridcell"', 'role="gridcell" aria-colspan="33"')),
  ]) {
    const result = capture(html);
    expect(result.error).toBe('too-large'); expect(result.html).toBeUndefined();
  }
});
it('skips hidden grids without blocking a visible complete table', () => {
  const result = capture('<div style="display:none">' + grid('aria-rowcount="100"') + '</div>' + native);
  expect(result.html).toContain('英文'); expect(result.html).not.toContain('統計學');
});
it('retains hidden-cell placeholders so visible values do not shift to different columns', () => {
  const result = capture(grid('', header + data.replace('role="gridcell">3', 'role="gridcell" aria-hidden="true">3')));
  expect(result.html).toContain('<td>統計學</td><td></td><td>0</td>');
});
it('does not call a count complete when some of its declared rows are hidden', () => {
  expectUnavailable(grid('aria-rowcount="2"', header + data.replace('role="row"', 'role="row" hidden')));
});
it('skips credential forms and excludes input values, scripts, URLs and editable contents', () => {
  const privateGrid = grid('', '<div role="row"><div role="cell">login-secret<input type="password"></div></div>');
  const publicGrid = grid('', header + data.replace('統計學', '統計學<input value="input-secret"><textarea>typed-secret</textarea><span contenteditable="true">edit-secret</span><script>script-secret</script><img src="https://private.example"><a href="https://token.example">教材</a>'));
  const result = capture(privateGrid + publicGrid);
  expect(result.html).toContain('統計學'); expect(result.html).toContain('教材');
  expect(result.html).not.toMatch(/secret|example|<input|<script|href|<img/);
});
it('escapes HTML-like course names in ARIA cells', () => {
  const result = capture(grid('', header + data.replace('統計學', '&lt;script&gt;課名&lt;/script&gt;')));
  expect(result.html).toContain('&lt;script&gt;課名&lt;/script&gt;');
  expect(result.html).not.toContain('<script>');
});
it('reads no cookies or browser storage when handling accessible grids', () => {
  const result = capture(grid(), (window) => {
    Object.defineProperty(window.document, 'cookie', { get: () => { throw new Error('cookie access'); } });
    for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get: () => { throw new Error('storage access'); } });
  });
  expect(result.html).toContain('統計學');
});
it('still handles ordinary native tables with explicit empty span attributes', () => {
  expect(capture(native.replace('<td>英文', '<td rowspan="" colspan="">英文')).html).toContain('<td>英文</td>');
});

it.each(['grid', 'native'])('does not append separators to nested header wrappers in a %s table', (kind) => {
  const source = (kind === 'grid' ? grid() : native).replace('課程名稱', '<div><div><span>課程名稱</span></div></div>');
  const result = capture(source);
  expect(result.html).toContain('<th>課程名稱</th>');
  expect(extractSchoolPageTables(result.html!, 'grades')).toHaveLength(1);
});
it('separates distinct blocks inside a cell but preserves a single wrapped label', () => {
  const result = capture(grid('', header + data.replace('統計學', '<div>統計學</div><div>教室303</div>')));
  expect(result.html).toContain('<td>統計學 / 教室303</td>');
});
