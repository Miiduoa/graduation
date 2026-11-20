import {
  PU_GRADE_POINT_POLICY,
  convertPuPercentScoreToGradePoint,
  isConvertiblePuPercentScore,
} from '../../data/apiAdapters/puGradePointPolicy';

describe('PU grade-point policy (學則 4.3 表)', () => {
  test('documents verified primary source and revision', () => {
    expect(PU_GRADE_POINT_POLICY.regulationsIndexUrl).toContain('dorac.pu.edu.tw');
    expect(PU_GRADE_POINT_POLICY.regulationsPdfUrl).toMatch(/0101\.pdf$/);
    expect(PU_GRADE_POINT_POLICY.documentId).toBe('PU-101B0-B-0101-2026020901');
    expect(PU_GRADE_POINT_POLICY.version).toBe(51);
    expect(PU_GRADE_POINT_POLICY.revisedOn).toBe('2026-02-09');
    expect(PU_GRADE_POINT_POLICY.gradePointScale).toBe(4.3);
  });

  test('boundary table from article 25', () => {
    const cases: Array<[number, number]> = [
      [100, 4.3],
      [90, 4.3],
      [89.9, 4.0],
      [85, 4.0],
      [84.9, 3.7],
      [80, 3.7],
      [79.9, 3.3],
      [77, 3.3],
      [76.9, 3.0],
      [73, 3.0],
      [72.9, 2.7],
      [70, 2.7],
      [69.9, 2.3],
      [67, 2.3],
      [66.9, 2.0],
      [63, 2.0],
      [62.9, 1.7],
      [60, 1.7],
      [59.9, 1.3],
      [57, 1.3],
      [56.9, 1.0],
      [53, 1.0],
      [52.9, 0.7],
      [50, 0.7],
      [49.9, 0],
      [0, 0],
    ];
    for (const [score, expected] of cases) {
      expect(convertPuPercentScoreToGradePoint(score)).toBe(expected);
    }
  });

  test('rejects non-finite and out-of-range scores', () => {
    expect(isConvertiblePuPercentScore(Number.NaN)).toBe(false);
    expect(isConvertiblePuPercentScore(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isConvertiblePuPercentScore(-0.1)).toBe(false);
    expect(isConvertiblePuPercentScore(100.1)).toBe(false);
    expect(convertPuPercentScoreToGradePoint(Number.NaN)).toBeNull();
    expect(convertPuPercentScoreToGradePoint(-1)).toBeNull();
    expect(convertPuPercentScoreToGradePoint(101)).toBeNull();
  });
});
