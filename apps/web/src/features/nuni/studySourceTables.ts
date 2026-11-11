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
  const trimmed = line.trim();
  // A literal pipe inside a cell or inline code needs a full Markdown parser.
  // Do not silently shift the student's values into the wrong columns.
  if (!trimmed.includes('|') || trimmed.includes('\\|') ||
      trimmed.includes(String.fromCharCode(96))) return null;
  const body = trimmed.replace(/^\|/u, '').replace(/\|$/u, '');
  const cells = body.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.length <= MAX_COLUMNS ? cells : null;
}

function fenceMarker(line: string): string | null {
  const trimmed = line.trimStart();
  const marker = trimmed[0];
  if (marker !== '~' && marker !== String.fromCharCode(96)) return null;
  let length = 0;
  while (trimmed[length] === marker) length += 1;
  return length >= 3 ? marker : null;
}

export function extractStudySourceTables(source: string): StudySourceTable[] {
  if (!source.includes('|')) return [];
  const lines = source.split(/\r?\n/u);
  const tables: StudySourceTable[] = [];
  let fence: string | null = null;

  for (let index = 0; index < lines.length - 2 && tables.length < MAX_TABLES; index += 1) {
    const marker = fenceMarker(lines[index]);
    if (marker) {
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
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
    while (cursor < lines.length) {
      const row = parseSimplePipeRow(lines[cursor]);
      if (!row || row.length !== headers.length) break;
      rows.push(row);
      cursor += 1;
      if (rows.length > MAX_ROWS) break;
    }
    // Do not quietly truncate a source table and suggest it is complete.
    if (rows.length > 0 && rows.length <= MAX_ROWS)
      tables.push({ startLine: index + 1, headers, rows });
    index = cursor - 1;
  }
  return tables;
}
