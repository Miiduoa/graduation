// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scraper = vi.hoisted(() => ({
  tcFetchCourses: vi.fn(),
  tcFetchHomeworkActivitiesPage: vi.fn(),
  tcFetchHomeworkActivityStrict: vi.fn(),
  tcFetchStudentHomeworkSubmissionList: vi.fn(),
}));
vi.mock('../../../../../backend/functions/tronClassScraper.js', () => scraper);

import { tronClassLmsReadonlySource } from './tronClassLmsSource';

const cookies = { session: 'synthetic-session' };
beforeEach(() => vi.resetAllMocks());

describe('real read-only source cancellation bridge', () => {
  it('passes cancellation separately from the course query into internal scraper paging', async () => {
    const options = { signal: new AbortController().signal, timeoutMs: 1234 };
    const courses = [{ id: 101, name: '合成課程' }];
    scraper.tcFetchCourses.mockResolvedValue(courses);
    expect(await tronClassLmsReadonlySource.fetchCourses(cookies, { userId: 303, status: 'ongoing' }, options)).toBe(courses);
    expect(scraper.tcFetchCourses).toHaveBeenCalledExactlyOnceWith(cookies, { userId: 303, status: 'ongoing' }, options);
  });

  it('forwards the operation signal and per-request timeout for every homework page', async () => {
    const options = { signal: new AbortController().signal, timeoutMs: 5678 };
    const page = { homework_activities: [], total: 0 };
    scraper.tcFetchHomeworkActivitiesPage.mockResolvedValue(page);
    expect(await tronClassLmsReadonlySource.fetchHomeworkPage(cookies, 101, 2, 50, options)).toEqual({ ok: true, value: page });
    expect(scraper.tcFetchHomeworkActivitiesPage).toHaveBeenCalledExactlyOnceWith(cookies, 101, 2, 50, options);
  });

  it('forwards cancellation into both strict activity and own-history transport', async () => {
    const options = { signal: new AbortController().signal, timeoutMs: 8000 };
    const activity = { id: 202, course_id: 101 };
    const history = { list: [] };
    scraper.tcFetchHomeworkActivityStrict.mockResolvedValue(activity);
    scraper.tcFetchStudentHomeworkSubmissionList.mockResolvedValue(history);
    expect(await tronClassLmsReadonlySource.fetchHomeworkActivity!(cookies, 202, options)).toEqual({ ok: true, value: activity });
    expect(await tronClassLmsReadonlySource.fetchStudentSubmissionList!(cookies, 202, 303, options)).toEqual({ ok: true, value: history });
    expect(scraper.tcFetchHomeworkActivityStrict).toHaveBeenCalledExactlyOnceWith(cookies, 202, options);
    expect(scraper.tcFetchStudentHomeworkSubmissionList).toHaveBeenCalledExactlyOnceWith(cookies, 202, 303, options);
  });

  it('keeps concurrent owners on separate signals, while legacy callers use bounded scraper defaults', async () => {
    const first = { signal: new AbortController().signal, timeoutMs: 1000 };
    const second = { signal: new AbortController().signal, timeoutMs: 2000 };
    scraper.tcFetchHomeworkActivityStrict.mockResolvedValue({});
    await Promise.all([
      tronClassLmsReadonlySource.fetchHomeworkActivity!(cookies, 202, first),
      tronClassLmsReadonlySource.fetchHomeworkActivity!({ session: 'second-synthetic-session' }, 404, second),
      tronClassLmsReadonlySource.fetchHomeworkActivity!(cookies, 505),
    ]);
    expect(scraper.tcFetchHomeworkActivityStrict.mock.calls.map(call => call[2])).toEqual([first, second, undefined]);
  });

  it('keeps transport errors private after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    scraper.tcFetchStudentHomeworkSubmissionList.mockRejectedValue(new Error('private raw response and cookie'));
    expect(await tronClassLmsReadonlySource.fetchStudentSubmissionList!(cookies, 202, 303, { signal: controller.signal }))
      .toEqual({ ok: false, status: null });
  });
});
