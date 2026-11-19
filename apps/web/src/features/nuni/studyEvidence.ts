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
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) return null;
  let selected = -1;
  let occurrences = 0;
  // Count full, non-overlapping, exact-text matches. Never normalize student material.
  for (let from = 0; from < source.length;) {
    const match = source.indexOf(quote, from);
    if (match === -1) break;
    if (occurrences === occurrence) selected = match;
    occurrences += 1;
    from = match + quote.length;
  }
  if (selected === -1) return null;
  return {
    before: source.slice(0, selected),
    quote,
    after: source.slice(selected + quote.length),
    occurrences,
  };
}
