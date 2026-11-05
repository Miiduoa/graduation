type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type Word = { x: number; y: number; w: number; h: number; line: string; text: string; confidence: number };
type Band = { first: number; last: number };
type RowRule = { left: number; right: number; y: number };

function readWords(tsv: string, width: number, height: number): Word[] | null {
  if (!tsv || tsv.length > 256_000) return null;
  const words: Word[] = [];
  let page = false;
  for (const row of tsv.trimEnd().split(/\r?\n/u)) {
    const columns = row.split('\t');
    if (columns[0] === 'level') continue;
    const [x, y, w, h] = columns.slice(6, 10).map(Number);
    if (columns[0] === '1') {
      if (page || x !== 0 || y !== 0 || w !== width || h !== height) return null;
      page = true;
    }
    if (!/^[1-5]$/u.test(columns[0])) return null;
    if (columns[0] !== '5') continue;
    const confidence = Number(columns[10]);
    if (!page || columns.length !== 12 || columns[1] !== '1' || words.length >= 1000 ||
      ![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > width || y + h > height || !Number.isFinite(confidence) || confidence < 70 ||
      confidence > 100 || !columns[11].trim() || /[\p{Cc}\p{Cf}]/u.test(columns[11])) return null;
    words.push({ x, y, w, h, line: columns.slice(2, 5).join('/'), text: columns[11].trim(), confidence });
  }
  return words.length ? words : null;
}

function bands(positions: number[]): Band[] {
  const result: Band[] = [];
  for (const value of positions) {
    const previous = result[result.length - 1];
    if (previous && previous.last + 1 === value) previous.last = value;
    else result.push({ first: value, last: value });
  }
  return result;
}

function regular(lines: Band[]): boolean {
  const all = lines.slice(1).map((band, index) => band.first - lines[index].last);
  const widths = all.slice(1); // The leading label column and header row may have their own size.
  return all.every((width) => width >= 18) &&
    Math.max(...widths) <= Math.min(...widths) * 1.16 &&
    lines.every((band) => band.last - band.first <= 6);
}

function cellIndex(lines: Band[], start: number, size: number): number {
  // Tesseract sometimes expands a Chinese character box a few pixels over a rule.
  // Its centre and at least 90% of each axis must still belong to exactly one cell.
  const center = start + size / 2;
  return lines.findIndex((line, index) => index + 1 < lines.length && center > line.last &&
    center < lines[index + 1].first &&
    Math.min(start + size, lines[index + 1].first) - Math.max(start, line.last + 1) >= size * 0.9);
}

function textLines(words: Word[]): string[] {
  const groups = new Map<string, Word[]>();
  for (const word of words) {
    const existing = groups.get(word.line);
    if (existing) existing.push(word);
    else groups.set(word.line, [word]);
  }
  return [...groups.values()].map((group) => {
    let result = '';
    for (const word of group) {
      if (result && !(/[\p{Script=Han}]$/u.test(result) && /^[\p{Script=Han}]/u.test(word.text)))
        result += ' ';
      result += word.text;
    }
    return result;
  });
}

const dayNames = '一二三四五六日';

/** Recover only fully ruled weekly tables. All coordinates belong to the unscaled OCR input image. */
export function recognizeRuledTimetableGrid(pixels: Pixels, tsv: string): string | null {
  const { width, height, data } = pixels;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n >= 48 && n <= 4096) ||
    width * height > 4_000_000 || data.length !== width * height * 4) return null;
  const words = readWords(tsv, width, height);
  if (!words) return null;

  // Locate horizontal rules in the original pixels. A broken rule cannot span the same rectangle.
  const ink = new Uint8Array(width * height);
  const rules: RowRule[] = [];
  const minRun = Math.max(96, Math.ceil(width / 3));
  for (let y = 0; y < height; y++) {
    let runStart = 0;
    for (let x = 0; x <= width; x++) {
      const i = y * width + x, k = i * 4;
      if (x < width) {
        if (data[k + 3] < 240) return null;
        const max = Math.max(data[k], data[k + 1], data[k + 2]);
        if (max <= 218) {
          ink[i] = max < 145 ? 2 : 1;
          continue;
        }
      }
      if (x - runStart >= minRun) rules.push({ left: runStart, right: x - 1, y });
      runStart = x + 1;
    }
  }
  if (!rules.length) return null;
  const { left, right } = rules[0];
  if (left < 2 || right >= width - 2 ||
    rules.some((r) => Math.abs(r.left - left) > 2 || Math.abs(r.right - right) > 2)) return null;
  const horizontal = bands(rules.map((rule) => rule.y));
  if (horizontal.length < 3 || horizontal.length > 22 || !regular(horizontal)) return null;
  const top = horizontal[0].first, bottom = horizontal[horizontal.length - 1].last;
  if (top < 2 || bottom >= height - 2) return null;
  const fullColumns: number[] = [];
  for (let x = left; x <= right; x++) {
    let y = top;
    while (y <= bottom && ink[y * width + x]) y++;
    if (y > bottom) fullColumns.push(x);
  }
  const vertical = bands(fullColumns);
  if (vertical.length < 5 || vertical.length > 9 || !regular(vertical) ||
    vertical[0].first > left + 2 || vertical[vertical.length - 1].last < right - 2) return null;

  const cells: Word[][][] = Array.from({ length: horizontal.length - 1 }, () =>
    Array.from({ length: vertical.length - 1 }, () => []));
  const preamble: Word[] = [];
  for (const word of words) {
    if (word.y + word.h <= top) {
      preamble.push(word);
      continue;
    }
    const row = cellIndex(horizontal, word.y, word.h), col = cellIndex(vertical, word.x, word.w);
    if (row < 0 || col < 0) return null;
    cells[row][col].push(word);
  }
  const titles = textLines(preamble);
  if (titles.length > 1 || (titles.length && !/^(?:\d{3,4}學年度)?(?:第[一二三123]學期)?(?:每週|個人|週)?課表$/u.test(titles[0].replace(/\s/gu, '')))) return null;

  // A missed word in an apparently empty cell must not disappear from the draft.
  // Bound work even if a pathological TSV contains a large number of overlapping boxes.
  let painted = 0;
  const regions = cells.flatMap((row, r) => row.map((group, c) => ({
    group, xMin: vertical[c].last + 1, xMax: vertical[c + 1].first,
    yMin: horizontal[r].last + 1, yMax: horizontal[r + 1].first,
  })));
  regions.push({ group: preamble, xMin: 0, xMax: width, yMin: 0, yMax: top });
  for (const { group, xMin, xMax, yMin, yMax } of regions) {
    let previous: Word | undefined;
    for (const word of group) {
      let x0 = word.x - 4;
      // Tesseract's boxes for a split Chinese word can leave ink in the narrow gap
      // between its characters. Bridge only neighbours on the same line of the same cell.
      if (previous?.line === word.line && word.x > previous.x + previous.w &&
        word.x - (previous.x + previous.w) <= Math.max(word.h, previous.h) * 0.8)
        x0 = previous.x + previous.w - 4;
      x0 = Math.max(xMin, x0);
      const x1 = Math.min(xMax, word.x + word.w + 4);
      const y0 = Math.max(yMin, word.y - 4), y1 = Math.min(yMax, word.y + word.h + 4);
      painted += (y1 - y0) * (x1 - x0);
      if (painted > width * height * 4) return null;
      for (let y = y0; y < y1; y++) ink.fill(0, y * width + x0, y * width + x1);
      previous = word;
    }
  }
  for (let y = 0; y < height; y++) {
    const offset = y * width;
    if (y < top - 2 || y > bottom + 2) {
      if (ink.subarray(offset, offset + width).includes(2)) return null;
    } else if (ink.subarray(offset, offset + left - 1).includes(2) ||
      ink.subarray(offset + right + 2, offset + width).includes(2)) return null;
  }
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      for (let y = horizontal[r].last + 2; y < horizontal[r + 1].first - 1; y++) {
        if (ink.subarray(y * width + vertical[c].last + 2, y * width + vertical[c + 1].first - 1).includes(2)) return null;
      }
    }
  }

  if (cells[0].some((group) => group.some((word) => word.confidence < 85))) return null;
  const header = cells[0].map(textLines);
  if (header.some((lines) => lines.length !== 1) || !/^(?:節次|節數|時段)$/u.test(header[0][0])) return null;
  const days = header.slice(1).map(([label]) => {
    const match = /^(?:星期|週|周)([一二三四五六日天])$/u.exec(label);
    return match ? dayNames.indexOf(match[1].replace('天', '日')) + 1 : 0;
  });
  if (days.some((day, i) => !day || (i > 0 && day <= days[i - 1]))) return null;

  const rows: string[] = [];
  for (let r = 1; r < cells.length; r++) {
    if (cells[r][0].some((word) => word.confidence < 85)) return null;
    const labels = textLines(cells[r][0]).map((label) => label.replace(/\s/gu, ''));
    if (labels.length !== 1 || ![String(r), `第${r}節`].includes(labels[0])) return null;
    for (let c = 1; c < cells[r].length; c++) {
      const lines = textLines(cells[r][c]);
      if (!lines.length) continue;
      const [title, room = ''] = lines;
      if (lines.length > 2 || title.length > 80 || !/\p{L}.*\p{L}/u.test(title) ||
        /^[=+@-]|^(?:午休|空堂|備註|休息|停課|星期|節次)|(?:^|\s)[A-Z]{1,4}[- ]?\d{2,5}[A-Z]?$/iu.test(title) ||
        (room && !/^[A-Z]{1,4}-?\d{2,5}[A-Z]?$/iu.test(room))) return null;
      rows.push([title, '星期' + dayNames[days[c - 1] - 1], r, r, room].join('\t'));
    }
  }
  return rows.length ? [...titles, '課程名稱\t星期\t開始節次\t結束節次\t教室', ...rows].join('\n') : null;
}
