// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTronClassSubmissionSource, type TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { LmsReadonlySource } from './tronClassLmsSource';

const binding: TronClassSubmissionBinding = {
  schoolId: 'pu', revision: 'a'.repeat(32), account: 'student-fixture', userId: 303,
  userName: '測試同學', cookies: { session: 'private-fixture' }, expiresAt: '2026-11-14T08:00:00.000Z',
};
const scope = { courseId: 101, homeworkId: 202 };
const homework = { id: 202, course_id: 101, title: '專題報告', deadline: '2026-11-20T08:00:00.000Z',
  data: { description: '<p>請繳交報告。</p>' },
  // Unverified field names must never be interpreted as write authority.
  can_submit: true, allow_submission: true, is_closed: false, individual: true, submitted: true,
};

function fixture() {
  const reads: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101, name: '資料庫' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [homework], total: 1 } })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
  };
  return { reads, source: createTronClassSubmissionSource(reads) };
}

describe('production TronClass submission source is read-only until its contract is verified', () => {
  it('reads only an owned course assignment without fabricating permissions or a receipt', async () => {
    const { reads, source } = fixture();
    expect(source.contractVerified).toBe(false);
    expect(await source.getAssignment(binding, scope)).toEqual({
      ...scope, studentId: 303, title: '專題報告', description: '請繳交報告。',
      deadline: '2026-11-20T08:00:00.000Z', opensAt: null,
      permissionKnown: false, individual: false, canSubmit: false, isClosed: true,
      allowLate: false, remainingAttempts: null, allowsText: false, allowsAttachments: false,
      maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [],
      details: { status: 'unavailable' },
    });
    expect(reads.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 303, status: 'ongoing' });
    expect(reads.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 303, status: 'upcoming' });
    expect(reads.fetchHomeworkPage).toHaveBeenCalledWith(binding.cookies, 101, 1, 50);
  });

  it('also permits read-only preparation from an owned upcoming course', async () => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchCourses).mockImplementation(async (_cookies, options) => options.status === 'upcoming'
      ? [{ id: '101', name: '即將開課' }] : []);
    expect(await source.getAssignment(binding, scope)).toMatchObject({ title: '專題報告', canSubmit: false });
  });

  it('rejects an unowned course before querying any homework', async () => {
    const { reads, source } = fixture();
    await expect(source.getAssignment(binding, { ...scope, courseId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(reads.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('does not treat a malformed course list as an empty valid list', async () => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchCourses).mockResolvedValueOnce({ courses: [{ id: 101 }] });
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(reads.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('finishes pagination before accepting an assignment', async () => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: Array.from({ length: 50 }, (_, i) => ({ id: 1000 + i, title: '另一份' })), total: 51 } })
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: [homework], total: 51 } });
    expect(await source.getAssignment(binding, scope)).toMatchObject({ homeworkId: 202 });
    expect(reads.fetchHomeworkPage).toHaveBeenCalledTimes(2);
  });

  it('rejects incomplete pagination even if the requested assignment was on the first page', async () => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: [homework], total: 2 } })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
  });

  it.each([
    { rows: [{ ...homework, course_id: 999 }] },
    { rows: [homework, homework] },
    { rows: [{ ...homework, id: 0 }] },
    { rows: [{ ...homework, title: '' }] },
  ])('rejects inconsistent source identity/title instead of fabricating a usable assignment: %j', async ({ rows }) => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchHomeworkPage).mockResolvedValue({ ok: true, value: { homework_activities: rows, total: rows.length } });
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
  });

  it('reports a missing homework only after a complete authorized list', async () => {
    const { source } = fixture();
    await expect(source.getAssignment(binding, { ...scope, homeworkId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_HOMEWORK_NOT_FOUND' });
  });

  it.each([
    { is_hidden: true }, { is_hidden: 1 }, { hidden: true }, { hidden: 1 },
    { published: false }, { published: 0 }, { is_hidden: false, hidden: true },
  ])('does not reveal hidden or unpublished assignment details during preparation: %j', async (flags) => {
    const { reads, source } = fixture();
    vi.mocked(reads.fetchHomeworkPage).mockResolvedValue({
      ok: true, value: { homework_activities: [{ ...homework, ...flags }], total: 1 },
    });
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_HOMEWORK_NOT_FOUND' });
  });

  it('maps expired source authentication to reconnect', async () => {
    const first = fixture();
    vi.mocked(first.reads.fetchCourses).mockRejectedValueOnce(new Error('TronClass session 已失效，請重新登入'));
    await expect(first.source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED', status: 401 });
    const second = fixture();
    vi.mocked(second.reads.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(second.source.getAssignment(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED', status: 401 });
  });

  it('never sends uploads or final submissions through guessed endpoints, even when called directly', async () => {
    const { reads, source } = fixture();
    await expect(source.uploadFile(binding, {} as never, {} as never)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    await expect(source.submit(binding, {} as never, {} as never)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    await expect(source.listSubmissions(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
    expect(reads.fetchCourses).not.toHaveBeenCalled();
    expect(reads.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('uses current activity details for display without granting submission permission', async () => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn(async () => ({ ok: true as const, value: {
      id: 202, course_id: 101, type: 'homework', title: '更新後的作業', published: true,
      start_time: '2026-11-18 09:30:00', end_time: '2026-11-25 23:59:00', submit_by_group: false,
      is_in_progress: true, is_closed: false, non_submit_times: false, submit_times: 3, user_submit_count: 1,
      data: { mode: 'normal', description: '<p>以最新要求為準。</p>', allow_retract: true, reference_answer: 'private answer' },
      can_submit: true, allow_submission: true,
    } }));
    const result = await source.getAssignment(binding, scope);
    expect(result).toMatchObject({ title: '更新後的作業', description: '以最新要求為準。',
      opensAt: '2026-11-18T01:30:00.000Z', deadline: '2026-11-25T15:59:00.000Z',
      permissionKnown: false, canSubmit: false, remainingAttempts: null,
      details: { status: 'available', submissionType: 'individual', mode: 'normal',
        attempts: { unlimited: false, limit: 3, used: 1, remaining: 2 } } });
    expect(reads.fetchHomeworkActivity).toHaveBeenCalledWith(binding.cookies, 202);
    expect(JSON.stringify(result)).not.toContain('private answer');
    expect(source.contractVerified).toBe(false);
  });

  it('preserves the independently authorized summary when activity detail is temporarily unavailable', async () => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn(async () => ({ ok: false as const, status: 503 }));
    expect(await source.getAssignment(binding, scope)).toMatchObject({ title: '專題報告',
      description: '請繳交報告。', deadline: homework.deadline, details: { status: 'unavailable' }, canSubmit: false });
  });

  it('clears an old summary description and deadline when the current source explicitly clears them', async () => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn(async () => ({ ok: true as const, value: {
      id: 202, course_id: 101, type: 'homework', title: '專題報告', data: { description: '' }, end_time: null,
    } }));
    expect(await source.getAssignment(binding, scope)).toMatchObject({ description: '', deadline: null,
      details: { status: 'available', deadline: null } });
  });

  it('never reads detailed activity data before checking course ownership', async () => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn();
    await expect(source.getAssignment(binding, { ...scope, courseId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(reads.fetchHomeworkActivity).not.toHaveBeenCalled();
  });

  it.each([
    { id: 999 }, { course_id: 999 }, { type: 'exam' }, { is_hidden: true }, { published: false },
  ])('does not return stale summary content when current activity scope or visibility has changed: %j', async (change) => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn(async () => ({ ok: true as const, value: {
      id: 202, course_id: 101, type: 'homework', ...change,
    } }));
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ status: expect.any(Number) });
  });

  it.each([401, 403, 404])('does not turn a definitive activity %s denial into usable summary details', async (status) => {
    const { reads, source } = fixture();
    reads.fetchHomeworkActivity = vi.fn(async () => ({ ok: false as const, status }));
    await expect(source.getAssignment(binding, scope)).rejects.toMatchObject({ status });
  });
});
