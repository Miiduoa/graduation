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

function parseSimplePipeRow(line: string): string[] | null {
  // Markdown renders four-space / tab-indented rows as code, not a table.
  if (/^(?: {4}| {0,3}\t)/u.test(line)) return null;
  const trimmed = line.trim();
  // Raw HTML code elements are not Markdown table cell content.
  if (/<\/?(?:pre|code|script|style|textarea)\b/iu.test(trimmed)) return null;
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
    // HTML boundaries follow source order; Markdown inline code is literal.
    let hiddenLine = inHtmlComment || htmlCodeBlocks.length > 0;
    for (const match of line.matchAll(/<!--|--!?>|<\/?(pre|code|script|style|textarea)\b[^>]*>/giu)) {
      const token = match[0];
      if (!inHtmlComment && htmlCodeBlocks.length === 0 &&
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
      if (!tag) continue;
      if (token.startsWith('</')) {
        if (htmlCodeBlocks[htmlCodeBlocks.length - 1] === tag) htmlCodeBlocks.pop();
      } else if (!/\/>$/u.test(token)) {
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
