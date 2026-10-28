/** Logical CSV/TSV records with offsets into the unchanged source, not a re-serialization. */
export type ImportDelimitedRecord = {
  start: number;
  end: number;
  contentEnd: number;
  cells: string[];
};

/** Strict field quoting: embedded delimiters/newlines and doubled quotes stay in one cell. */
export function readImportDelimitedRecords(
  text: string,
  delimiter: ',' | '\t',
): ImportDelimitedRecord[] | null {
  const records: ImportDelimitedRecord[] = [];
  let start = 0;
  let cell = '';
  let cells: string[] = [];
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  // A UTF-8 BOM is metadata only at the start. Its bytes still belong to record 1.
  let index = text.startsWith('\uFEFF') ? 1 : 0;
  for (; index < text.length; index++) {
    const character = text[index];
    if (state === 'quoted') {
      if (character !== '"') cell += character;
      else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else state = 'closed';
      continue;
    }
    const newline = character === '\n' || (character === '\r' && text[index + 1] === '\n');
    if (character === delimiter || newline) {
      cells.push(cell);
      cell = '';
      state = 'start';
      if (newline) {
        const contentEnd = index;
        if (character === '\r') index++;
        records.push({ start, end: index + 1, contentEnd, cells });
        cells = [];
        start = index + 1;
      }
      continue;
    }
    if (state === 'closed' || character === '\r') return null;
    if (character === '"') {
      if (state !== 'start') return null;
      state = 'quoted';
    } else {
      cell += character;
      state = 'plain';
    }
  }
  if (state === 'quoted') return null;
  if (start < text.length) {
    cells.push(cell);
    records.push({ start, end: text.length, contentEnd: text.length, cells });
  }
  return records;
}
