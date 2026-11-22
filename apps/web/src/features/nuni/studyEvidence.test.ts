// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { locateStudyEvidence } from './studyEvidence';

describe('exact source-to-lesson evidence', () => {
  it('preserves original Unicode, CRLF, and surrounding whitespace', () => {
    const original = '😀 第一行\r\n  主鍵唯一\n第二段: 主鍵唯一';
    const found = locateStudyEvidence(original, '主鍵唯一');
    expect(found).toEqual({
      before: '😀 第一行\r\n  ',
      quote: '主鍵唯一',
      after: '\n第二段: 主鍵唯一',
      occurrences: 2,
    });
    expect(found!.before + found!.quote + found!.after).toBe(original);
  });

  it('rejects fabricated, normalized, or empty citations', () => {
    expect(locateStudyEvidence('資料有完整主鍵', '資料有完整主鍵。')).toBeNull();
    expect(locateStudyEvidence('　主鍵　', '主鍵 ')).toBeNull();
    expect(locateStudyEvidence('內容', '  ')).toBeNull();
    expect(locateStudyEvidence('', '內容')).toBeNull();
  });

  it('does not parse an HTML-like source into markup', () => {
    const original = '<img onerror=alert(1)> 寫在原文';
    const found = locateStudyEvidence(original, '<img onerror=alert(1)>');
    expect(found?.quote).toBe('<img onerror=alert(1)>');
    expect(found?.after).toBe(' 寫在原文');
  });

  it('counts complete occurrences but navigates to only the first', () => {
    expect(locateStudyEvidence('甲乙甲乙甲', '甲乙')).toEqual({
      before: '', quote: '甲乙', after: '甲乙甲', occurrences: 2,
    });
  });
  it('navigates all exact repeated quotations including Unicode and CRLF, rejecting out-of-range indices', () => {
    const original = '😀甲乙甲乙\r\n甲乙';
    expect(locateStudyEvidence(original, '甲乙', 1)).toEqual({
      before: '😀甲乙', quote: '甲乙', after: '\r\n甲乙', occurrences: 3,
    });
    expect(locateStudyEvidence(original, '甲乙', 2)).toEqual({
      before: '😀甲乙甲乙\r\n', quote: '甲乙', after: '', occurrences: 3,
    });
    expect(locateStudyEvidence(original, '甲乙', 3)).toBeNull();
    expect(locateStudyEvidence(original, '甲乙', -1)).toBeNull();
    expect(locateStudyEvidence(original, '甲乙', 1.5)).toBeNull();
    expect(locateStudyEvidence('aaaa', 'aa', 1)).toEqual({
      before: 'aa', quote: 'aa', after: '', occurrences: 2,
    });
  });
  it('does not mark invisible-only AI citations as visible source evidence', () => {
    const original = '甲\u200b乙 / \u2800 / \u0301 / \u202e / \ufff9 / \ufffa / \ufffb';
    for (const invisibleQuote of ['\u200b', '\u2800', '\u0301', '\u202e', ' \u2800 ', '\ufff9', '\ufffa', '\ufffb']) {
      // Exact byte overlap alone is insufficient for a readable citation.
      expect(original.includes(invisibleQuote)).toBe(true);
      expect(locateStudyEvidence(original, invisibleQuote)).toBeNull();
    }
  });

  it('locates exact bidi text and rejects partial surrogate citations', () => {
    const source = '甲A\u202e123乙、😀、العربية、שלום、甲\u200b乙、x²+y²';
    expect(locateStudyEvidence(source, 'A\u202e123')?.quote).toBe('A\u202e123');
    expect(locateStudyEvidence('甲\u202d乙', '甲\u202d乙')?.quote).toBe('甲\u202d乙');
    // indexOf() alone would match an unreadable half of an existing emoji.
    expect(source.includes('\uD83D')).toBe(true);
    expect(source.includes('\uDE00')).toBe(true);
    expect(locateStudyEvidence(source, '\uD83D')).toBeNull();
    expect(locateStudyEvidence(source, '\uDE00')).toBeNull();
    expect(locateStudyEvidence('甲\uD83D乙', '甲\uD83D乙')).toBeNull();

    for (const visible of ['😀', 'العربية', 'שלום', '甲\u200b乙', 'x²+y²']) {
      const found = locateStudyEvidence(source, visible);
      expect(found?.quote).toBe(visible);
      if (found === null) throw new Error('Readable citation unexpectedly lost its exact source');
      expect(found.before + found.quote + found.after).toBe(source);
    }
  });

  it('locates exact visible punctuation alongside words and symbols', () => {
    const original = '主鍵？（主鍵）……—，。\n公式 x²+y²，圖示 👩‍💻。';
    expect(locateStudyEvidence('括號（範例）', '（')?.quote).toBe('（');
    expect(locateStudyEvidence(original, '！？')).toBeNull();
    for (const quote of ['？', '（', '）', '……', '—', '，。', '主鍵？', '（主鍵）', 'x²+y²', '👩‍💻']) {
      const located = locateStudyEvidence(original, quote);
      if (!located) throw new Error('Readable source quotation unexpectedly rejected');
      expect(located.quote).toBe(quote);
      expect(located.before + located.quote + located.after).toBe(original);
    }
  });

  it('locates readable bidi citations byte for byte as in the merge base', () => {
    const controls = [
      '\u202a', '\u202b', '\u202c',
      '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069',
    ];
    for (const control of controls) {
      const quote = `甲${control}乙`;
      const source = `前${quote}後`;
      expect(locateStudyEvidence(source, quote)).toEqual({
        before: '前', quote, after: '後', occurrences: 1,
      });
      expect(locateStudyEvidence(source, control)).toBeNull();
      expect(locateStudyEvidence('前甲乙後', quote)).toBeNull();
    }

    // The source document remains untouched: only the quoted span is
    // validated, so real Hebrew/Arabic letters can still be cited exactly
    // even when the original document surrounds them with bidi controls.
    const paired = 'مرحبا \u2067שלום\u2069';
    expect(locateStudyEvidence(`前${paired}後`, paired)?.quote).toBe(paired);
    const rtlText = 'שלום العربية';
    const source = `前\u202b${rtlText}\u202c後`;
    expect(locateStudyEvidence(source, rtlText)).toEqual({
      before: '前\u202b',
      quote: rtlText,
      after: '\u202c後',
      occurrences: 1,
    });
  });

  it('still locates visible text, maths and emoji with attached Unicode marks exactly', () => {
    const original = '甲\u200b乙；數學 x²+y²；e\u0301；👩‍💻';
    for (const quote of ['甲\u200b乙', 'x²+y²', 'e\u0301', '👩‍💻']) {
      const found = locateStudyEvidence(original, quote);
      expect(found?.quote).toBe(quote);
      // The assertion below must narrow the nullable location for TypeScript.
      // If a visible source quote disappears, fail this test rather than hide it.
      if (found === null) throw new Error('Visible citation must match the source exactly');
      expect(found.before + found.quote + found.after).toBe(original);
      expect(found?.occurrences).toBe(1);
    }
  });


  it('finds a complete flag after an overlapping partial flag match', () => {
    const original = '🇺🇹🇹🇹';
    expect(locateStudyEvidence(original, '🇹🇹')).toEqual({
      before: '🇺🇹', quote: '🇹🇹', after: '', occurrences: 1,
    });
    expect(locateStudyEvidence(original, '🇹🇹', 1)).toBeNull();
  });

  it('rejects partial grapheme citations and counts only complete repeated matches', () => {
    // A byte-for-byte substring can still split what the student sees as one glyph.
    expect(locateStudyEvidence('e\u0301', 'e')).toBeNull();
    expect(locateStudyEvidence('👩‍💻', '👩')).toBeNull();
    expect(locateStudyEvidence('🇹🇼', '🇹')).toBeNull();
    expect(locateStudyEvidence('1️⃣', '1')).toBeNull();

    // The same literal quotation later appears as an independent complete glyph.
    const original = 'e\u0301e';
    expect(locateStudyEvidence(original, 'e')).toEqual({
      before: 'e\u0301', quote: 'e', after: '', occurrences: 1,
    });
    expect(locateStudyEvidence(original, 'e', 1)).toBeNull();
    expect(locateStudyEvidence('👩‍💻👩', '👩')).toEqual({
      before: '👩‍💻', quote: '👩', after: '', occurrences: 1,
    });
    expect(locateStudyEvidence('🇹🇼🇹', '🇹')).toEqual({
      before: '🇹🇼', quote: '🇹', after: '', occurrences: 1,
    });
    expect(locateStudyEvidence('1️⃣1', '1')).toEqual({
      before: '1️⃣', quote: '1', after: '', occurrences: 1,
    });

    // The complete original grapheme is still valid, with no normalization.
    for (const glyph of ['e\u0301', '👩‍💻', '🇹🇼', '1️⃣']) {
      expect(locateStudyEvidence(glyph, glyph)).toEqual({
        before: '', quote: glyph, after: '', occurrences: 1,
      });
    }
  });

  it('locates complete keycaps and standalone punctuation at different offsets', () => {
    const source = '#️⃣ *️⃣ 1️⃣ # *';
    for (const quote of ['#️⃣', '*️⃣', '1️⃣', '# *']) {
      expect(locateStudyEvidence(source, quote)?.quote).toBe(quote);
    }
    expect(locateStudyEvidence(source, '#')?.before).toBe('#️⃣ *️⃣ 1️⃣ ');
    expect(locateStudyEvidence(source, '*')?.before).toBe('#️⃣ *️⃣ 1️⃣ # ');
  });

  it.each([true, false])('locates readable Myanmar and direction-marked citations (Segmenter: %s)', (native) => {
    if (!native) vi.stubGlobal('Intl', { Segmenter: undefined });
    try {
      expect(locateStudyEvidence('ကါ', 'က')).toEqual({
        before: '', quote: 'က', after: 'ါ', occurrences: 1,
      });
      expect(locateStudyEvidence('前甲\u200e乙後', '甲\u200e乙')).toEqual({
        before: '前', quote: '甲\u200e乙', after: '後', occurrences: 1,
      });
      expect(locateStudyEvidence('前甲\u200e乙後', '\u200e')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([true, false])('keeps spacing vowels inside whole source glyphs (Segmenter: %s)', (native) => {
    if (!native) vi.stubGlobal('Intl', { Segmenter: undefined });
    try {
      // GB9a is needed in older mobile browsers: these vowel signs are Mc,
      // not necessarily Grapheme_Extend. A partial consonant is not evidence.
      for (const [syllable, consonant] of [
        ['का', 'क'], // Devanagari
        ['কি', 'ক'], // Bengali
        ['ਕਾ', 'ਕ'], // Gurmukhi
        ['કા', 'ક'], // Gujarati
        ['கா', 'க'], // Tamil
        ['ಕಾ', 'ಕ'], // Kannada
        ['കാ', 'ക'], // Malayalam
        ['කා', 'ක'], // Sinhala
        ['ကေ', 'က'], // Myanmar pre-base vowel
        ['កា', 'ក'], // Khmer
      ]) {
        expect(locateStudyEvidence(syllable, consonant)).toBeNull();
        expect(locateStudyEvidence(syllable, syllable)?.quote).toBe(syllable);
        expect(locateStudyEvidence(syllable + ' ' + consonant, consonant)).toEqual({
          before: syllable + ' ', quote: consonant, after: '', occurrences: 1,
        });
      }
      // Unicode GCB exceptions are real breaks despite being Spacing_Mark.
      for (const syllable of ['ကါ', 'ကာ', 'ကး']) {
        expect(locateStudyEvidence(syllable, 'က')).toEqual({
          before: '', quote: 'က', after: syllable.slice(1), occurrences: 1,
        });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([true, false])('matches merge-base exact mixed-script quotes (Segmenter: %s)', (native) => {
    if (!native) vi.stubGlobal('Intl', { Segmenter: undefined });
    try {
      for (const [before, quote, after] of [
        ['က္', 'ع', ''],
        ['က္', 'ع\u0651', '\u200b'],
        ['ع\u0651္', 'က', ''],
        ['က္', 'ع\u0651\u200eက', '後'],
        ['က္\u200b', '\u200eع', ''],
        ['က္\u200d', 'ع', ''],
        ['က္', 'अ', ''],
        ['က္', 'α\u0301', ''],
      ]) {
        expect(locateStudyEvidence(before + quote + after, quote)).toEqual({
          before, quote, after, occurrences: 1,
        });
      }
      expect(locateStudyEvidence('က္ع\u0651', 'ع')).toBeNull();
      expect(locateStudyEvidence('က္\u200b\u200eع', '\u200b\u200e')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([true, false])('keeps orphaned Indic linkers outside the next letter (Segmenter: %s)', (native) => {
    if (!native) vi.stubGlobal('Intl', { Segmenter: undefined });
    try {
      for (const [linker, letter] of [['\u094d', 'क'], ['\u09cd', 'ক'], ['\u0acd', 'ક']]) {
        for (const prefix of ['', ' ', '。', '👩']) {
          const before = prefix + linker;
          expect(locateStudyEvidence(before + letter, letter)).toEqual({
            before, quote: letter, after: '', occurrences: 1,
          });
        }
        expect(locateStudyEvidence(letter + linker + letter, letter)).toBeNull();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([true, false])('does not cite half an Indic conjunct across ZWJ or combining marks (Segmenter: %s)', (native) => {
    if (!native) vi.stubGlobal('Intl', { Segmenter: undefined });
    try {
      // Native Segmenter and the mobile fallback must agree about whole
      // source glyphs; a consonant after the linker is not a separate quote.
      for (const [cluster, partial] of [
        ['क्\u200dष', 'ष'], // Devanagari virama + ZWJ
        ['ক্\u200dষ', 'ষ'], // Bengali virama + ZWJ
        ['क्\u0301ष', 'ष'], // combining mark after the linker
        ['क\u200d्\u200dष', 'ष'], // Extend also precedes the linker
      ]) {
        expect(locateStudyEvidence(cluster, partial)).toBeNull();
        expect(locateStudyEvidence(cluster + ' ' + partial, partial)).toEqual({
          before: cluster + ' ', quote: partial, after: '', occurrences: 1,
        });
        expect(locateStudyEvidence(cluster, cluster)?.quote).toBe(cluster);
      }
      // ZWNJ deliberately separates letters. Treating it as a linker
      // continuation would hide a valid independently readable citation.
      expect(locateStudyEvidence('क्\u200cष', 'ष')).toEqual({
        before: 'क्\u200c', quote: 'ष', after: '', occurrences: 1,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['Segmenter', 'containing'] as const)('locates whole graphemes without %s', (missing) => {
    const NativeSegmenter = Intl.Segmenter;
    const mockIntl = Object.create(Intl);
    mockIntl.Segmenter = missing === 'Segmenter' ? undefined : class {
      segment(source: string) {
        const segments = new NativeSegmenter().segment(source);
        return { [Symbol.iterator]: segments[Symbol.iterator].bind(segments) };
      }
    };
    vi.stubGlobal('Intl', mockIntl);
    try {
      for (const quote of ['教材原文', 'e\u0301', '👩‍💻', '👩🏽‍💻', '👍🏽', '🇹🇼', '#️⃣', '한', 'क्ष']) {
        expect(locateStudyEvidence('前 ' + quote + ' 後', quote)).toEqual({
          before: '前 ', quote, after: ' 後', occurrences: 1,
        });
      }
      expect(locateStudyEvidence('甲\n\u0301', '甲\n')).toEqual({
        before: '', quote: '甲\n', after: '\u0301', occurrences: 1,
      });
      expect(locateStudyEvidence('A\u200d💻', '💻')).toEqual({
        before: 'A\u200d', quote: '💻', after: '', occurrences: 1,
      });
      expect(locateStudyEvidence('\u{16D63}\u{16D67}', '\u{16D63}\u{16D67}')?.quote).toBe('\u{16D63}\u{16D67}');
      for (const [source, partial] of [
        ['e\u0301e', '\u0301e'], ['e\u0301', 'e'], ['👩‍💻', '💻'], ['👍🏽', '👍'],
        ['👩🏽‍💻', '💻'], ['A\u200d💻', 'A'],
        ['🇹🇼', '🇼'], ['한', 'ᅡᆫ'], ['क्ष', 'ष'], ['甲\r\n乙', '甲\r'],
        ['\u{16D63}\u{16D67}', '\u{16D63}'],
      ]) {
        expect(locateStudyEvidence(source, partial)).toBeNull();
      }
      expect(locateStudyEvidence('🇺🇹🇹🇹', '🇹🇹')?.before).toBe('🇺🇹');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'constructor', 'segment', 'containing', 'invalid-containing',
    'iterator', 'invalid-iterator', 'truncated-iterator',
  ] as const)('uses source-safe grapheme boundaries if mobile Segmenter has a %s failure', (failure) => {
    // Simulate partial WebView Intl implementations. A successful indexOf is
    // never enough to claim that a partial emoji or combining glyph is evidence.
    const fakeIntl = Object.create(Intl);
    fakeIntl.Segmenter = class {
      constructor() {
        if (failure === 'constructor') throw new Error('Segmenter unavailable');
      }
      segment(source: string) {
        if (failure === 'segment') throw new Error('segment failed');
        if (failure === 'containing') {
          return { containing: () => { throw new Error('containing failed'); } };
        }
        if (failure === 'invalid-containing') {
          return { containing: (index: number) => ({ index, segment: 'not original text' }) };
        }
        return {
          [Symbol.iterator]: function* () {
            if (failure === 'iterator') throw new Error('iterator failed');
            if (failure === 'invalid-iterator') {
              yield { index: 0, segment: source.slice(0, 1) };
              yield { index: 2, segment: source.slice(1) };
              return;
            }
            // The iterator may silently stop without returning the rest.
            yield { index: 0, segment: source.slice(0, 1) };
          },
        };
      }
    };
    vi.stubGlobal('Intl', fakeIntl);
    try {
      expect(locateStudyEvidence('e\u0301e', 'e')).toEqual({
        before: 'e\u0301', quote: 'e', after: '', occurrences: 1,
      });
      expect(locateStudyEvidence('e\u0301', 'e')).toBeNull();
      expect(locateStudyEvidence('👩‍💻👩', '👩')).toEqual({
        before: '👩‍💻', quote: '👩', after: '', occurrences: 1,
      });
      expect(locateStudyEvidence('🇹🇼', '🇹')).toBeNull();
      expect(locateStudyEvidence('前教材後', '教材')?.quote).toBe('教材');
    } finally {
      vi.unstubAllGlobals();
    }
  });


  it.each(['containing', 'iterator'] as const)(
    'does not trust code-point-only Segmenter %s as complete visible graphemes', (mode) => {
      // The fake WebView reports real contiguous source bytes but incorrectly
      // splits combining accents, ZWJ emoji, flag pairs and Hangul syllables.
      // This used to pass the Segmenter shape/content checks.
      const fakeIntl = Object.create(Intl);
      fakeIntl.Segmenter = class {
        segment(source: string) {
          if (mode === 'containing') {
            return {
              containing(position: number) {
                let index = 0;
                for (const segment of source) {
                  if (position >= index && position < index + segment.length) {
                    return { index, segment };
                  }
                  index += segment.length;
                }
                return undefined;
              },
            };
          }
          return {
            *[Symbol.iterator]() {
              let index = 0;
              for (const segment of source) {
                yield { index, segment };
                index += segment.length;
              }
            },
          };
        }
      };
      vi.stubGlobal('Intl', fakeIntl);
      try {
        expect(locateStudyEvidence('e\u0301e', 'e')).toEqual({
          before: 'e\u0301', quote: 'e', after: '', occurrences: 1,
        });
        expect(locateStudyEvidence('👩‍💻👩', '👩')?.before).toBe('👩‍💻');
        expect(locateStudyEvidence('🇹🇼🇹', '🇹')?.before).toBe('🇹🇼');
        expect(locateStudyEvidence('1️⃣1', '1')?.before).toBe('1️⃣');
        expect(locateStudyEvidence('한', 'ᄒ')).toBeNull();
        expect(locateStudyEvidence('前教材後', '教材')?.quote).toBe('教材');
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('locates a late repeated quote without losing non-overlapping counts', () => {
    const original = '甲'.repeat(20_000);
    const last = locateStudyEvidence(original, '甲', 19_999);
    expect(last?.occurrences).toBe(20_000);
    expect(last?.before).toBe('甲'.repeat(19_999));
    expect(last?.quote).toBe('甲');
    expect(last?.after).toBe('');
    expect(locateStudyEvidence(original, '甲', 20_000)).toBeNull();

    // A rejected partial glyph cannot consume a later, overlapping full glyph.
    expect(locateStudyEvidence('🇺🇹🇹🇹', '🇹🇹')).toEqual({
      before: '🇺🇹', quote: '🇹🇹', after: '', occurrences: 1,
    });
    expect(locateStudyEvidence('aaaa', 'aa', 1)).toEqual({
      before: 'aa', quote: 'aa', after: '', occurrences: 2,
    });
  });

});
