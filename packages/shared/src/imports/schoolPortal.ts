export type SchoolPortal = Readonly<{ schoolId: string; name: string; entryUrl: string; domain: string }>;

// Navigation entries, not a claim that every private page or embedded SSO works.
const PORTALS: readonly SchoolPortal[] = [
  { schoolId: 'pu', name: '靜宜大學', entryUrl: 'https://alcat.pu.edu.tw/', domain: 'pu.edu.tw' },
  { schoolId: 'ntu', name: '國立臺灣大學', entryUrl: 'https://my.ntu.edu.tw/', domain: 'ntu.edu.tw' },
  { schoolId: 'nthu', name: '國立清華大學', entryUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/', domain: 'nthu.edu.tw' },
];
export const schoolPortalFor = (schoolId: string): SchoolPortal | null =>
  PORTALS.find((portal) => portal.schoolId === schoolId) ?? null;

export function isSchoolPortalUrl(portal: SchoolPortal, value: string): boolean {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === portal.domain || url.hostname.endsWith(`.${portal.domain}`));
  } catch { return false; }
}

export const PORTAL_CAPTURE_TIMEOUT_MS = 10_000;
export const PORTAL_HTML_LIMIT = 500_000;
export class SchoolPortalError extends Error {
  constructor(message: string) { super(message); this.name = 'SchoolPortalError'; }
}

type Pending = { id: string; url: string; expiresAt: number };
/** A single explicit read. Navigation, timeout and session teardown cancel it. */
export class SchoolPortalCapture {
  private pending: Pending | null = null;
  constructor(private readonly portal: SchoolPortal) {}
  cancel(): void { this.pending = null; }
  begin(id: string, url: string, now = Date.now()): string {
    this.cancel();
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id) || !isSchoolPortalUrl(this.portal, url))
      throw new SchoolPortalError('請先開啟目前學校的 HTTPS 校務頁面。');
    this.pending = { id, url, expiresAt: now + PORTAL_CAPTURE_TIMEOUT_MS };
    return schoolPortalCaptureScript(id, url);
  }
  receive(raw: string, nativeUrl: string, now = Date.now()): string | null {
    const pending = this.pending;
    if (!pending) return null;
    if (now >= pending.expiresAt || nativeUrl !== pending.url || !isSchoolPortalUrl(this.portal, nativeUrl)) {
      this.cancel();
      return null;
    }
    if (typeof raw !== 'string' || raw.length > PORTAL_HTML_LIMIT + 1000) {
      this.cancel();
      throw new SchoolPortalError('表格太大，請改用檔案匯入。');
    }
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    const value = data as Record<string, unknown>;
    if (value.type !== 'campus-school-tables' || value.id !== pending.id) return null;
    this.cancel();
    if (value.error || typeof value.html !== 'string' || !value.html || value.html.length > PORTAL_HTML_LIMIT) {
      throw new SchoolPortalError(value.error === 'limit'
        ? '這頁資料太多，請只開啟要匯入的課表或改用檔案。'
        : '沒有讀到可用表格。請開啟課表或成績列表；圖片、跨網域框架及部分登入方式仍需使用檔案匯入。');
    }
    return value.html;
  }
}

/** Injected only after the person presses Read. No form values, cookies, storage or network. */
export function schoolPortalCaptureScript(id: string, expectedUrl: string): string {
  return `(function () {
    var id = ${JSON.stringify(id)}, expected = ${JSON.stringify(expectedUrl)};
    if (location.href !== expected || !window.ReactNativeWebView) return;
    var bridge = window.ReactNativeWebView, output = [], size = 0, visited = [], nodes = 0, tables = 0;
    function send(value) { bridge.postMessage(JSON.stringify(Object.assign({ type: 'campus-school-tables', id: id }, value))); }
    function escape(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function visible(element) {
      for (var parent = element; parent && parent.nodeType === 1; parent = parent.parentElement) {
        var style = parent.ownerDocument.defaultView.getComputedStyle(parent);
        if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
      }
      return element.getClientRects().length > 0;
    }
    function text(node) {
      if (++nodes > 60000) throw new Error('limit');
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1 || /^(INPUT|TEXTAREA|SELECT|OPTION|BUTTON|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|FRAME|SVG|CANVAS)$/i.test(node.tagName) || !visible(node)) return '';
      if (node.tagName === 'BR') return ' / ';
      return Array.prototype.map.call(node.childNodes, text).join(' ');
    }
    function add(value) { size += value.length; if (size > ${PORTAL_HTML_LIMIT}) throw new Error('limit'); output.push(value); }
    function span(cell, name) { var n = Number(cell.getAttribute(name)); return Number.isInteger(n) && n > 0 && n <= 32 ? n : 1; }
    function scan(doc, depth) {
      if (!doc || depth > 4 || visited.indexOf(doc) !== -1) return;
      visited.push(doc);
      if (visited.length > 12) throw new Error('limit');
      Array.prototype.forEach.call(doc.querySelectorAll('h1,h2,h3,caption'), function (heading) {
        if (!visible(heading)) return;
        var value = text(heading).replace(/\\s+/g, ' ').trim();
        if (/學年度/.test(value) && /學期|暑期|暑修/.test(value) && value.length <= 200) add('<p>' + escape(value) + '</p>');
      });
      Array.prototype.forEach.call(doc.querySelectorAll('table'), function (table) {
        if (table.querySelector('table') || !visible(table) || table.querySelector('input[type="password"]')) return;
        if (++tables > 30 || table.rows.length > 1200) throw new Error('limit');
        add('<table>');
        Array.prototype.forEach.call(table.rows, function (row) {
          if (!visible(row)) return;
          if (row.cells.length > 32) throw new Error('limit');
          add('<tr>');
          Array.prototype.forEach.call(row.cells, function (cell) {
            var value = visible(cell) ? text(cell).replace(/\\s+/g, ' ').trim() : '';
            if (value.length > 500) throw new Error('limit');
            var tag = cell.tagName === 'TH' ? 'th' : 'td';
            add('<' + tag + ' rowspan="' + span(cell, 'rowspan') + '" colspan="' + span(cell, 'colspan') + '">' + escape(value) + '</' + tag + '>');
          });
          add('</tr>');
        });
        add('</table>');
      });
      Array.prototype.forEach.call(doc.querySelectorAll('iframe,frame'), function (frame) {
        if (!visible(frame)) return;
        var child;
        try { child = frame.contentDocument; if (!child || child.location.origin !== location.origin) return; } catch (_) { return; }
        scan(child, depth + 1);
      });
    }
    try { scan(document, 0); if (!tables) return send({ error: 'no-table' }); send({ html: output.join('') }); }
    catch (error) { send({ error: error && error.message === 'limit' ? 'limit' : 'unavailable' }); }
  })(); true;`;
}
