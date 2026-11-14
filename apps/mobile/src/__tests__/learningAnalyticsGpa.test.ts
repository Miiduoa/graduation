import { calculateLearningAnalyticsGpa } from '../features/learningAnalyticsGpa';

const row = (grade: unknown, credits = 3, semester = '115_1') => ({ grade, credits, semester });

test('converts each course before credit weighting, overall and by semester', () => {
  const result = calculateLearningAnalyticsGpa([row(90, 3), row(60, 1), row(85, 2, '114_2')]);
  expect(result?.overall).toBeCloseTo((4.3 * 3 + 1.7 + 4 * 2) / 6);
  expect(result?.semesters).toEqual([
    { sem: '114_2', gpa: 4 },
    { sem: '115_1', gpa: (4.3 * 3 + 1.7) / 4 },
  ]);
});

test('keeps the official 4.3 maximum and includes genuine zero scores', () => {
  expect(calculateLearningAnalyticsGpa([row(100)])?.overall).toBe(4.3);
  expect(calculateLearningAnalyticsGpa([row(90), row(0)])?.overall).toBe(2.15);
  expect(calculateLearningAnalyticsGpa([row(0)])?.overall).toBe(0);
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
  expect(calculateLearningAnalyticsGpa([row(90), ...excluded])).toEqual({
    overall: 4.3,
    semesters: [{ sem: '115_1', gpa: 4.3 }],
  });
  expect(calculateLearningAnalyticsGpa(excluded)).toBeNull();
  expect(excluded).toEqual(before);
});

test('no usable credits or grades returns unknown, never a fabricated zero', () => {
  expect(calculateLearningAnalyticsGpa([])).toBeNull();
  expect(
    calculateLearningAnalyticsGpa([0, -1, NaN, Infinity].map((credits) => row(90, credits))),
  ).toBeNull();
});
