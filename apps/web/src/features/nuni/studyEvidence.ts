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
  // Explicit Unicode bidi marks, embeddings, overrides and isolates can make
  // a quote render in a different reading order from its literal source bytes.
  // Reject those controls only in the citation, not the original document.
  // Ordinary RTL letters, full emoji and ZWJ sequences remain valid.
  if (/\p{Bidi_Control}/u.test(quote)) return null;
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
  // Only whole visible grapheme clusters can be cited. A literal substring
  // may start inside a combining sequence, emoji, or flag. Check each candidate
  // against native grapheme boundaries rather than caching all candidate hits:
  // a long imported document can contain hundreds of thousands of repetitions.
  const firstMatch = source.indexOf(quote);
  if (firstMatch === -1) return null;
  // If an older WebView lacks grapheme segmentation, never claim evidence that
  // might be only part of a visible character.
  if (typeof Intl.Segmenter !== 'function') return null;
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source);
  if (typeof segments.containing !== 'function') return null;
  const isBoundary = (index: number): boolean =>
    index === 0 || index === source.length || segments.containing(index)?.index === index;

  let selected = -1;
  let occurrences = 0;
  for (let from = firstMatch; from < source.length;) {
    const start = source.indexOf(quote, from);
    if (start === -1) break;
    const end = start + quote.length;
    if (!isBoundary(start) || !isBoundary(end)) {
      // Partial grapheme matches can overlap a later *complete* quotation.
      from = start + 1;
      continue;
    }
    if (occurrences === occurrence) selected = start;
    occurrences += 1;
    // Count only non-overlapping complete quotations, preserving v1 behavior.
    from = end;
  }
  if (selected === -1) return null;
  return {
    before: source.slice(0, selected),
    quote,
    after: source.slice(selected + quote.length),
    occurrences,
  };
}
