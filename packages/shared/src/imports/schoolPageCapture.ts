/**
 * A bookmark the user runs on their own school page. Keep this script literal:
 * bundler/minifier helper functions must never become part of the bookmark URL.
 * It reads rendered table text only and has no network or credential access.
 */
const SCHOOL_PAGE_CAPTURE_SCRIPT = String.raw`
(() => {
  'use strict';
  const hostId = 'campus-one-school-table-capture';
  if (document.getElementById(hostId)) return;
  const ignored = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS']);
  const blocks = new Set(['DIV', 'P', 'LI', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
  const limits = { tables: 200, rows: 500, cells: 5000, text: 200000, nodes: 40000, bytes: 512000 };
  const previousFocus = document.activeElement;
  let visited = 0;
  function visible(element) {
    if (!element || !element.isConnected) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity !== '' && Number(style.opacity) === 0) return false;
      if (node.tagName === 'DETAILS' && !node.open && !element.closest('summary')) return false;
    }
    return element.getClientRects().length > 0;
  }
  function textOf(root) {
    const chunks = [];
    function visit(node) {
      if (++visited > limits.nodes) throw new Error('large');
      if (node.nodeType === 3) { chunks.push(node.nodeValue || ''); return; }
      if (node.nodeType !== 1 || ignored.has(node.tagName) || node.tagName === 'TABLE' || !visible(node)) return;
      if (node.tagName === 'BR') { chunks.push('\n'); return; }
      if (blocks.has(node.tagName)) chunks.push('\n');
      for (const child of Array.from(node.childNodes)) visit(child);
      if (blocks.has(node.tagName)) chunks.push('\n');
    }
    for (const child of Array.from(root.childNodes)) visit(child);
    return chunks.join('').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function readTable(table) {
    if (!visible(table)) return null;
    const originalRows = Array.from(table.rows).filter(row => row.closest('table') === table);
    const visibleRows = originalRows.filter(visible);
    if (!visibleRows.length) return null;
    if (visibleRows.length > limits.rows) throw new Error('large');
    let cellCount = 0;
    let textLength = 0;
    const rows = visibleRows.map(row => {
      const groupRows = originalRows.filter(item => item.parentElement === row.parentElement);
      const sourceIndex = groupRows.indexOf(row);
      return Array.from(row.cells).filter(visible).map(cell => {
        const text = textOf(cell);
        if (++cellCount > limits.cells || (textLength += text.length) > limits.text) throw new Error('large');
        if (cell.colSpan > 100) throw new Error('large');
        const rawSpan = cell.rowSpan === 0 ? groupRows.length - sourceIndex : cell.rowSpan;
        const rowSpan = groupRows.slice(sourceIndex, sourceIndex + rawSpan).filter(visible).length;
        return { text, header: cell.tagName === 'TH', rowSpan: Math.max(1, rowSpan), colSpan: Math.max(1, cell.colSpan) };
      });
    }).filter(row => row.length);
    if (rows.length < 2) return null;
    const firstRows = rows.slice(0, 8);
    const headerText = firstRows.map(row => row.map(cell => cell.text).join(' ')).join('\n');
    const hasName = /課程名稱|科目名稱|課名|科目|course\s*(?:name|title)?|subject/i.test(headerText);
    const hasDetails = /學分|成績|課號|教師|老師|教室|星期|節次|學期|credit|grade|score|instructor|teacher|room|period/i.test(headerText);
    const weekly = firstRows.some(row => row.filter(cell => /^(?:(?:星期|週|周)\s*)?[一二三四五六日天]$|^(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i.test(cell.text.trim())).length >= 3);
    if (!(hasName && hasDetails) && !weekly) return null;
    const caption = table.caption && visible(table.caption) ? textOf(table.caption) : '';
    const label = (caption || firstRows[0].map(cell => cell.text).filter(Boolean).join(' · ')).slice(0, 120);
    return { rows, label: label || '校務表格', weekly };
  }
  let candidates = [];
  let oversized = false;
  try {
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length > limits.tables) throw new Error('large');
    for (const table of tables) {
      try {
        const result = readTable(table);
        if (result) candidates.push(result);
      } catch { oversized = true; }
    }
  } catch { oversized = true; }
  const pageTitle = String(document.title || '學校校務資料').slice(0, 200);
  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;color-scheme:light;';
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  const style = document.createElement('style');
  style.textContent = ':host{font-family:system-ui,-apple-system,sans-serif;color:#17201c;font-size:14px;line-height:1.65}*{box-sizing:border-box}.mask{height:100%;padding:24px;background:rgba(12,22,18,.48);display:flex;align-items:center;justify-content:center}.panel{width:min(100%,620px);max-height:90vh;overflow:auto;background:#fff;border:1px solid #d9e1db;border-radius:16px;padding:24px;box-shadow:0 16px 56px rgba(0,0,0,.16)}h2{font-size:21px;line-height:1.5;margin:0 0 8px}p{margin:8px 0 16px;color:#4b5d53}button{font:inherit;min-height:44px;border:1px solid #c7d4ca;border-radius:8px;padding:10px 14px;color:#17201c;background:#fff;cursor:pointer}button:focus-visible{outline:3px solid #45835e;outline-offset:3px}button:disabled{opacity:.5;cursor:not-allowed}.table{display:block;width:100%;text-align:left;margin:10px 0;overflow-wrap:anywhere}.table[aria-pressed=true]{border-color:#25623f;background:#eff6f0}.table strong,.table small{display:block}.table small{color:#4b5d53;margin-top:4px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.download{background:#245a3a;color:#fff;border-color:#245a3a}.note{font-size:12px}.status{color:#245a3a;margin-top:14px}@media(max-width:480px){.mask{padding:12px}.panel{padding:18px}.actions button{flex:1}}';
  root.append(style);
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const mask = element('div', undefined, 'mask');
  const panel = element('section', undefined, 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'capture-title');
  const title = element('h2', candidates.length ? '選擇要帶入 Campus One 的表格' : '沒有找到可擷取的校務表格');
  title.id = 'capture-title';
  panel.append(title);
  panel.append(element('p', candidates.length ? '只擷取目前頁面可見的表格文字，下載後回到 Campus One 核對匯入。這是單次擷取，不會自動同步。' : '請先自行登入學校，並開啟課表或成績頁。不是 HTML 表格的頁面，可回到 Campus One 選擇截圖或貼上文字。'));
  if (oversized) panel.append(element('p', '部分表格超過單次擷取範圍。請縮小頁面顯示的學期或資料範圍，再試一次。', 'note'));
  let selected = candidates.length === 1 ? 0 : -1;
  const choices = [];
  const status = element('p', '', 'status');
  status.setAttribute('role', 'status');
  const download = element('button', '下載選取的表格', 'download');
  download.type = 'button';
  download.disabled = selected < 0;
  candidates.forEach((candidate, index) => {
    const choice = element('button', undefined, 'table');
    choice.type = 'button';
    choice.setAttribute('aria-pressed', String(selected === index));
    choice.append(element('strong', '表格 ' + (index + 1) + ' · ' + candidate.label));
    choice.append(element('small', (candidate.weekly ? '週課表' : '課程／成績資料') + ' · ' + candidate.rows.length + ' 列（含表頭）'));
    choice.addEventListener('click', () => {
      selected = index;
      choices.forEach((button, position) => button.setAttribute('aria-pressed', String(position === selected)));
      download.disabled = false;
      status.textContent = '';
    });
    choices.push(choice);
    panel.append(choice);
  });
  const close = element('button', '關閉');
  close.type = 'button';
  function dismiss() {
    document.removeEventListener('keydown', keydown, true);
    host.remove();
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
  }
  function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(panel.querySelectorAll('button')).filter(button => !button.disabled);
    const focused = root.activeElement || document.activeElement;
    if (event.shiftKey && focused === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (!event.shiftKey && focused === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
  }
  close.addEventListener('click', dismiss);
  download.addEventListener('click', () => {
    if (selected < 0 || !candidates[selected]) return;
    try {
      const output = document.implementation.createHTMLDocument('Campus One 校務表格');
      const meta = output.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      output.head.prepend(meta);
      const heading = output.createElement('h1');
      heading.textContent = pageTitle;
      output.body.append(heading);
      const table = output.createElement('table');
      const caption = output.createElement('caption');
      caption.textContent = candidates[selected].label;
      table.append(caption);
      const body = output.createElement('tbody');
      for (const row of candidates[selected].rows) {
        const tr = output.createElement('tr');
        for (const cell of row) {
          const td = output.createElement(cell.header ? 'th' : 'td');
          td.textContent = cell.text;
          if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
          if (cell.colSpan > 1) td.colSpan = cell.colSpan;
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      output.body.append(table);
      const blob = new Blob(['<!doctype html>\n' + output.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
      if (blob.size > limits.bytes) throw new Error('large');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'CampusOne-school-table.html';
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = '已交由瀏覽器下載。請回到 Campus One 選擇這份 HTML 檔，核對內容後匯入。';
    } catch { status.textContent = '這次未能下載表格。請改用複製表格或截圖匯入。'; }
  });
  const actions = element('div', undefined, 'actions');
  if (candidates.length) actions.append(download);
  actions.append(close);
  panel.append(actions, status);
  panel.append(element('p', '工具不讀取登入憑證，也不把資料傳送到任何伺服器。', 'note'));
  mask.append(panel);
  root.append(mask);
  document.body.append(host);
  document.addEventListener('keydown', keydown, true);
  (choices[0] || close).focus();
})();
void 0;
`;

/** Copy this URL into a browser bookmark; opening it never contacts a service. */
export function buildSchoolPageCaptureBookmarklet(): string {
  return `javascript:${encodeURIComponent(SCHOOL_PAGE_CAPTURE_SCRIPT.trim())}`;
}
