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

  it('rejects bidi visual overrides and partial surrogate citations without rejecting RTL or emoji', () => {
    const source = '甲A\u202e123乙、😀、العربية、שלום、甲\u200b乙、x²+y²';
    // An override makes the displayed order differ from the literal source.
    expect(locateStudyEvidence(source, 'A\u202e123')).toBeNull();
    expect(locateStudyEvidence('甲\u202d乙', '甲\u202d乙')).toBeNull();
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

  it('does not mislabel punctuation-only text as a verifiable AI source quotation', () => {
    const original = '主鍵？（主鍵）……—，。\n公式 x²+y²，圖示 👩‍💻。';
    // Exact punctuation may appear repeatedly, but it cannot by itself
    // support an explanation; never show a misleading "source located" label.
    for (const quote of ['？', '（', '）', '……', '—', '，。']) {
      expect(original.includes(quote)).toBe(true);
      expect(locateStudyEvidence(original, quote)).toBeNull();
    }
    // Complete words, punctuation attached to words, mathematics and emoji
    // must still be located at their exact unnormalized source positions.
    for (const quote of ['主鍵？', '（主鍵）', 'x²+y²', '👩‍💻']) {
      const located = locateStudyEvidence(original, quote);
      if (!located) throw new Error('Readable source quotation unexpectedly rejected');
      expect(located.quote).toBe(quote);
      expect(located.before + located.quote + located.after).toBe(original);
    }
  });

  it('rejects explicit bidi formatting and isolate controls without rejecting native RTL text', () => {
    // Every quote is byte-identical to source; visually it may render in a
    // different order or suppress/isolate part of the surrounding citation.
    const controls = [
      '\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c',
      '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069',
    ];
    for (const control of controls) {
      const quote = `甲${control}乙`;
      const source = `前${quote}後`;
      expect(source.includes(quote)).toBe(true);
      expect(locateStudyEvidence(source, quote)).toBeNull();
    }

    // The source document remains untouched: only the quoted span is
    // validated, so real Hebrew/Arabic letters can still be cited exactly
    // even when the original document surrounds them with bidi controls.
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

  it('accepts complete keycap emoji while excluding punctuation-only citations', () => {
    const source = '#️⃣ *️⃣ 1️⃣ # *';
    for (const quote of ['#️⃣', '*️⃣', '1️⃣']) {
      expect(locateStudyEvidence(source, quote)?.quote).toBe(quote);
    }
    for (const quote of ['#', '*', '# *']) {
      expect(locateStudyEvidence(source, quote)).toBeNull();
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
      for (const quote of ['教材原文', 'e\u0301', '👩‍💻', '👍🏽', '🇹🇼', '#️⃣', '한', 'क्ष']) {
        expect(locateStudyEvidence('前 ' + quote + ' 後', quote)).toEqual({
          before: '前 ', quote, after: ' 後', occurrences: 1,
        });
      }
      for (const [source, partial] of [
        ['e\u0301e', '\u0301e'], ['e\u0301', 'e'], ['👩‍💻', '💻'], ['👍🏽', '👍'],
        ['🇹🇼', '🇼'], ['한', 'ᅡᆫ'], ['क्ष', 'ष'], ['甲\r\n乙', '甲\r'],
      ]) {
        expect(locateStudyEvidence(source, partial)).toBeNull();
      }
      expect(locateStudyEvidence('🇺🇹🇹🇹', '🇹🇹')?.before).toBe('🇺🇹');
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
