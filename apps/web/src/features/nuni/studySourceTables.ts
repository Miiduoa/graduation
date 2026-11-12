/**
 * Reconstruct only simple Markdown pipe tables already present in a passage.
 * This is a source-text view, not a model interpretation of an image or chart.
 * Ambiguous/malformed tables are omitted instead of guessing missing cells.
 */
export type StudySourceTable = {
  startLine: number;
  headers: string[];
  rows: string[][];
};

const MAX_TABLES = 3;
const MAX_COLUMNS = 8;
const MAX_ROWS = 20;

// A Markdown-looking table in an explicitly hidden HTML wrapper is not
// visible course material. Do not infer CSS visibility or parse arbitrary
// HTML: recognize explicit hidden / aria-hidden=true and literal inline display:none,\n// visibility:hidden / visibility:collapse / content-visibility:hidden;
// this does not infer computed CSS, external stylesheets or chart meaning.
const HIDDEN_HTML_CONTAINERS = new Set(['div', 'section', 'aside']);
// HTML disclosure / dialog bodies are not standalone Markdown tables. Keep
// nested disclosures balanced so a closed inner example cannot expose its parent.
const NESTABLE_HTML_BLOCKS = new Set([...HIDDEN_HTML_CONTAINERS, 'details', 'dialog']);
// Scan every syntactically complete tag so quoted attributes on other HTML
// elements cannot smuggle fake opening/closing tags into the block tracker.
const TABLE_SUPPRESSED_HTML_TAGS = new Set([
  ...NESTABLE_HTML_BLOCKS, 'pre', 'code', 'script', 'style', 'textarea',
  'template', 'noscript', 'svg', 'math', 'table',
]);

function hasExplicitHiddenInlineStyle(style: string): boolean {
  // Only recognize literal inline visibility declarations. CSS properties
  // cascade independently; a visible value for one property cannot override
  // a hidden value for another. Same-property !important and order still apply.
  // This is not a computed-style parser (external styles and var() are unknown).
  const effective = new Map<string, { value: string; important: boolean }>();
  for (const part of style.split(';')) {
    const property = /^\s*(display|visibility|content-visibility)\s*:\s*(.*?)\s*$/iu.exec(part);
    if (!property) continue;
    const name = property[1].toLowerCase();
    const important = /\s*!important\s*$/iu.test(property[2]);
    const value = property[2].replace(/\s*!important\s*$/iu, '').trim().toLowerCase();
    if (!value) continue;
    const previous = effective.get(name);
    if (!previous || important || !previous.important)
      effective.set(name, { value, important });
  }
  return effective.get('display')?.value === 'none' ||
    ['hidden', 'collapse'].includes(effective.get('visibility')?.value ?? '') ||
    effective.get('content-visibility')?.value === 'hidden';
}

function hasHiddenHtmlAttribute(token: string): boolean {
  // Only actual HTML attributes count. Searching the whole token for words
  // such as "hidden" also matches a quoted title/description and can hide a
  // legitimate course table that students need to read.
  const opening = /^<[A-Za-z][\w:-]*/u.exec(token);
  if (!opening) return false;
  const attributes = token.slice(opening[0].length);
  for (const match of attributes.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\x60=<>]+)))?/gu)) {
    const name = match[1].toLowerCase();
    // HTML's boolean hidden attribute is active even when written hidden="false".
    if (name === 'hidden') return true;
    if (name === 'style' && hasExplicitHiddenInlineStyle(match[2] ?? match[3] ?? match[4] ?? ''))
      return true;
    if (name === 'aria-hidden' &&
        (match[2] ?? match[3] ?? match[4] ?? '').toLowerCase() === 'true') return true;
  }
  return false;
}

function parseSimplePipeRow(line: string): string[] | null {
  // Markdown renders four-space / tab-indented rows as code, not a table.
  if (/^(?: {4}| {0,3}\t)/u.test(line)) return null;
  const trimmed = line.trim();
  // HTML inside an otherwise plausible Markdown cell can contain hidden
  // answers or formatting. Without a Markdown/HTML renderer we cannot tell
  // what is visible, so omit the entire table instead of exposing it as text.
  // Plain comparisons such as "x < y" are not HTML tags.
  if (/<\/?[A-Za-z][\w:-]*(?=[\s/>])[^>]*>/u.test(trimmed)) return null;
  // A literal pipe inside a cell or inline code needs a full Markdown parser.
  // Do not silently shift the student's values into the wrong columns.
  if (!trimmed.includes('|') || trimmed.includes('\\|') ||
      trimmed.includes(String.fromCharCode(96)) ||
      trimmed.includes('<!--') || trimmed.includes('-->')) return null;
  const body = trimmed.replace(/^\|/u, '').replace(/\|$/u, '');
  const cells = body.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.length <= MAX_COLUMNS ? cells : null;
}

function fenceMarker(line: string): { character: string; length: number; suffix: string } | null {
  const trimmed = line.trimStart();
  // Markdown fences may be indented by at most three ASCII spaces.
  // A leading tab reaches the fourth column and is an indented code line,
  // not an opening/closing fence. Never let it expose fake table rows.
  const indent = line.slice(0, line.length - trimmed.length);
  if (!/^ {0,3}$/u.test(indent)) return null;
  const marker = trimmed[0];
  if (marker !== '~' && marker !== String.fromCharCode(96)) return null;
  let length = 0;
  while (trimmed[length] === marker) length += 1;
  return length >= 3 ? { character: marker, length, suffix: trimmed.slice(length) } : null;
}

/** Markdown inline code contains literal tags, not active HTML blocks. */
function isInsideInlineCode(line: string, target: number): boolean {
  const tick = String.fromCharCode(96);
  for (let offset = 0; offset < line.length;) {
    if (line[offset] !== tick) { offset += 1; continue; }
    // In Markdown text, an escaped backtick cannot open inline code.
    // Ignore only the escaped character: additional backticks in the same
    // run may still form a delimiter. Inside code, closing ticks remain raw.
    let backslashes = 0;
    for (let previous = offset - 1; previous >= 0 && line[previous] === '\\'; previous -= 1)
      backslashes += 1;
    if (backslashes % 2 === 1) { offset += 1; continue; }
    const start = offset;
    while (line[offset] === tick) offset += 1;
    const width = offset - start;
    let closingEnd = -1;
    for (let probe = offset; probe < line.length;) {
      if (line[probe] !== tick) { probe += 1; continue; }
      const begin = probe;
      while (line[probe] === tick) probe += 1;
      if (probe - begin === width) { closingEnd = probe; break; }
    }
    if (closingEnd < 0) continue;
    if (target >= start && target < closingEnd) return true;
    offset = closingEnd;
    if (offset > target) break;
  }
  return false;
}

export function extractStudySourceTables(source: string): StudySourceTable[] {
  if (!source.includes('|')) return [];
  const lines = source.split(/\r?\n/u);
  const tables: StudySourceTable[] = [];
  let fence: { character: string; length: number } | null = null;
  let inHtmlComment = false;
  const htmlCodeBlocks: string[] = [];

  for (let index = 0; index < lines.length - 2 && tables.length < MAX_TABLES; index += 1) {
    const line = lines[index];
    // Recognize fences before HTML-looking words in the fence info string.
    // Within a real HTML comment/raw block, fence-like text is inert.
    const marker = fenceMarker(line);
    if (fence) {
      if (marker && fence.character === marker.character &&
          marker.length >= fence.length && !marker.suffix.trim()) fence = null;
      continue;
    }
    if (!inHtmlComment && htmlCodeBlocks.length === 0 && marker) {
      fence = marker;
      continue;
    }
    // An indented Markdown code line is literal source text. A sample
    // "<!--" or "<pre>" in that line must not hide the next real table.
    // Keep processing indented closing tags while inside an actual HTML block.
    if (!inHtmlComment && htmlCodeBlocks.length === 0 &&
        /^(?: {4}| {0,3}\t)/u.test(line)) continue;
    // HTML boundaries follow source order; Markdown inline code is literal.
    let hiddenLine = inHtmlComment || htmlCodeBlocks.length > 0;
    for (const match of line.matchAll(/<!--|--!?>|<\/?([A-Za-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu)) {
      const token = match[0];
      // In a disclosure or hidden container, a paired inline-code example
      // such as `</details>` is not an actual closing tag. Otherwise it
      // prematurely exposes the still-hidden answer beneath the example.
      // Raw <pre>/<code> blocks are HTML, not Markdown inline-code contexts.
      if (!inHtmlComment &&
          (htmlCodeBlocks.length === 0 ||
            NESTABLE_HTML_BLOCKS.has(htmlCodeBlocks[htmlCodeBlocks.length - 1])) &&
          isInsideInlineCode(line, match.index ?? 0)) continue;
      if (inHtmlComment) {
        if (token === '-->' || token === '--!>') inHtmlComment = false;
        hiddenLine = true;
        continue;
      }
      if (token === '<!--') {
        if (htmlCodeBlocks.length === 0) inHtmlComment = true;
        hiddenLine = true;
        continue;
      }
      if (token === '-->') {
        hiddenLine = true;
        continue;
      }
      const tag = match[1]?.toLowerCase();
      if (!tag || !TABLE_SUPPRESSED_HTML_TAGS.has(tag)) continue;
      // Preformatted examples contain literal tag-looking text. In contrast,
      // nested containers of the same type inside a hidden wrapper must be
      // balanced, or the inner closing tag could expose unpublished rows.
      const closing = token.startsWith('</');
      const selfClosing = /\/>$/u.test(token);
      if (htmlCodeBlocks.length > 0) {
        const current = htmlCodeBlocks[htmlCodeBlocks.length - 1];
        if (closing && current === tag) htmlCodeBlocks.pop();
        else if (!closing && !selfClosing && current === tag && NESTABLE_HTML_BLOCKS.has(tag))
          htmlCodeBlocks.push(tag);
      } else if (!closing && !selfClosing &&
          (!HIDDEN_HTML_CONTAINERS.has(tag) || hasHiddenHtmlAttribute(token))) {
        htmlCodeBlocks.push(tag);
      }
      hiddenLine = true;
    }
    if (hiddenLine) continue;
    const headers = parseSimplePipeRow(lines[index]);
    const separator = parseSimplePipeRow(lines[index + 1]);
    if (!headers || !separator || headers.some((header) => !header) ||
        separator.length !== headers.length ||
        !separator.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;

    const rows: string[][] = [];
    let cursor = index + 2;
    let malformed = false;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const row = parseSimplePipeRow(line);
      if (!row) {
        // An escaped pipe, inline code or indented row can make a table
        // ambiguous. Do not show only the earlier rows as if complete.
        if (line.includes('|')) malformed = true;
        break;
      }
      if (row.length !== headers.length) {
        malformed = true;
        break;
      }
      rows.push(row);
      cursor += 1;
      if (rows.length > MAX_ROWS) break;
    }
    // Never quietly truncate an oversized or malformed source table.
    if (!malformed && rows.length > 0 && rows.length <= MAX_ROWS)
      tables.push({ startLine: index + 1, headers, rows });
    index = cursor - 1;
  }
  return tables;
}
