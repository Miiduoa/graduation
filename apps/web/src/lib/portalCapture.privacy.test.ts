// @vitest-environment node
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import {
  readPortalCapture, schoolPortalFor, schoolPortalOrigin, schoolPortalCaptureScript,
} from '@campus/shared/src/imports/portalCapture';
import { extractSchoolPageTables } from '@campus/shared/src/imports/schoolPageTables';

type PortalWindow = { eval(source: string): unknown; close(): void };
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => { window: PortalWindow };
};
const request = { id: 'privacy_12345678', origin: 'https://alcat.pu.edu.tw' };
const table = '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>3</td><td>90</td></tr></table>';
function capture(markup: string) {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, {
    url: `${request.origin}/grades`, runScripts: 'outside-only',
  });
  try {
    const messages: string[] = [];
    Object.defineProperty(dom.window, 'ReactNativeWebView', {
      value: { postMessage: (message: string) => messages.push(message) },
    });
    dom.window.eval(schoolPortalCaptureScript(request));
    expect(messages).toHaveLength(1);
    const result = readPortalCapture(schoolPortalFor('pu')!, request, request.origin, request.origin, messages[0]);
    if (result.status !== 'ok') throw new Error('Expected a valid personal preview');
    return result.value.html;
  } finally { dom.window.close(); }
}
it.each(['ntu', 'tw-ntu', 'nthu', 'tw-nthu'])('keeps the exact %s namespace and verified entry domain', (schoolId) => {
  const portal = schoolPortalFor(schoolId)!;
  const nthu = schoolId.endsWith('nthu');
  expect(portal.schoolId).toBe(schoolId);
  expect(portal.url).toBe(nthu ? 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/' : 'https://my.ntu.edu.tw/');
  expect(schoolPortalOrigin(portal, portal.url)).toBe(new URL(portal.url).origin);
  expect(schoolPortalOrigin(portal, 'https://alcat.pu.edu.tw/')).toBeNull();
  expect(schoolPortalOrigin(portal, `https://${portal.domain}.example.org/`)).toBeNull();
});
it('does not forward student names or account IDs from headings, even beside a valid term', () => {
  const html = capture('<h1>陳同學 12345678 個人首頁</h1><h2>陳同學／115 學年度第 1 學期／12345678</h2>' + table);
  expect(html).toContain('<h2>115 學年度第 1 學期</h2>');
  expect(html).not.toMatch(/陳同學|12345678|個人首頁/);
  expect(extractSchoolPageTables(html, 'grades')[0].suggestedTerm).toEqual({ academicYear: '115', semester: '1' });
});
it('does not collect fully transparent text or a table inside a transparent ancestor', () => {
  const html = capture(table.replace('統計學', '統計學<span style="opacity:0">private-note</span>') +
    '<section style="opacity:0">' + table.replace('統計學', 'private-course') + '</section>');
  expect(html).toContain('統計學'); expect(html).not.toMatch(/private-note|private-course/);
  expect(extractSchoolPageTables(html, 'grades')).toHaveLength(1);
});
it('retains both explicit terms so the parser refuses to guess an ambiguous semester', () => {
  const html = capture('<h2>114學年度下學期</h2><h3>115學年度上學期</h3>' + table);
  expect(html).toContain('114學年度下學期'); expect(html).toContain('115學年度上學期');
  expect(extractSchoolPageTables(html, 'grades')[0].suggestedTerm).toBeUndefined();
});
it.each([
  ['１１５ 學年度 第 ２ 學期', '115', '2'],
  ['115學年度上學期', '115', '1'],
  ['2026學年度暑期', '2026', '暑期'],
])('preserves supported term notation: %s', (label, academicYear, semester) => {
  const html = capture(`<h2>${label}／私人姓名</h2>` + table);
  expect(html).not.toContain('私人姓名');
  expect(extractSchoolPageTables(html, 'grades')[0].suggestedTerm).toEqual({ academicYear, semester });
});
it('rejects a DEL control character instead of letting URL normalization disguise it', () => {
  for (const schoolId of ['pu', 'ntu', 'nthu']) {
    const portal = schoolPortalFor(schoolId)!;
    expect(schoolPortalOrigin(portal, portal.url + '\u007f')).toBeNull();
  }
});
