// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
});
