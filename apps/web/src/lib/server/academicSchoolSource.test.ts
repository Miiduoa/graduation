// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ courses: vi.fn(), grades: vi.fn() }));
vi.mock('../../../../../backend/functions/puScraper.js', () => ({
  puFetchCourses: mocks.courses,
  puFetchGrades: mocks.grades,
}));
import { academicSchoolSource } from './academicSchoolSource';

beforeEach(() => vi.clearAllMocks());

it('derives a clearly marked credit summary from the same successful grade response', async () => {
  mocks.grades.mockResolvedValue({
    success: true,
    grades: [
      { semester: '1151', courseName: '甲', credits: 3, score: 80 },
      { semester: '1151', courseName: '乙', credits: 2, score: '通過' },
      { semester: '1151', courseName: '丙', credits: 1, score: '' },
    ],
    allSemesters: ['1151'],
  });
  const result = await academicSchoolSource.grades({ portal: 'session' }, '');
  expect(mocks.grades).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    creditSummary: { source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 5 },
  });
});

it('preserves a failed grade result instead of inventing zero earned credits', async () => {
  const failed = { success: false, grades: [], code: 'session-expired' };
  mocks.grades.mockResolvedValue(failed);
  expect(await academicSchoolSource.grades({ portal: 'session' }, '')).toBe(failed);
});

it('leaves an empty grade response without a derived credit total', async () => {
  mocks.grades.mockResolvedValue({ success: true, grades: [] });
  expect(await academicSchoolSource.grades({ portal: 'session' }, '')).toMatchObject({ creditSummary: null });
});
