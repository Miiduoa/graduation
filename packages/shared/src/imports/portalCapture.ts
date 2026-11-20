/** Browser-assisted personal imports, not an institutional SSO integration. */
export type SchoolPortal = { schoolId: string; label: string; url: string; domain: string };
const PORTALS: Record<string, Omit<SchoolPortal, 'schoolId'>> = {
  pu: { label: '靜宜 e 校園', url: 'https://alcat.pu.edu.tw/', domain: 'pu.edu.tw' },
  nchu: { label: '中興單一入口', url: 'https://portal.nchu.edu.tw/', domain: 'nchu.edu.tw' },
  nccu: { label: '政大 iNCCU', url: 'https://i.nccu.edu.tw/', domain: 'nccu.edu.tw' },
  ncu: { label: '中央 Portal', url: 'https://portal.ncu.edu.tw/', domain: 'ncu.edu.tw' },
  ntu: { label: '臺大 myNTU', url: 'https://my.ntu.edu.tw/', domain: 'ntu.edu.tw' },
  nthu: { label: '清華校務資訊系統', url: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/', domain: 'nthu.edu.tw' },
};
export function schoolPortalFor(schoolId: string): SchoolPortal | null {
  const key = schoolId.startsWith('tw-') ? schoolId.slice(3) : schoolId;
  return Object.hasOwn(PORTALS, key) ? { schoolId, ...PORTALS[key] } : null;
}
export const PORTAL_CAPTURE_LIMIT = 400_000;
export const PORTAL_CAPTURE_TIMEOUT = 12_000;
export function schoolPortalOrigin(portal: SchoolPortal, value: string): string | null {
  try {
    if (!value || value.length > 4096 || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\')) return null;
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
        if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.opacity === '0') return false;
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
      // Separate actual block siblings, not layout wrappers around a single header.
      var content = '', previousBlock = false;
      Array.prototype.forEach.call(node.childNodes, function (child) {
        var part = plain(child);
        if (!part) return;
        var block = child.nodeType === 1 && /^(DIV|P|LI)$/.test(child.tagName);
        if (content.trim() && part.trim() && (block || previousBlock) &&
          !content.endsWith(' / ') && !part.startsWith(' / ')) content += ' / ';
        content += part;
        if (part.trim()) previousBlock = block;
      });
      return content;
    }
    var tableSelector = 'table,[role="table"],[role="grid"],[role="treegrid"]';
    var cellSelector = '[role="columnheader"],[role="rowheader"],[role="cell"],[role="gridcell"]';
    function spanValue(cell, name, aria) {
      var value = cell.getAttribute(aria ? 'aria-' + name : name);
      if (value === null || value === '') return 1;
      if (!/^\\d+$/.test(value) || Number(value) < 1) throw new Error(aria ? 'unavailable' : 'too-large');
      if (Number(value) > 32) throw new Error('too-large');
      return Number(value);
    }
    function span(cell, name, aria) {
      return cell.getAttribute(aria ? 'aria-' + name : name)
        ? ' ' + name + '="' + spanValue(cell, name, aria) + '"' : '';
    }
    function countValue(element, name) {
      var value = element.getAttribute(name);
      if (value === null) return null;
      // -1 explicitly means the total is unknown, not that the visible slice is complete.
      if (!/^(?:0|[1-9]\\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('unavailable');
      return Number(value);
    }
    function unsettled(element) {
      return !!element.closest('[aria-busy="true"]') ||
        !!(element.getAttribute('aria-owns') || '').trim();
    }
    function verifyIndex(element, name, expected) {
      var actual = countValue(element, name);
      if (actual !== null && actual !== expected) throw new Error('unavailable');
    }
    function collectTables(doc) {
      // Only explicit table semantics are supported. Never guess from CSS class names.
      var tables = doc.querySelectorAll(tableSelector);
      if (tables.length > 60) throw new Error('too-large');
      Array.prototype.forEach.call(tables, function (table) {
        if (!visible(table) || table.querySelector(tableSelector)) return;
        var hasPassword = Array.prototype.some.call(table.getElementsByTagName('input'), function (input) {
          return String(input.getAttribute('type') || '').toLowerCase() === 'password';
        });
        if (hasPassword) return;
        // Hierarchies, externally owned rows, and loading placeholders are not flat records.
        if (table.getAttribute('role') === 'treegrid' || unsettled(table)) throw new Error('unavailable');
        Array.prototype.forEach.call(table.querySelectorAll('[role="rowgroup"]'), function (group) {
          if (unsettled(group)) throw new Error('unavailable');
        });
        var aria = table.tagName !== 'TABLE';
        var sourceRows = aria ? table.querySelectorAll('[role="row"]') : table.rows;
        if (rowCount + sourceRows.length > 1200) throw new Error('too-large');
        var rows = Array.prototype.filter.call(sourceRows, function (row) {
          return visible(row) && (!aria || row.closest(tableSelector) === table);
        });
        var declaredRows = countValue(table, 'aria-rowcount');
        var declaredColumns = countValue(table, 'aria-colcount');
        if (declaredRows !== null && declaredRows !== rows.length) throw new Error('unavailable');
        if (!rows.length) return;
        var structural = aria || declaredRows !== null || declaredColumns !== null ||
          !!table.querySelector('[aria-rowindex],[aria-colindex]');
        var carried = [], width = null;
        tableCount += 1;
        if (tableCount > 30) throw new Error('too-large');
        add('<table>');
        rows.forEach(function (row, rowIndex) {
          if (unsettled(row)) throw new Error('unavailable');
          verifyIndex(row, 'aria-rowindex', rowIndex + 1);
          verifyIndex(row, 'aria-colindex', 1);
          var cells = aria ? Array.prototype.filter.call(row.querySelectorAll(cellSelector), function (cell) {
            return cell.closest('[role="row"]') === row && cell.closest(tableSelector) === table;
          }) : Array.prototype.slice.call(row.cells);
          rowCount += 1;
          if (rowCount > 1200 || cells.length > 32) throw new Error('too-large');
          var cursor = 0;
          add('<tr>');
          cells.forEach(function (cell) {
            if (unsettled(cell)) throw new Error('unavailable');
            var down = spanValue(cell, 'rowspan', aria), across = spanValue(cell, 'colspan', aria);
            if (structural) {
              while (carried[cursor] > rowIndex) cursor += 1;
              verifyIndex(cell, 'aria-rowindex', rowIndex + 1);
              verifyIndex(cell, 'aria-colindex', cursor + 1);
              if (cursor + across > 32) throw new Error('too-large');
              if (rowIndex + down > rows.length) throw new Error('unavailable');
              for (var column = cursor; column < cursor + across; column += 1) {
                if (carried[column] > rowIndex) throw new Error('unavailable');
                carried[column] = rowIndex + down;
              }
              cursor += across;
            }
            var role = cell.getAttribute('role');
            var tag = aria ? (role === 'columnheader' || role === 'rowheader' ? 'th' : 'td') : (cell.tagName === 'TH' ? 'th' : 'td');
            // A DIV used as a cell is a boundary, not a separator appended to its own text.
            var text = visible(cell) ? plain(cell).trim() : '';
            if (text.length > 500) throw new Error('too-large');
            add('<' + tag + span(cell, 'rowspan', aria) + span(cell, 'colspan', aria) + '>' + escapeText(text) + '</' + tag + '>');
          });
          if (structural) {
            var occupied = carried.filter(function (until) { return until > rowIndex; }).length;
            if (width === null) width = occupied;
            if (occupied !== width || (declaredColumns !== null && occupied !== declaredColumns)) throw new Error('unavailable');
          }
          add('</tr>');
        });
        add('</table>');
      });
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
          // Retain only explicit term fragments, never names or unrelated profile headings.
          var terms = title.normalize('NFKC').match(/(?:民國\\s*)?(?:1\\d{2}|20\\d{2})\\s*學年度\\s*(?:第?\\s*[12一二]\\s*學期|[上下]\\s*學期|暑(?:期|修))/g) || [];
          terms.forEach(function (term) { add('<h2>' + escapeText(term) + '</h2>'); });
        }
      });
      collectTables(doc);
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
