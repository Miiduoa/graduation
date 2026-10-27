// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { schoolPortalCaptureScript, readPortalCapture, schoolPortalFor } from '@campus/shared/src/imports/portalCapture';

// Use the project's existing jsdom dependency without sharing a React test's
// document, selector cache, globals or styles. No browser API is mocked here.
type PortalWindow = {
  document: Document;
  location: { origin: string };
  eval(source: string): unknown;
  close(): void;
};
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => { window: PortalWindow };
};
const portal = schoolPortalFor('pu')!;
const request = { id: 'capture_12345678', origin: 'https://alcat.pu.edu.tw' };
const gradeTable = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>3</td><td>90</td></tr></table>';
function capture(html: string, prepare?: (window: PortalWindow) => void) {
  // outside-only executes our capture script but never scripts supplied by the
  // fixture. Subresource loading is left disabled; no school network is used.
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: `${request.origin}/grades`,
    runScripts: 'outside-only',
  });
  try {
    const messages: string[] = [];
    Object.defineProperty(dom.window, 'ReactNativeWebView', {
      value: { postMessage: (message: string) => messages.push(message) },
    });
    prepare?.(dom.window);
    expect(dom.window.location.origin).toBe(request.origin);
    dom.window.eval(schoolPortalCaptureScript(request));
    expect(messages).toHaveLength(1);
    return JSON.parse(messages[0]);
  } finally {
    dom.window.close();
  }
}
it('extracts visible table text, headings and rowspan in a generic school portal', () => {
  const result = capture('<h2>115 學年度 第 1 學期</h2><table><tr><th>星期一</th></tr><tr><td rowspan="2">程式設計<br>主顧303</td></tr><tr></tr></table>');
  expect(result.html).toContain('115 學年度');
  expect(result.html).toContain('rowspan="2"');
  expect(result.html).toContain('程式設計 / 主顧303');
  expect(readPortalCapture(portal, request, request.origin, request.origin, JSON.stringify(result)).status).toBe('ok');
});
it('does not copy passwords, hidden inputs, script, editable text, links or image URLs', () => {
  const result = capture(gradeTable.replace('統計學', '統計學<input type="hidden" value="secret"><textarea>private</textarea><span contenteditable="true">draft-secret</span><script>script-secret</script><img src="https://private.example"><a href="https://token.example">教材</a>'));
  expect(result.html).toContain('統計學'); expect(result.html).toContain('教材');
  expect(result.html).not.toMatch(/secret|private|\.example|<input|<script|<img|href/);
});
it('ignores the login table but retains real tables wrapped in ASP.NET forms', () => {
  const result = capture('<form><table><tr><td>login-secret<input type="password"></td></tr></table>' + gradeTable + '</form>');
  expect(result.html).toContain('統計學'); expect(result.html).not.toContain('login-secret');
});
it('keeps nested layout tables from duplicating the inner course table', () => {
  const result = capture('<table><tr><td>' + gradeTable + '</td></tr></table>');
  expect(result.html.match(/<table>/g)).toHaveLength(1);
  expect(result.html.match(/統計學/g)).toHaveLength(1);
});
it('does not extract hidden rows, ancestor-hidden tables or CSS-hidden text', () => {
  const result = capture('<section style="display:none">' + gradeTable.replace('統計學', 'hidden-course') + '</section>' + gradeTable.replace('統計學', '統計學<span aria-hidden="true">hidden-name</span><span style="visibility:hidden">invisible-name</span>'));
  expect(result.html).not.toMatch(/hidden-course|hidden-name|invisible-name/);
});
it('escapes angle brackets from text rather than forwarding original markup', () => {
  const result = capture(gradeTable.replace('統計學', '&lt;script&gt;不是程式&lt;/script&gt;'));
  expect(result.html).toContain('&lt;script&gt;'); expect(result.html).not.toContain('<script>');
});
it('rejects huge table cells instead of silently importing a truncated name', () => {
  const result = capture(gradeTable.replace('統計學', '字'.repeat(501)));
  expect(result.error).toBe('too-large'); expect(result.html).toBeUndefined();
});
it('rejects excessive rows and columns without returning partial records', () => {
  expect(capture('<table>' + '<tr><td>課</td></tr>'.repeat(1201) + '</table>').error).toBe('too-large');
  expect(capture('<table><tr>' + '<td>課</td>'.repeat(33) + '</tr></table>').error).toBe('too-large');
});
it('rejects excessive table and heading counts', () => {
  expect(capture(gradeTable.repeat(31)).error).toBe('too-large');
  expect(capture('<h2>標題</h2>'.repeat(101) + gradeTable).error).toBe('too-large');
});
it('rejects unsupported spans rather than inventing a timetable duration', () => {
  expect(capture('<table><tr><td rowspan="33">課</td></tr></table>').error).toBe('too-large');
});
it('does not invent records when the page is image-only or empty', () => {
  expect(capture('<img alt="課表" src="/timetable.png">').error).toBe('no-table');
});
it('does not access cookies or browser storage while reading a real DOM', () => {
  const result = capture(gradeTable, (window) => {
    Object.defineProperty(window.document, 'cookie', { get: () => { throw new Error('cookie access'); } });
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, { get: () => { throw new Error('storage access'); } });
    }
  });
  expect(result.html).toContain('統計學');
});
it('does not execute page scripts and does not leak state between two portal documents', () => {
  const first = capture('<script>document.body.textContent="page-script-executed";</script>' + gradeTable);
  const second = capture('<table><tr><td>' + gradeTable.replace('統計學', '資料庫') + '</td></tr></table>');
  expect(first.html).toContain('統計學');
  expect(first.html).not.toContain('page-script-executed');
  expect(second.html).toContain('資料庫');
  expect(second.html).not.toContain('統計學');
});
it('honors page CSS when collecting visible text from a nested table', () => {
  const result = capture('<style>.private-field { display:none } .hidden-table { visibility:hidden }</style>' +
    '<table><tr><td>' + gradeTable.replace('統計學', '統計學<span class="private-field">private-label</span>') + '</td></tr></table>' +
    gradeTable.replace('<table>', '<table class="hidden-table">').replace('統計學', 'hidden-course'));
  expect(result.html).toContain('統計學');
  expect(result.html).not.toMatch(/private-label|hidden-course/);
});
