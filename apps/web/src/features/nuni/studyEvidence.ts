import { hasVisibleStudyContent } from './courseStudySession';

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

const graphemeContinuation = /[\p{M}\p{Grapheme_Extend}\p{Emoji_Modifier}\u0e33\u0eb3\u200d]/u;
const regionalIndicator = /\p{Regional_Indicator}/u;
// Prepend and Indic_Conjunct_Break=Linker from the Unicode character database.
const indicLinker = /[\u094d\u09cd\u0acd\u0b4d\u0c4d\u0d4d\u1039\u17d2\u1a60\u1b44\u1bab\ua9c0\uaaf6\u{10a3f}\u{11133}\u{113d0}\u{1193e}\u{11a47}\u{11a99}\u{11f42}]/u;
const graphemePrepend = /[\u0600-\u0605\u06dd\u070f\u0890-\u0891\u08e2\u0d4e\u{110bd}\u{110cd}\u{111c2}-\u{111c3}\u{113d1}\u{1193f}\u{11941}\u{11a3a}\u{11a84}-\u{11a89}\u{11d46}\u{11f02}]/u;
const hangulLeading = /^[\u1100-\u115f\ua960-\ua97c]$/u;
const hangulVowel = /^[\u1160-\u11a7\ud7b0-\ud7c6]$/u;
const hangulTrailing = /^[\u11a8-\u11ff\ud7cb-\ud7fb]$/u;

function joinsHangul(previous: string, current: string): boolean {
  const syllable = previous.charCodeAt(0) - 0xac00;
  if (syllable >= 0 && syllable < 11172) {
    return hangulTrailing.test(current) || (syllable % 28 === 0 && hangulVowel.test(current));
  }
  return (hangulLeading.test(previous) && (hangulLeading.test(current) ||
    hangulVowel.test(current) || /[\uac00-\ud7a3]/u.test(current))) ||
    (hangulVowel.test(previous) && (hangulVowel.test(current) || hangulTrailing.test(current))) ||
    (hangulTrailing.test(previous) && hangulTrailing.test(current));
}

function fallbackBoundaries(source: string): Uint8Array {
  const boundaries = new Uint8Array(source.length + 1);
  let previous = '';
  let regionalRun = 0;
  let index = 0;
  // On older WebViews, err on the side of keeping ambiguous sequences together.
  // Keep an Indic linker and its following consonant together through intervening marks.
  let followsIndicLinker = false;
  for (const current of source) {
    const regional = regionalIndicator.test(current);
    const continuesGrapheme = graphemeContinuation.test(current);
    const joinsPrevious = (previous === '\r' && current === '\n') ||
      continuesGrapheme || graphemePrepend.test(previous) ||
      joinsHangul(previous, current) || (regional && regionalRun % 2 === 1) ||
      (previous === '\u200d' && /\p{Extended_Pictographic}/u.test(current)) ||
      (followsIndicLinker && /\p{Lo}/u.test(current) && !/\p{Script=Han}/u.test(current));
    if (!joinsPrevious) boundaries[index] = 1;
    followsIndicLinker = indicLinker.test(current) || (followsIndicLinker && continuesGrapheme);
    regionalRun = regional ? regionalRun + 1 : 0;
    previous = current;
    index += current.length;
  }
  boundaries[0] = boundaries[source.length] = 1;
  return boundaries;
}

function studyGraphemeBoundary(source: string): (index: number) => boolean {
  if (typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source);
    if (typeof segments.containing === 'function') {
      return (index) => index === 0 || index === source.length || segments.containing(index)?.index === index;
    }
    if (typeof segments[Symbol.iterator] === 'function') {
      const boundaries = new Uint8Array(source.length + 1);
      for (const { index } of segments) boundaries[index] = 1;
      boundaries[source.length] = 1;
      return (index) => boundaries[index] === 1;
    }
  }
  const boundaries = fallbackBoundaries(source);
  return (index) => boundaries[index] === 1;
}

export function locateStudyEvidence(source: string, quote: string, occurrence = 0): StudyEvidenceLocation | null {
  // A model's "quotation" made entirely of punctuation, invisible formatting,
  // isolated combining marks or Braille blank is not readable source evidence, even
  // when identical bytes occur in the PDF. Keep real words, maths and emoji
  // unchanged, including any format characters attached to them.
  if (!source || !hasVisibleStudyContent(quote, { ignorePunctuation: true })) return null;
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
  // against grapheme boundaries rather than caching all candidate hits:
  // a long imported document can contain hundreds of thousands of repetitions.
  const firstMatch = source.indexOf(quote);
  if (firstMatch === -1) return null;
  const isBoundary = studyGraphemeBoundary(source);

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
