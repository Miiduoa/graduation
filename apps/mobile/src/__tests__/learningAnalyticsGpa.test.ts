import { calculateLearningAnalyticsGpa } from '../features/learningAnalyticsGpa';

const row = (grade: unknown, credits = 3, semester = '115_1') => ({ grade, credits, semester });

describe.each(['pu', 'tw-pu', 'nthu', 'ntunhs', 'other'])('school %s uses the shared 4.3 table', (schoolId) => {
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
    expect(calculateGpa([row(100)])).toEqual({
      overall: 4.3,
      semesters: [{ sem: '115_1', gpa: 4.3 }],
    });
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
    const unusableCredits = [0, -1, NaN, Infinity].map((credits) => row(90, credits, '114_2'));
    expect(calculateGpa(unusableCredits)).toBeNull();
    expect(calculateGpa([row(60), ...unusableCredits])).toEqual({
      overall: 1.7,
      semesters: [{ sem: '115_1', gpa: 1.7 }],
    });
  });
});

test('switching schools recalculates records with the same shared 4.3 table', () => {
  const grades = Object.freeze([
    Object.freeze(row(90, 3)),
    Object.freeze(row(60, 1)),
    Object.freeze(row(85, 2, '114_2')),
  ]);
  for (const schoolId of ['pu', 'nthu', 'tw-pu', 'ntunhs', 'other', 'pu']) {
    const result = calculateLearningAnalyticsGpa(grades, schoolId);
    expect(result?.overall).toBeCloseTo((4.3 * 3 + 1.7 + 4 * 2) / 6);
    expect(result?.semesters).toEqual([
      { sem: '114_2', gpa: 4 },
      { sem: '115_1', gpa: (4.3 * 3 + 1.7) / 4 },
    ]);
  }
});
