// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const { fetchCourses } = vi.hoisted(() => ({ fetchCourses: vi.fn() }));
vi.mock('../../../../../backend/functions/tronClassScraper.js', () => ({
  tcFetchCourses: fetchCourses,
}));

import { tronClassSchoolSource } from './tronClassSchoolSource';

beforeEach(() => fetchCourses.mockReset());

it.each([
  ['ongoing', 'ongoing'],
  ['completed', 'ended'],
  ['upcoming', 'upcoming'],
] as const)('maps the %s view to the school API status %s', async (status, schoolStatus) => {
  const courses = [{ id: 42, name: '資料庫', semester: { name: '115 學年度第 1 學期' } }];
  fetchCourses.mockResolvedValueOnce(courses);
  expect(await tronClassSchoolSource({ session: 'test-session' }, { userId: 10, status })).toBe(courses);
  expect(fetchCourses).toHaveBeenCalledWith({ session: 'test-session' }, {
    userId: 10,
    status: schoolStatus,
  });
});
