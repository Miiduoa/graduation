/** Reject pieces of identifiers, dates and clocks before matching a quantity. */
function quantityText(evidence: string): string {
  return evidence
    .normalize('NFKC')
    .replace(/[‐‑‒–—−]/gu, '-')
    .replace(/\d+\s*:\s*\d+(?:\s*:\s*\d+)?/gu, ' ')
    .replace(/\d{1,4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}日?/gu, ' ')
    .replace(/\d{1,4}\s*\/\s*\d{1,2}/gu, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日?/gu, ' ')
    .replace(/(?:星期|週|周|禮拜)\s*[一二三四五六日天1-7](?!\d)/gu, ' ');
}

const boundary = '[^\\p{L}\\p{N}_.:+/%-]';
const number = '\\d+(?:\\.\\d+)?';
const period = '(?:\\d{1,2}|[A-Za-z])';

function detached(text: string, index: number, length: number): boolean {
  // Spaces around a sign, clock separator or identifier joiner do not make a cell.
  const before = text.slice(0, index).trimEnd().slice(-1);
  const after = text.slice(index + length).trimStart().slice(0, 1);
  return !/[_.:+/%-]/u.test(before) && !/[_.:+/%-]/u.test(after);
}

/** Presence is evidence, not proof of column assignment. Manual review remains required. */
export function hasCreditEvidence(evidence: string, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  const text = quantityText(evidence);
  const labelled = [
    /(?:學分|\bcredits?)\s*[:=]?\s*(\d+(?:\.\d+)?)(?![\p{L}\p{N}_.:+/%-])/giu,
    /(?:^|[^A-Za-z\d_.:+/%-])(\d+(?:\.\d+)?)\s*(?:學分|credits?\b)/giu,
  ];
  for (const [index, pattern] of labelled.entries()) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index! + match[0].indexOf(match[1]);
      if (
        Number(match[1]) === value &&
        (index === 0
          ? !/[_.:+/%-]/u.test(text.slice(start + match[1].length).trimStart().slice(0, 1))
          : detached(text, start, match[1].length))
      ) return true;
    }
  }
  const cells = new RegExp(`(^|${boundary})(${number})(?=$|${boundary})`, 'gu');
  for (const match of text.matchAll(cells)) {
    const index = match.index! + match[1].length;
    if (Number(match[2]) === value && detached(text, index, match[2].length)) return true;
  }
  return false;
}

export function hasPeriodEvidence(evidence: string, value: string | number): boolean {
  const target = String(value).normalize('NFKC').trim().toUpperCase();
  if (!/^(?:\d{1,2}|[A-Z])$/u.test(target)) return false;
  const matches = (label: string | undefined) =>
    label !== undefined &&
    (/^\d+$/u.test(label) && /^\d+$/u.test(target)
      ? Number(label) === Number(target)
      : label.toUpperCase() === target);
  // Credit annotations must not supply period numbers in a timetable excerpt.
  const text = quantityText(evidence)
    .replace(/(?:學分|\bcredits?)\s*[:=]?\s*\d+(?:\.\d+)?/giu, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:學分|credits?\b)/giu, ' ');
  const labelled = [
    new RegExp(`第\\s*(${period})(?:\\s*[-~至到]\\s*(${period}))?\\s*節`, 'giu'),
    new RegExp(`節次\\s*[:=]?\\s*(${period})(?:\\s*[-~至到]\\s*(${period}))?(?![\\p{L}\\p{N}_.:+/%-])`, 'giu'),
  ];
  for (const pattern of labelled) {
    for (const match of text.matchAll(pattern)) {
      if (matches(match[1]) || matches(match[2])) return true;
    }
  }
  const ranges = new RegExp(
    `(^|${boundary})(${period})\\s*[-~至到]\\s*(${period})(?:\\s*節)?(?=$|${boundary})`,
    'giu',
  );
  for (const match of text.matchAll(ranges)) {
    const index = match.index! + match[1].length;
    if (
      (matches(match[2]) || matches(match[3])) &&
      detached(text, index, match[0].length - match[1].length)
    ) return true;
  }
  const cells = new RegExp(`(^|${boundary})(${period})(?=$|${boundary})`, 'giu');
  for (const match of text.matchAll(cells)) {
    const index = match.index! + match[1].length;
    if (matches(match[2]) && detached(text, index, match[2].length)) return true;
  }
  return false;
}
