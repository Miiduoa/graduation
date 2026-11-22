export function hasVisibleStudyContent(text: string): boolean {
  return /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}\p{M}\u2800\ufff9-\ufffb]/u.test(text);
}

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

const graphemeContinuation = /[\p{Grapheme_Extend}\p{Emoji_Modifier}\u0e33\u0eb3\u200d]/u;
// GB9a: many South/Southeast Asian vowel signs are SpacingMark rather than
// Grapheme_Extend. Older WebViews without Intl.Segmenter must not permit a
// model citation to cut the visible syllable in half. Unicode 16's exceptions
// to GCB=SpacingMark (notably Myanmar/Tai Tham) remain separate clusters.
const graphemeSpacingMark = /\p{Spacing_Mark}/u;
const spacingMarkBreaks = /[\u102b-\u102c\u1038\u1062-\u1064\u1067-\u106d\u1083\u1087-\u108c\u108f\u109a-\u109c\u1a61\u1a63-\u1a64\uaa7b\uaa7d\u{11720}-\u{11721}]/u;
const graphemeControl = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const pictographic = /\p{Extended_Pictographic}/u;
const emojiExtend = /[\p{Grapheme_Extend}\p{Emoji_Modifier}]/u;
const regionalIndicator = /\p{Regional_Indicator}/u;
// Recognize established conjuncts in fallback mode when the base, linker and
// following consonant are all known. Leave other script combinations separate.
const indicConsonant =
  /^[\u0915-\u0939\u0958-\u095f\u0978-\u097f\u0995-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09dc-\u09dd\u09df\u09f0-\u09f1\u0a95-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0af9\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065-\u1066\u106e-\u1070\u1075-\u1081\u108e]$/u;
const indicLinker = /^[\u094d\u09cd\u0acd\u1039]$/u;
// Grapheme_Cluster_Break=Prepend.
const graphemePrepend = /[\u0600-\u0605\u06dd\u070f\u0890-\u0891\u08e2\u0d4e\u{110bd}\u{110cd}\u{111c2}-\u{111c3}\u{113d1}\u{1193f}\u{11941}\u{11a3a}\u{11a84}-\u{11a89}\u{11d46}\u{11f02}]/u;
const hangulLeading = /^[\u1100-\u115f\ua960-\ua97c]$/u;
const hangulVowel = /^[\u1160-\u11a7\ud7b0-\ud7c6]$/u;
const hangulTrailing = /^[\u11a8-\u11ff\ud7cb-\ud7fb]$/u;
// Unicode 16 treats these Kirat Rai vowel signs as a single grapheme cluster.
const kiratRaiVowel = /^[\u{16d63}\u{16d67}-\u{16d6a}]$/u;

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
  let previousIsControl = false;
  let followsPictographic = false;
  let followsEmojiZwj = false;
  let regionalRun = 0;
  let index = 0;
  let hasIndicBase = false;
  let followsIndicLinker = false;
  for (const current of source) {
    const regional = regionalIndicator.test(current);
    const isIndicConsonant = indicConsonant.test(current);
    const continuesGrapheme = graphemeContinuation.test(current) ||
      (graphemeSpacingMark.test(current) && !spacingMarkBreaks.test(current));
    const isControl = graphemeControl.test(current) &&
      !continuesGrapheme && !graphemePrepend.test(current);
    const isPictographic = pictographic.test(current);
    const joinsPrevious: boolean = (previous === '\r' && current === '\n') ||
      (!previousIsControl && !isControl &&
        (continuesGrapheme || graphemePrepend.test(previous) ||
          joinsHangul(previous, current) || (regional && regionalRun % 2 === 1) ||
          (followsEmojiZwj && isPictographic) ||
          (kiratRaiVowel.test(previous) && kiratRaiVowel.test(current)) ||
          (followsIndicLinker && isIndicConsonant)));
    if (!joinsPrevious) boundaries[index] = 1;
    followsEmojiZwj = current === '\u200d' && followsPictographic;
    followsPictographic = isPictographic || (followsPictographic && emojiExtend.test(current));
    // GB9c keeps an Indic consonant-linker sequence joined across Extend
    // marks and ZWJ. The previous single-code-point check lost its linker
    // state at ZWJ, allowing a citation to begin midway through a conjunct.
    // ZWNJ is Grapheme_Extend but explicitly interrupts an Indic conjunct.
    if (isIndicConsonant) {
      hasIndicBase = true;
      followsIndicLinker = false;
    } else if (hasIndicBase && indicLinker.test(current)) {
      followsIndicLinker = true;
    } else if (!continuesGrapheme || current === '\u200c') {
      hasIndicBase = false;
      followsIndicLinker = false;
    }
    regionalRun = regional ? regionalRun + 1 : 0;
    previous = current;
    previousIsControl = isControl;
    index += current.length;
  }
  boundaries[0] = boundaries[source.length] = 1;
  return boundaries;
}


// Verify the implementation can keep complete clusters before using its
// boundaries. A code-point splitter can otherwise return valid source slices.
const probeClusters = ['e\u0301', '👩‍💻', '🇹🇼', '한'];
const segmentationProbe = probeClusters.join('');
const probeStarts = probeClusters.map((_, index) => probeClusters.slice(0, index).join('').length);

function hasWorkingSegmenter(segmenter: Intl.Segmenter): boolean {
  const probe = segmenter.segment(segmentationProbe);
  if (typeof probe.containing === 'function') {
    return probeStarts.every((start, index) => {
      const end = probeStarts[index + 1] ?? segmentationProbe.length;
      const segment = probe.containing(end - 1);
      return segment?.index === start && segment.segment === segmentationProbe.slice(start, end);
    });
  }
  const segments = Array.from(probe);
  return segments.length === probeStarts.length && segments.every((segment, index) => {
    const start = probeStarts[index];
    const end = probeStarts[index + 1] ?? segmentationProbe.length;
    return segment.index === start && segment.segment === segmentationProbe.slice(start, end);
  });
}

function studyGraphemeBoundary(source: string): (index: number) => boolean {
  // A few embedded mobile WebViews expose Intl.Segmenter but throw during
  // construction, lookup or iteration, or return incomplete segments. Keep
  // source evidence usable without trusting a broken segmentation result.
  let fallback: Uint8Array | undefined;
  const fallbackBoundary = (index: number): boolean => {
    fallback ??= fallbackBoundaries(source);
    return fallback[index] === 1;
  };
  try {
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      if (!hasWorkingSegmenter(segmenter)) return fallbackBoundary;
      const segments = segmenter.segment(source);
      if (typeof segments.containing === 'function') {
        return (index) => {
          if (index === 0 || index === source.length) return true;
          try {
            const found = segments.containing(index);
            // An undefined, out-of-range or fabricated segment is not proof
            // that a quotation begins at a complete visible character.
            if (!found || !Number.isSafeInteger(found.index) ||
                found.index < 0 || found.index > index ||
                typeof found.segment !== 'string' || found.segment.length === 0 ||
                index >= found.index + found.segment.length ||
                source.slice(found.index, found.index + found.segment.length) !== found.segment) {
              return fallbackBoundary(index);
            }
            return found.index === index;
          } catch {
            return fallbackBoundary(index);
          }
        };
      }
      if (typeof segments[Symbol.iterator] === 'function') {
        const boundaries = new Uint8Array(source.length + 1);
        let next = 0;
        for (const segment of segments) {
          // Iterator-only implementations must cover the original UTF-16
          // text in order, with no missing, duplicated or substituted bytes.
          if (!Number.isSafeInteger(segment.index) || segment.index !== next ||
              typeof segment.segment !== 'string' || segment.segment.length === 0 ||
              source.slice(next, next + segment.segment.length) !== segment.segment) {
            return fallbackBoundary;
          }
          boundaries[next] = 1;
          next += segment.segment.length;
        }
        if (next !== source.length) return fallbackBoundary;
        boundaries[source.length] = 1;
        return (index) => boundaries[index] === 1;
      }
    }
  } catch {
    // A partially implemented Segmenter must not break source verification.
  }
  return fallbackBoundary;
}

export function locateStudyEvidence(source: string, quote: string, occurrence = 0): StudyEvidenceLocation | null {
  // Visible punctuation can be located just like words or symbols.
  if (!source || !hasVisibleStudyContent(quote)) return null;
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
