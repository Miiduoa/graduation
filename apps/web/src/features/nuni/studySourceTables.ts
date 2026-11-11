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
  // A literal pipe inside a cell or inline code needs a full Markdown parser.
  // Do not silently shift the student's values into the wrong columns.
  if (!trimmed.includes('|') || trimmed.includes('\\|') ||
      trimmed.includes(String.fromCharCode(96))) return null;
  const body = trimmed.replace(/^\|/u, '').replace(/\|$/u, '');
  const cells = body.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.length <= MAX_COLUMNS ? cells : null;
}

function fenceMarker(line: string): { character: string; length: number; suffix: string } | null {
  const trimmed = line.trimStart();
  if (line.length - trimmed.length > 3) return null;
  const marker = trimmed[0];
  if (marker !== '~' && marker !== String.fromCharCode(96)) return null;
  let length = 0;
  while (trimmed[length] === marker) length += 1;
  return length >= 3 ? { character: marker, length, suffix: trimmed.slice(length) } : null;
}

export function extractStudySourceTables(source: string): StudySourceTable[] {
  if (!source.includes('|')) return [];
  const lines = source.split(/\r?\n/u);
  const tables: StudySourceTable[] = [];
  let fence: { character: string; length: number } | null = null;

  for (let index = 0; index < lines.length - 2 && tables.length < MAX_TABLES; index += 1) {
    const marker = fenceMarker(lines[index]);
    if (marker) {
      if (fence === null) fence = marker;
      else if (fence.character === marker.character && marker.length >= fence.length && !marker.suffix.trim()) fence = null;
      continue;
    }
    if (fence) continue;
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
