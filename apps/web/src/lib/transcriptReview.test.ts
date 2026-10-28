import { describe, expect, it } from 'vitest';
import type { AcademicGrade } from './academicRecords';
import { summarizeTranscriptReview, transcriptReviewLabel, transcriptReviewReason } from './transcriptReview';

function row(score: number | string, credits = 0.5): AcademicGrade {
  return { id: `${score}:${credits}`, semester: '1151', courseName: '測試課程', courseNameEn: '', class: '', courseType: '', credits, score };
}

describe('transcript review is not an earned-credit classifier', () => {
  it.each([0, 59, 60, 69.5, 70, 100, '0', '59.5', '+70', '.5', 'Pass', 'pass', '通過', '通過（Pass）', '通過 (Pass)', 'Fail', 'Failed', '不通過', '未通過'])(
    'does not turn a known result into missing data: %s', (score) => {
      expect(transcriptReviewReason(score)).toBeNull();
    },
  );
  it.each(['SAT', 'UNSAT', 'A+', 'P', '抵免', '免修', '未完成', '60分', '1e2', '0x60', 'Infinity', '=100', 'Ｐａｓｓ'])(
    'keeps unverified labels for review instead of assuming passed credits: %s', (score) => {
      expect(transcriptReviewReason(score)).toBe('unrecognized');
    },
  );
  it.each(['', '  ', '\t\n'])( 'treats only blank strings as missing: %s', (score) => {
    expect(transcriptReviewReason(score)).toBe('missing');
  });
  it.each([-1, 100.5, Infinity, NaN, '-0.5', '101', null, undefined, true, [], {}])(
    'requires review for an invalid runtime value: %s', (score) => {
      expect(transcriptReviewReason(score)).toBe('invalid');
    },
  );
  it('separates pending counts and listed credits without modifying source rows', () => {
    const rows = [row(0, 3), row('Pass', 0.5), row('', 0), row('SAT', 0.5), row(120, 2)];
    const before = JSON.stringify(rows);
    expect(summarizeTranscriptReview(rows)).toEqual({ count: 3, counts: { missing: 1, unrecognized: 1, invalid: 1 }, affectedCredits: 2.5 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('uses only the rows in the selected scope', () => {
    expect(summarizeTranscriptReview([row('Pass'), row(0)]).count).toBe(0);
    expect(summarizeTranscriptReview([])).toEqual({ count: 0, counts: { missing: 0, unrecognized: 0, invalid: 0 }, affectedCredits: 0 });
  });
  it.each([NaN, Infinity, -1])('does not invent a numeric total for malformed credits: %s', (credits) => {
    expect(summarizeTranscriptReview([row('SAT', credits), row('', 3)]).affectedCredits).toBeNull();
  });
  it('does not claim finite listed credits after overflow', () => {
    expect(summarizeTranscriptReview([row('SAT', Number.MAX_VALUE), row('', Number.MAX_VALUE)]).affectedCredits).toBeNull();
  });
  it('provides a readable reason for each pending category', () => {
    expect(transcriptReviewLabel('missing')).toBe('成績尚未提供');
    expect(transcriptReviewLabel('unrecognized')).toBe('文字結果需核對');
    expect(transcriptReviewLabel('invalid')).toBe('數值或格式需核對');
  });
});
