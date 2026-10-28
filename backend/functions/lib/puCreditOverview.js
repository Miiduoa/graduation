'use strict';

const { parseFragment } = require('parse5');

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_SECTION_LENGTH = 100_000;
const HEADING = '修習學分累計';
const FIELDS = [
  'required', 'elective', 'externalElective', 'generalOld',
  'generalNew', 'subtotal', 'totalRequired', 'minorDouble',
];
const LABELS = new Map([
  ['必修', 'required'], ['選修', 'elective'], ['外系選修', 'externalElective'],
  ['通識-六大學群', 'generalOld'], ['通識-四大向度', 'generalNew'],
  ['小計', 'subtotal'],
  ['小計(成績及格取得之學分,不等於畢業學分)', 'subtotal'],
  ['畢業應修總學分', 'totalRequired'], ['輔雙', 'minorDouble'],
]);
const OMITTED = new Set([
  'script', 'style', 'template', 'head', 'noscript', 'input',
  'select', 'button', 'textarea', '#comment', 'svg', 'canvas',
]);
const BLOCKS = new Set(['br', 'tr', 'td', 'th', 'div', 'p', 'section', 'article', 'fieldset', 'li', 'dl', 'dt', 'dd']);
const SECTION_BLOCKS = new Set([...BLOCKS, 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SECTION_HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'legend', 'caption']);
const OTHER_SECTION = /^(?:本學期學分總計|本學期修習學分|本學期取得學分|通識已修明細|各向度修習情形|修習中通識科目|外系學分列表|畢業條件|歷年修課明細|審核項目總覽)(?:[：:(]|$)/;
const BRACKETS = /【([^】]{1,100})】|\[([^\]]{1,100})\]|［([^］]{1,100})］/g;

function normalize(value) {
  return value.replace(/\s|\u00a0/g, '').replace(/（/g, '(').replace(/）/g, ')')
    .replace(/，/g, ',').replace(/[－﹣]/g, '-');
}

function attributes(node) {
  return Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
}

function isHidden(attrs) {
  const style = (attrs.style || '').replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.hasOwn(attrs, 'hidden') || attrs['aria-hidden']?.toLowerCase() === 'true' ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(style);
}

function failure(code = 'unavailable') {
  return {
    success: false, code, creditOverview: null,
    error: code === 'session-expired' ? '校務連線已到期，請重新連線。' : '暫時無法辨識校方學分累計資料。',
  };
}

function visibleDocument(root) {
  const visible = new Set();
  const ordered = [];
  const stack = [{ node: root, depth: 0 }];
  let loginForm = false;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (depth > 100 || ordered.length > 100_000) throw new Error('Document structure exceeds limits');
    const attrs = attributes(node);
    if (isHidden(attrs)) continue;
    if (node.nodeName === 'input' && attrs.type?.toLowerCase() === 'password') loginForm = true;
    if (node.nodeName === 'form' && /(?:^|\/)index_check\.php(?:[?#]|$)/i.test(attrs.action || '')) loginForm = true;
    if (OMITTED.has(node.nodeName)) continue;
    visible.add(node);
    ordered.push(node);
    for (const child of [...(node.childNodes || [])].reverse()) stack.push({ node: child, depth: depth + 1 });
  }
  const previews = new Map();
  for (const node of [...ordered].reverse()) {
    const value = node.nodeName === '#text' ? node.value : (node.childNodes || [])
      .filter(child => visible.has(child)).map(child => previews.get(child) || '').join('');
    previews.set(node, value.length > 120 ? value.slice(0, 120) + '\0' : value);
  }
  const isHeading = node => normalize(previews.get(node) || '').replace(/[：:]$/, '') === HEADING;
  const headings = ordered.filter(node => isHeading(node) && !(node.childNodes || []).some(isHeading));
  return { visible, headings, loginForm, isHeading };
}

function readText(root, visible, limit = MAX_SECTION_LENGTH, markHeadings = false) {
  const parts = [];
  const stack = [root];
  let length = 0;
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === 'string') { parts.push(item); continue; }
    if (!visible.has(item)) continue;
    if (item.nodeName === '#text') {
      if (markHeadings && OTHER_SECTION.test(normalize(item.value))) parts.push('\0');
      length += item.value.length;
      if (length > limit) throw new Error('Section exceeds limits');
      parts.push(item.value);
    } else {
      if (markHeadings && item !== root && (SECTION_HEADINGS.has(item.nodeName) ||
          (item.nodeName === 'th' && !hasLabel(readText(item, visible))))) parts.push('\0');
      if (BLOCKS.has(item.nodeName)) stack.push('\n');
      for (const child of [...(item.childNodes || [])].reverse()) stack.push(child);
    }
  }
  return parts.join('').replace(/\u00a0/g, ' ');
}

function hasLabel(text) {
  return [...text.matchAll(BRACKETS)].some(match => LABELS.has(normalize(match[1] || match[2] || match[3])));
}

function ancestor(node, name) {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current.nodeName === name) return current;
  }
  return null;
}

function tableRows(table, visible) {
  const rows = [];
  const stack = [...(table.childNodes || [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!visible.has(node) || node.nodeName === 'table') continue;
    if (node.nodeName === 'tr') rows.push(node);
    else for (const child of [...(node.childNodes || [])].reverse()) stack.push(child);
  }
  return rows;
}

function sectionText(heading, document) {
  const { visible, isHeading } = document;
  const row = heading.nodeName === 'tr' ? heading : ancestor(heading, 'tr');
  let candidates;
  if (row && isHeading(row)) {
    const table = ancestor(row, 'table');
    const rows = tableRows(table, visible);
    candidates = rows.slice(rows.indexOf(row) + 1);
  } else {
    let block = heading;
    while (block.parentNode && isHeading(block.parentNode)) block = block.parentNode;
    const siblings = block.parentNode?.childNodes || [];
    candidates = siblings.slice(siblings.indexOf(block) + 1);
  }
  const blocks = [];
  let inline = '';
  for (const node of candidates) {
    if (SECTION_BLOCKS.has(node.nodeName) && node.nodeName !== 'br') {
      if (inline.trim()) blocks.push(inline);
      inline = '';
      blocks.push(readText(node, visible, MAX_SECTION_LENGTH, true));
    } else inline += readText(node, visible, MAX_SECTION_LENGTH, true);
  }
  if (inline.trim()) blocks.push(inline);
  const parts = [];
  let length = 0;
  for (const block of blocks) {
    const boundary = block.indexOf('\0');
    const text = (boundary < 0 ? block : block.slice(0, boundary)).trim();
    if (!text) {
      if (boundary >= 0) break;
      continue;
    }
    // Only consecutive labelled result blocks belong to this heading.
    if (!hasLabel(text)) break;
    parts.push(text);
    length += text.length;
    if (length > MAX_SECTION_LENGTH) throw new Error('Section exceeds limits');
    if (boundary >= 0) break;
  }
  return parts.join('\n');
}

function creditValue(segment) {
  const lines = segment.trim().replace(/^[：:]\s*/, '').split(/\r?\n/);
  if (lines.slice(1).some(line => /^\s*[+-]?\d+(?:\.\d+)?\s*(?:學分)?\s*$/.test(line))) return null;
  const value = lines[0].trim();
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(?:學分)?\s*(?:[（(][^()（）\n]{0,180}[）)])?\s*$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number >= 0 && number <= 1000 ? number : null;
}

/** Labels follow the public PU manual; its subtotal is not graduation eligibility. */
function parsePuCreditOverview(html) {
  if (typeof html !== 'string' || !html.trim() || Buffer.byteLength(html, 'utf8') > MAX_DOCUMENT_BYTES) return failure();
  try {
    const root = parseFragment(html);
    const document = visibleDocument(root);
    const page = readText(root, document.visible, MAX_DOCUMENT_BYTES);
    if (document.loginForm || /請重新登入|尚未登入|登入逾時|session\s*(?:has\s*)?expired/i.test(page)) return failure('session-expired');
    if (/系統(?:目前)?維護中|系統暫停服務|服務暫停|system\s+maintenance|service\s+unavailable/i.test(page)) return failure();
    if (document.headings.length !== 1) return failure();
    const section = sectionText(document.headings[0], document);
    const matches = [...section.matchAll(BRACKETS)];
    const totals = Object.fromEntries(FIELDS.map(field => [field, null]));
    const seen = new Map();
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const field = LABELS.get(normalize(match[1] || match[2] || match[3]));
      if (!field) continue;
      const value = creditValue(section.slice(match.index + match[0].length, matches[index + 1]?.index));
      if (seen.has(field) && seen.get(field) !== value) return failure();
      seen.set(field, value);
      totals[field] = value;
    }
    const missingFields = FIELDS.filter(field => totals[field] === null);
    if (missingFields.length === FIELDS.length) return failure();
    return {
      success: true,
      creditOverview: {
        version: 1, source: 'pu-credit-review', totals,
        coverage: { status: missingFields.length ? 'partial' : 'complete', missingFields },
      },
    };
  } catch {
    return failure();
  }
}

module.exports = { parsePuCreditOverview };
