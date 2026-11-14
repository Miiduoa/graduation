import { calculateLearningAnalyticsGpa } from '../features/learningAnalyticsGpa';

const row = (grade: unknown, credits = 3, semester = '115_1') => ({ grade, credits, semester });

describe.each(['pu', 'tw-pu'])('Providence %s', (schoolId) => {
  const calculateGpa = (grades: Parameters<typeof calculateLearningAnalyticsGpa>[0]) =>
    calculateLearningAnalyticsGpa(grades, schoolId);

  test.each([
    [50, 0.7, 0],
    [53, 1, 0.7],
    [57, 1.3, 1],
    [60, 1.7, 1.3],
    [63, 2, 1.7],
    [67, 2.3, 2],
    [70, 2.7, 2.3],
    [73, 3, 2.7],
    [77, 3.3, 3],
    [80, 3.7, 3.3],
    [85, 4, 3.7],
    [90, 4.3, 4],
  ])('uses the correct grade points at and below %s', (score, points, belowPoints) => {
    for (const [grade, expected] of [
      [score, points],
      [score - 0.01, belowPoints],
    ]) {
      const result = calculateGpa([row(grade)]);
      expect(result?.overall).toBeCloseTo(expected);
      expect(result?.semesters[0].gpa).toBeCloseTo(expected);
    }
  });

  test('converts each course before credit weighting, overall and by semester', () => {
    const result = calculateGpa([row(90, 3), row(60, 1), row(85, 2, '114_2')]);
    expect(result?.overall).toBeCloseTo((4.3 * 3 + 1.7 + 4 * 2) / 6);
    expect(result?.semesters).toEqual([
      { sem: '114_2', gpa: 4 },
      { sem: '115_1', gpa: (4.3 * 3 + 1.7) / 4 },
    ]);
  });

  test('keeps the official 4.3 maximum and includes genuine zero scores', () => {
    expect(calculateGpa([row(100)])?.overall).toBe(4.3);
    expect(calculateGpa([row(90), row(0)])?.overall).toBe(2.15);
    expect(calculateGpa([row(0)])?.overall).toBe(0);
  });

  test('includes failed course credits in overall and semester weighting', () => {
    const result = calculateGpa([row(90, 1), row(0, 3), row(85, 2, '114_2')]);
    expect(result?.overall).toBeCloseTo((4.3 + 4 * 2) / 6);
    expect(result?.semesters).toEqual([
      { sem: '114_2', gpa: 4 },
      { sem: '115_1', gpa: 4.3 / 4 },
    ]);
  });

  test('excludes text, pass/fail and invalid scores from both averages without changing records', () => {
    const excluded = [
      '通過',
      '不通過',
      '未通過',
      'P',
      'I',
      'A+',
      '90',
      '',
      null,
      undefined,
      NaN,
      Infinity,
      -1,
      101,
    ].map((grade) => row(grade, 3, '114_2'));
    const before = excluded.map((grade) => ({ ...grade }));
    expect(calculateGpa([row(90), ...excluded])).toEqual({
      overall: 4.3,
      semesters: [{ sem: '115_1', gpa: 4.3 }],
    });
    expect(calculateGpa(excluded)).toBeNull();
    expect(excluded).toEqual(before);
  });

  test('no usable credits or grades returns unknown, never a fabricated zero', () => {
    expect(calculateGpa([])).toBeNull();
    expect(calculateGpa([0, -1, NaN, Infinity].map((credits) => row(90, credits)))).toBeNull();
  });
});

test('switching schools recalculates the same records without retaining the PU scale', () => {
  const grades = Object.freeze([Object.freeze(row(90))]);
  for (const schoolId of ['pu', 'nthu', 'tw-pu', 'ntunhs']) {
    const expected = schoolId === 'pu' || schoolId === 'tw-pu' ? 4.3 : 3.6;
    expect(calculateLearningAnalyticsGpa(grades, schoolId)).toEqual({
      overall: expected,
      semesters: [{ sem: '115_1', gpa: expected }],
    });
  }
  expect(grades[0].grade).toBe(90);
});

describe.each(['ntunhs', 'nthu', 'other'])('other school %s', (schoolId) => {
  test('preserves percentage weighting overall and by semester', () => {
    expect(calculateLearningAnalyticsGpa([row(90)], schoolId)?.overall).toBe(3.6);
    const result = calculateLearningAnalyticsGpa(
      [row(90, 3), row(60, 1), row(85, 2, '114_2'), row(null), row(100, 0)],
      schoolId,
    );
    expect(result).toEqual({
      overall: (90 * 3 + 60 + 85 * 2) / 6 / 25,
      semesters: [
        { sem: '114_2', gpa: 85 / 25 },
        { sem: '115_1', gpa: (90 * 3 + 60) / 4 / 25 },
      ],
    });
  });

  test('preserves the overall-only 4.0 cap and empty-grade behavior', () => {
    expect(calculateLearningAnalyticsGpa([row(110)], schoolId)).toEqual({
      overall: 4,
      semesters: [{ sem: '115_1', gpa: 4.4 }],
    });
    expect(calculateLearningAnalyticsGpa([row(0)], schoolId)?.overall).toBe(0);
    expect(calculateLearningAnalyticsGpa([row(null), row(90, -1)], schoolId)).toBeNull();
    expect(calculateLearningAnalyticsGpa([], schoolId)).toBeNull();
  });
});
