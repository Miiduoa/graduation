import { afterEach, expect, it, vi } from 'vitest';
import {
  isSchoolPortalUrl, PORTAL_CAPTURE_TIMEOUT_MS, SchoolPortalCapture,
  schoolPortalCaptureScript, schoolPortalFor,
} from '@campus/shared/src/imports/schoolPortal';
import { extractSchoolPageTables } from '@campus/shared/src/imports/schoolPageTables';

const portal = schoolPortalFor('ntu')!;
const url = 'https://my.ntu.edu.tw/students?session=do-not-persist';
const id = '12345678-1234-1234-1234-123456789012';
const payload = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  type: 'campus-school-tables', id, html: '<table>資料</table>', ...overrides,
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it.each(['pu', 'ntu', 'nthu'])('only provides the configured %s HTTPS entry', (school) => {
  const entry = schoolPortalFor(school)!;
  expect(isSchoolPortalUrl(entry, entry.entryUrl)).toBe(true);
  expect(schoolPortalFor('unknown')).toBeNull();
});
it.each([
  'http://my.ntu.edu.tw/', 'https://ntu.edu.tw.evil.org/', 'https://evilntu.edu.tw/',
  'https://my.ntu.edu.tw@evil.org/', 'https://u:p@my.ntu.edu.tw/', 'https://my.ntu.edu.tw:444/',
  'file:///x', 'javascript:alert(1)', 'data:text/html,x', 'https://my.ntu.edu.tw\\@evil.org',
  'https://my.ntu.edu.tw./', ' https://my.ntu.edu.tw/', 'https://alcat.pu.edu.tw/',
])('blocks unsafe or other-campus navigation: %s', (value) => expect(isSchoolPortalUrl(portal, value)).toBe(false));
it('accepts only a requested, one-shot message', () => {
  const gate = new SchoolPortalCapture(portal);
  expect(gate.receive(payload(), url, 0)).toBeNull();
  gate.begin(id, url, 0);
  expect(gate.receive(payload({ id: 'wrong' }), url, 1)).toBeNull();
  expect(gate.receive(payload(), url, 2)).toBe('<table>資料</table>');
  expect(gate.receive(payload(), url, 3)).toBeNull();
});
it.each(['navigation', 'cancel', 'timeout'])('invalidates the pending read on %s', (reason) => {
  const gate = new SchoolPortalCapture(portal); gate.begin(id, url, 0);
  if (reason === 'cancel') gate.cancel();
  expect(gate.receive(payload(), reason === 'navigation' ? 'https://my.ntu.edu.tw/next' : url,
    reason === 'timeout' ? PORTAL_CAPTURE_TIMEOUT_MS : 1)).toBeNull();
  expect(gate.receive(payload(), url, 2)).toBeNull();
});
it('rejects oversized and failed reads without passing partial HTML to the parser', () => {
  for (const message of [payload({ error: 'limit' }), 'x'.repeat(501001)]) {
    const gate = new SchoolPortalCapture(portal); gate.begin(id, url, 0);
    expect(() => gate.receive(message, url, 1)).toThrow();
    expect(gate.receive(payload(), url, 2)).toBeNull();
  }
});
function capture(markup: string) {
  document.body.innerHTML = markup;
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  const postMessage = vi.fn();
  const location = { href: url, origin: 'https://my.ntu.edu.tw' };
  const script = schoolPortalCaptureScript(id, url);
  const execute = new Function('window', 'document', 'location', script);
  execute({ ReactNativeWebView: { postMessage } }, document, location);
  expect(postMessage).toHaveBeenCalledTimes(1);
  return JSON.parse(postMessage.mock.calls[0][0]) as { html?: string; error?: string };
}
const gradeTable = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
  '<tr><td>統計學</td><td>3</td><td>88</td></tr></table>';
it('captures visible table text and academic term for the existing parser', () => {
  const result = capture('<h2>115 學年度 第 1 學期</h2>' + gradeTable);
  const tables = extractSchoolPageTables(result.html!, 'grades');
  expect(tables).toHaveLength(1);
  expect(tables[0].suggestedTerm).toEqual({ academicYear: '115', semester: '1' });
  expect(tables[0].text).toContain('統計學');
});
it('does not collect login inputs, scripts, hidden text or arbitrary page HTML', () => {
  const result = capture('<input value="private-user"><textarea>private-note</textarea>' +
    '<table><tr><td><input type="password" value="secret-password"></td></tr></table>' +
    '<div hidden>' + gradeTable.replace('統計學', 'hidden-course') + '</div>' +
    gradeTable.replace('統計學', '統計學<input value="hidden-id"><span style="display:none">secret-code</span><script>var x="private-script"</script>'));
  expect(result.html).toContain('統計學');
  expect(result.html).not.toMatch(/private-|secret-|hidden-course|hidden-id|<script|<input|<textarea/);
});
it('preserves spans and extracts inner tables without duplicating outer layout tables', () => {
  const result = capture('<table><tr><td><table><tr><th>節次</th><th>星期一</th><th>星期二</th></tr>' +
    '<tr><td>1</td><td rowspan="2">資料庫</td><td></td></tr><tr><td>2</td><td></td></tr></table></td></tr></table>');
  expect(result.html?.match(/<table>/g)).toHaveLength(1);
  expect(result.html).toContain('rowspan="2"');
  expect(extractSchoolPageTables(result.html!, 'timetable', 'pu')[0].rowCount).toBe(1);
});
it('fails a large cell instead of silently truncating a course name', () => {
  const result = capture(gradeTable.replace('統計學', 'a'.repeat(501)));
  expect(result.error).toBe('limit'); expect(result.html).toBeUndefined();
});
it('requires tables and never falls back to collecting the whole page', () => {
  const result = capture('<p>student name and unrelated private information</p>');
  expect(result.error).toBe('no-table'); expect(result.html).toBeUndefined();
});
it('has no credential, storage, HTML serialization or network collection API', () => {
  const script = schoolPortalCaptureScript(id, url);
  expect(script).not.toMatch(/document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|\.value\b|outerHTML/);
});
