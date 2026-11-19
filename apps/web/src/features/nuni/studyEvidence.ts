/**
 * Highlight the exact quoted span of the *current* passage. Locating a quote
 * only proves character overlap, never the correctness of a model explanation.
 */
export type StudyEvidenceLocation = {
  before: string;
  quote: string;
  after: string;
  occurrences: number;
};

export function locateStudyEvidence(source: string, quote: string, occurrence = 0): StudyEvidenceLocation | null {
  // A model's "quotation" made entirely of invisible formatting, isolated
  // combining marks or Braille blank is not readable source evidence, even
  // when identical bytes occur in the PDF. Keep real words, maths and emoji
  // unchanged, including any format characters attached to them.
  if (!source || !quote.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{M}\u2800]/gu, '')) return null;
  // A visually reordered quote or half of a UTF-16 surrogate pair is not
  // inspectable evidence. Leave source bytes intact; fail closed on the quote.
  // Real RTL letters, full emoji and ZWJ sequences remain valid.
  if (/[\u202d\u202e]/u.test(quote)) return null;
  for (let index = 0; index < quote.length; index++) {
    const unit = quote.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = quote.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return null;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null;
    }
  }
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) return null;
  // UTF-16 substring equality is necessary but not sufficient: 'e' inside e+accent
  // or '👩' inside 👩‍💻 is not a complete, inspectable quotation.
  // Keep the original source unchanged; only count whole grapheme-cluster matches.
  const matches: number[] = [];
  for (let from = 0; from < source.length;) {
    const match = source.indexOf(quote, from);
    if (match === -1) break;
    matches.push(match);
    from = match + quote.length;
  }
  if (matches.length === 0) return null;
  // Fail closed on older engines, rather than claiming that a truncated quote
  // is verified when the Unicode boundary check is unavailable.
  if (typeof Intl.Segmenter !== 'function') return null;

  // Track just the candidate boundaries instead of caching every grapheme in
  // a large PDF. This keeps memory proportional to the number of matches.
  const wanted = new Set<number>();
  for (const start of matches) {
    wanted.add(start);
    wanted.add(start + quote.length);
  }
  const boundaries = new Set<number>();
  for (const { index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)) {
    if (wanted.has(index)) boundaries.add(index);
  }
  if (wanted.has(source.length)) boundaries.add(source.length);

  let selected = -1;
  let occurrences = 0;
  for (const start of matches) {
    if (!boundaries.has(start) || !boundaries.has(start + quote.length)) continue;
    if (occurrences === occurrence) selected = start;
    occurrences += 1;
  }
  if (selected === -1) return null;
  return {
    before: source.slice(0, selected),
    quote,
    after: source.slice(selected + quote.length),
    occurrences,
  };
}
