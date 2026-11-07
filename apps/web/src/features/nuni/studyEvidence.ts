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

export function locateStudyEvidence(source: string, quote: string): StudyEvidenceLocation | null {
  if (!source || !quote.trim()) return null;
  const first = source.indexOf(quote);
  if (first === -1) return null;
  let occurrences = 0;
  for (let from = first, match = first; match !== -1; match = source.indexOf(quote, from)) {
    occurrences += 1;
    from = match + quote.length;
  }
  return {
    before: source.slice(0, first),
    quote,
    after: source.slice(first + quote.length),
    occurrences,
  };
}
