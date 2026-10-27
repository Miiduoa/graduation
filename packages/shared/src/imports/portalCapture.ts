/** Browser-assisted personal imports, not an institutional SSO integration. */
export type SchoolPortal = { schoolId: string; label: string; url: string; domain: string };
const PORTALS: Record<string, Omit<SchoolPortal, 'schoolId'>> = {
  pu: { label: '靜宜 e 校園', url: 'https://alcat.pu.edu.tw/', domain: 'pu.edu.tw' },
  nchu: { label: '中興單一入口', url: 'https://portal.nchu.edu.tw/', domain: 'nchu.edu.tw' },
  nccu: { label: '政大 iNCCU', url: 'https://i.nccu.edu.tw/', domain: 'nccu.edu.tw' },
  ncu: { label: '中央 Portal', url: 'https://portal.ncu.edu.tw/', domain: 'ncu.edu.tw' },
};
export function schoolPortalFor(schoolId: string): SchoolPortal | null {
  const key = schoolId.startsWith('tw-') ? schoolId.slice(3) : schoolId;
  return Object.hasOwn(PORTALS, key) ? { schoolId, ...PORTALS[key] } : null;
}
export const PORTAL_CAPTURE_LIMIT = 400_000;
export const PORTAL_CAPTURE_TIMEOUT = 12_000;
export function schoolPortalOrigin(portal: SchoolPortal, value: string): string | null {
  try {
    if (!value || value.length > 4096 || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char === '\\')) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname !== portal.domain && !url.hostname.endsWith(`.${portal.domain}`)) return null;
    return url.origin;
  } catch { return null; }
}
export type PortalCapture = { html: string; origin: string; blockedFrames: number };
export type PortalCaptureRequest = { id: string; origin: string };
export type PortalCaptureResult =
  | { status: 'ok'; value: PortalCapture }
  | { status: 'error'; reason: 'too-large' | 'no-table' | 'unavailable' }
  | { status: 'ignored' };
/** A page message is untrusted. It can only produce a personal-import preview. */
export function readPortalCapture(
  portal: SchoolPortal,
  request: PortalCaptureRequest | null,
  eventUrl: string,
  currentUrl: string,
  data: string,
): PortalCaptureResult {
  if (!request || typeof data !== 'string' || data.length > PORTAL_CAPTURE_LIMIT * 6 + 2048) return { status: 'ignored' };
  if (schoolPortalOrigin(portal, currentUrl) !== request.origin ||
    schoolPortalOrigin(portal, eventUrl) !== request.origin) return { status: 'ignored' };
  try {
    const body = JSON.parse(data);
    if (!body || Array.isArray(body) || body.version !== 1 || body.id !== request.id || body.origin !== request.origin ||
      Object.keys(body).some((key) => !['version', 'id', 'origin', 'html', 'blockedFrames', 'error'].includes(key))) return { status: 'ignored' };
    if (body.error) return ['too-large', 'no-table', 'unavailable'].includes(body.error)
      ? { status: 'error', reason: body.error } : { status: 'ignored' };
    if (typeof body.html !== 'string' || !body.html || body.html.length > PORTAL_CAPTURE_LIMIT ||
      !Number.isInteger(body.blockedFrames) || body.blockedFrames < 0 || body.blockedFrames > 50) return { status: 'ignored' };
    // Only escaped text and a tiny, attribute-restricted table vocabulary cross the bridge.
    // No scripts, forms, links, event handlers, URLs, inputs or images are accepted.
    const residual = body.html.replace(/<\/?(?:table|tr|h2)>|<\/(?:td|th)>|<(?:td|th)(?: rowspan="(?:[1-9]|[12]\d|3[0-2])")?(?: colspan="(?:[1-9]|[12]\d|3[0-2])")?>/g, '');
    if (/[<>]/.test(residual) || !body.html.includes('<table>')) return { status: 'ignored' };
    return { status: 'ok', value: { html: body.html, origin: body.origin, blockedFrames: body.blockedFrames } };
  } catch { return { status: 'ignored' }; }
}

/** Injected ONLY after the user presses Read. Does not inspect cookies or form values. */
export function schoolPortalCaptureScript(request: PortalCaptureRequest): string {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(request.id) || !/^https:\/\/[a-z0-9.-]+$/.test(request.origin)) {
    throw new Error('Invalid portal capture request');
  }
  return `(function () {
    'use strict';
    var id = ${JSON.stringify(request.id)};
    var origin = ${JSON.stringify(request.origin)};
    if (window.top !== window || window.location.origin !== origin) return;
    var limit = ${PORTAL_CAPTURE_LIMIT};
    var html = '', blockedFrames = 0, tableCount = 0, rowCount = 0, nodes = 0;
    var computedStyles = new WeakMap();
    function send(payload) {
      window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({version: 1, id: id, origin: origin}, payload)));
    }
    function add(value) {
      if (html.length + value.length > limit) throw new Error('too-large');
      html += value;
    }
    function escapeText(value) {
      return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function visible(element) {
      var node = element;
      while (node && node.nodeType === 1) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
        var css = computedStyles.get(node);
        if (!css) {
          css = node.ownerDocument.defaultView.getComputedStyle(node);
          computedStyles.set(node, css);
        }
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return false;
        node = node.parentElement;
      }
      return true;
    }
    function plain(node) {
      nodes += 1;
      if (nodes > 50000) throw new Error('too-large');
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1 || !visible(node) ||
        /^(INPUT|TEXTAREA|SELECT|OPTION|BUTTON|FORM|SCRIPT|STYLE|TEMPLATE|NOSCRIPT|SVG|IFRAME|FRAME|OBJECT|EMBED)$/.test(node.tagName) ||
        node.isContentEditable || node.getAttribute('contenteditable') === 'true') return '';
      if (node.tagName === 'BR') return ' / ';
      var content = Array.prototype.map.call(node.childNodes, plain).join('');
      return /^(DIV|P|LI)$/.test(node.tagName) && content.trim() ? content + ' / ' : content;
    }
    function span(cell, name) {
      var value = cell.getAttribute(name);
      if (!value) return '';
      if (!/^\\d+$/.test(value) || Number(value) < 1 || Number(value) > 32) throw new Error('too-large');
      return ' ' + name + '="' + Number(value) + '"';
    }
    function collect(doc) {
      var headings = [];
      ['h1', 'h2', 'h3', 'caption'].forEach(function (tag) {
        Array.prototype.push.apply(headings, doc.getElementsByTagName(tag));
      });
      if (headings.length > 100) throw new Error('too-large');
      Array.prototype.forEach.call(headings, function (heading) {
        if (visible(heading)) {
          var title = plain(heading).trim();
          if (title.length > 500) throw new Error('too-large');
          if (title) add('<h2>' + escapeText(title) + '</h2>');
        }
      });
      var tables = doc.getElementsByTagName('table');
      if (tables.length > 60) throw new Error('too-large');
      Array.prototype.forEach.call(tables, function (table) {
        if (!visible(table) || table.getElementsByTagName('table').length) return;
        var hasPassword = Array.prototype.some.call(table.getElementsByTagName('input'), function (input) {
          return String(input.getAttribute('type') || '').toLowerCase() === 'password';
        });
        if (hasPassword) return;
        tableCount += 1;
        if (tableCount > 30) throw new Error('too-large');
        // Reject oversize documents before walking each cell or computing styles.
        if (rowCount + table.rows.length > 1200) throw new Error('too-large');
        add('<table>');
        Array.prototype.forEach.call(table.rows, function (row) {
          if (!visible(row)) return;
          rowCount += 1;
          if (rowCount > 1200 || row.cells.length > 32) throw new Error('too-large');
          add('<tr>');
          Array.prototype.forEach.call(row.cells, function (cell) {
            var tag = cell.tagName === 'TH' ? 'th' : 'td';
            var text = visible(cell) ? plain(cell).trim() : '';
            if (text.length > 500) throw new Error('too-large');
            add('<' + tag + span(cell, 'rowspan') + span(cell, 'colspan') + '>' + escapeText(text) + '</' + tag + '>');
          });
          add('</tr>');
        });
        add('</table>');
      });
    }
    try {
      var queue = [document], seen = [], frames = 0;
      while (queue.length) {
        var doc = queue.shift();
        if (seen.indexOf(doc) >= 0) continue;
        seen.push(doc);
        collect(doc);
        var childFrames = Array.prototype.slice.call(doc.getElementsByTagName('iframe'))
          .concat(Array.prototype.slice.call(doc.getElementsByTagName('frame')));
        childFrames.forEach(function (frame) {
          frames += 1;
          if (frames > 50) throw new Error('too-large');
          if (!visible(frame)) return;
          try {
            if (!frame.contentDocument || frame.contentWindow.location.origin !== origin) { blockedFrames += 1; return; }
            queue.push(frame.contentDocument);
          } catch (_) { blockedFrames += 1; }
        });
      }
      if (!tableCount) { send({error: 'no-table'}); return; }
      send({html: html, blockedFrames: blockedFrames});
    } catch (error) { send({error: error && error.message === 'too-large' ? 'too-large' : 'unavailable'}); }
  })(); true;`;
}
