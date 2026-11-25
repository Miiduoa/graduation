// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassCourseIndexReader, createTronClassIntegrationReader } from './tronClassIntegrationSource';
import type { LmsHomeworkPage, LmsReadOptions, LmsReadResult, LmsReadonlySource } from './tronClassLmsSource';

vi.mock('./tronClassLmsSource', () => ({ tronClassLmsReadonlySource: {} }));

const course = { id: 101, name: '資料庫管理', course_code: 'CS01', teachers: [{ name: '林老師' }], semester: { name: '115-1' }, status: 'ongoing' };
const assignment = { id: 201, title: '期中報告', course_id: 101, submitted: false, deadline: '2026-11-20T15:59:00Z', data: { description: '<p>請上傳報告</p>' } };
const binding = { schoolId: 'pu' as const, revision: 'revision_1234567890', account: '410000001', userId: 12, userName: '測試同學', cookies: { session: 'private-cookie' }, expiresAt: '2026-11-14T00:00:00Z' };

function setup() {
  const bindings = { requireBinding: vi.fn().mockResolvedValue(binding), assertCurrent: vi.fn().mockResolvedValue(undefined) };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn().mockImplementation(async (_cookie, opts) => opts.status === 'ongoing' ? [course] : []),
    fetchHomeworkPage: vi.fn().mockResolvedValue({ ok: true, value: { homework_activities: [assignment], total: 1 } }),
    fetchActivities: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    fetchCourseAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    fetchSiteAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
  const reader = createTronClassIntegrationReader({ bindings, source });
  return { reader, bindings, source };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

describe('independent TronClass source', () => {
  it('returns a separate course index while an overview homework request is still waiting', async () => {
    const { reader, source, bindings } = setup();
    let finish!: (value: LmsReadResult<LmsHomeworkPage>) => void;
    vi.mocked(source.fetchHomeworkPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const overview = reader('platform:pa_fixture');
    await vi.waitFor(() => expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1));
    const index = await createTronClassCourseIndexReader({ source, bindings })('platform:pa_fixture');
    expect(index).toMatchObject({ kind: 'course-index', revision: binding.revision,
      courses: [{ id: 101, name: course.name }], errors: [], partial: false });
    expect(Object.keys(index).sort()).toEqual(['courses', 'errors', 'fetchedAt', 'kind', 'partial', 'revision']);
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(JSON.stringify(index)).not.toMatch(/private-cookie|homework|materials|announcements/);
    finish({ ok: true, value: { homework_activities: [assignment], total: 1 } });
    expect((await overview).homework).toHaveLength(1);
  });

  it('keeps course-index coverage separate from homework coverage when upcoming courses fail', async () => {
    const { source, bindings } = setup();
    vi.mocked(source.fetchCourses).mockImplementation(async (_cookies, query) => {
      if (query.status === 'upcoming') throw new Error('temporary school failure');
      return [course];
    });
    const index = await createTronClassCourseIndexReader({ source, bindings })('platform:pa_fixture');
    expect(index).toMatchObject({ kind: 'course-index', partial: true, courses: [{ id: 101 }],
      errors: [{ courseId: null, area: 'courses' }] });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('stops a guarded scoped read before contacting any private data feeds when the index becomes partial', async () => {
    const { reader, source } = setup();
    let upcomingReads = 0;
    vi.mocked(source.fetchCourses).mockImplementation(async (_cookies, query) => {
      if (query.status === 'ongoing') return [course];
      if (++upcomingReads === 1) return [];
      throw new Error('temporary school failure');
    });
    const index = await reader('platform:pa_fixture', { include: {} });
    expect(index).toMatchObject({ partial: false, courses: [{ id: 101 }] });

    const result = await reader('platform:pa_fixture', { courseId: 101, requireCompleteCourses: true,
      include: { homework: true, announcements: true, materials: true } });
    expect(result).toMatchObject({ partial: true, courses: [{ id: 101 }], errors: [{ area: 'courses' }],
      homework: [], announcements: [], materials: [] });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
  });

  it('does not contact private data feeds when the current complete index fails the selection check', async () => {
    const { reader, source } = setup();
    const acceptCourseIndex = vi.fn(() => false);
    const result = await reader('platform:pa_fixture', { courseId: 101, requireCompleteCourses: true, acceptCourseIndex,
      include: { homework: true, announcements: true, materials: true } });
    expect(acceptCourseIndex).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      courses: expect.arrayContaining([expect.objectContaining({ id: 101 })]), partial: false, errors: [],
    }));
    expect(result).toMatchObject({ partial: false, homework: [], announcements: [], materials: [] });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
  });

  it('rejects a course index if the school binding changes during its course reads', async () => {
    const { source, bindings } = setup();
    bindings.assertCurrent.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
    await expect(createTronClassCourseIndexReader({ source, bindings })('platform:pa_fixture'))
      .rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('cancels a stalled course-index read and does not dispatch homework after its deadline', async () => {
    vi.useFakeTimers();
    const { source, bindings } = setup();
    vi.mocked(source.fetchCourses).mockImplementationOnce(() => new Promise(() => undefined));
    const result = expect(createTronClassCourseIndexReader({ source, bindings, budgetMs: 100 })('platform:pa_fixture'))
      .rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(vi.mocked(source.fetchCourses).mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  });

  it('uses the verified binding without a school portal and never exposes its cookies', async () => {
    const { reader, bindings, source } = setup();
    const result = await reader('platform:pa_fixture');
    expect(bindings.requireBinding).toHaveBeenCalledWith('platform:pa_fixture');
    expect(source.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 12, status: 'ongoing' },
      { signal: expect.any(AbortSignal), timeoutMs: expect.any(Number) });
    expect(result).toMatchObject({ revision: binding.revision, partial: false, homework: [{ id: 201, submitted: false, description: '請上傳報告' }] });
    expect(JSON.stringify(result)).not.toContain('private-cookie');
    expect(source.fetchActivities).not.toHaveBeenCalled();
  });

  it('does not call a missing submission flag an unsubmitted assignment', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: { homework_activities: [{ ...assignment, submitted: undefined, homework_submissions: [1] }], total: 1 } });
    expect((await reader('platform:pa_fixture')).homework[0].submitted).toBeNull();
  });

  it('interprets a school deadline without an offset in Taipei and returns an unambiguous instant', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: {
      homework_activities: [{ ...assignment, deadline: '2026-11-20T23:59:00' }], total: 1,
    } });
    expect((await reader('platform:pa_fixture')).homework[0].deadline).toBe('2026-11-20T15:59:00.000Z');
  });

  it('loads a courseware-only material and deduplicates materials returned by both feeds', async () => {
    const { reader, source } = setup();
    const first = { id: 301, course_id: 101, title: '講義', type: 'material', uploads: [
      { name: 'notes.pdf', key: 'visible', allow_download: true },
      { name: 'private.pdf', key: 'hidden-key', allow_download: false },
    ] };
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookie, _course, query) => ({ ok: true, value: query ? [first, { ...first, id: 302, title: '課件' }] : [first] }));
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.materials.map((item) => item.id)).toEqual([301, 302]);
    expect(result.materials[0].files).toEqual([
      { name: 'notes.pdf', allowDownload: true, downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/visible/blob' },
      { name: 'private.pdf', allowDownload: false, downloadHref: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('hidden-key');
  });

  it('projects official ID-only material files to the numeric blob route without exposing storage keys', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchActivities).mockResolvedValue({ ok: true, value: [{
      id: 301, course_id: 101, title: '課堂講義', type: 'material', uploads: [
        { id: 741, name: 'notes.pdf', allow_download: true },
        { id: 742, key: 'private-storage-key', name: 'slides.pdf', allow_download: true },
        { id: 743, name: 'reference.pdf', allow_download: true, reference_id: 91 },
        { id: 744, name: 'external.pdf', allow_download: true, source: 'LARK' },
        { id: 745, name: 'pending.pdf', allow_download: true, audit_status: 'pending' },
        { id: 746, name: 'restricted.pdf', allow_download: false },
      ],
    }] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.materials[0].files.map(file => file.downloadHref)).toEqual([
      'https://tronclass.pu.edu.tw/api/uploads/741/blob',
      'https://tronclass.pu.edu.tw/api/uploads/742/blob',
      null, null, null, null,
    ]);
    expect(JSON.stringify(result)).not.toContain('private-storage-key');
  });

  it('omits hidden and unpublished work, announcements, and materials from the returned snapshot', async () => {
    const { reader, source } = setup();
    const deniedFlags = [
      { is_hidden: true }, { is_hidden: 1 }, { hidden: true }, { hidden: 1 },
      { published: false }, { published: 0 }, { is_hidden: 1, published: true },
    ];
    vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: {
      homework_activities: [assignment, ...deniedFlags.map((flags, n) => ({
        ...assignment, ...flags, id: 210 + n, title: `restricted-homework-${n}`,
        data: { description: 'restricted-homework-body' },
      }))], total: 1 + deniedFlags.length,
    } });
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => ({
      ok: true, value: query ? [] : [
        { id: 301, course_id: 101, title: '公開講義', type: 'material', published: 1, is_hidden: 0 },
        { id: 401, course_id: 101, title: '公開活動公告', type: 'announcement', published: true, hidden: false },
        ...deniedFlags.flatMap((flags, n) => [
          { id: 310 + n, course_id: 101, type: 'material', ...flags, title: `restricted-material-${n}`,
            uploads: [{ name: 'restricted-filename.pdf', key: 'restricted-file-key', allow_download: true }] },
          { id: 410 + n, course_id: 101, type: 'announcement', ...flags,
            title: `restricted-announcement-${n}`, content: 'restricted-announcement-body' },
        ]),
      ],
    }));
    vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: true, value: [
      { id: 501, course_id: 101, title: '公開課程公告', content: '公告內容' },
      ...deniedFlags.map((flags, n) => ({
        id: 510 + n, course_id: 101, ...flags, title: `restricted-course-notice-${n}`, content: 'restricted-course-body',
      })),
    ] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.partial).toBe(false);
    expect(result.homework.map((item) => item.id)).toEqual([201]);
    expect(result.materials.map((item) => item.id)).toEqual([301]);
    expect(result.announcements.map((item) => item.title)).toEqual(['公開課程公告', '公開活動公告']);
    expect(JSON.stringify(result)).not.toContain('restricted-');
  });

  it('does not let a public duplicate override a hidden copy from another activity feed', async () => {
    const { reader, source } = setup();
    const rows = [
      { id: 301, course_id: 101, title: 'restricted-material', type: 'material', published: true },
      { id: 401, course_id: 101, title: 'restricted-announcement', type: 'announcement', published: 1 },
    ];
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => ({
      ok: true, value: query ? rows.map((row) => ({ ...row, is_hidden: 1 })) : rows,
    }));
    vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: true, value: [
      { id: 501, title: 'restricted-notice', published: true },
      { id: 501, title: 'restricted-notice', published: false },
      // Course notices use an independent namespace from activity IDs.
      { id: 301, title: '公開課程公告', published: true },
    ] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.materials).toEqual([]);
    expect(result.announcements.map((item) => item.title)).toEqual(['公開課程公告']);
    expect(JSON.stringify(result)).not.toContain('restricted-');
  });

  it('omits explicitly hidden attachments without removing permitted files from a visible material', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchActivities).mockResolvedValue({ ok: true, value: [{
      id: 301, course_id: 101, title: '講義', type: 'material', uploads: [
        { name: 'visible.pdf', key: 'visible-key', allow_download: true },
        { name: 'restricted-hidden.pdf', key: 'restricted-key', allow_download: true, is_hidden: 1 },
        { name: 'restricted-unpublished.pdf', key: 'restricted-key-2', allow_download: true, published: false },
      ],
    }] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.materials[0].files.map((item) => item.name)).toEqual(['visible.pdf']);
    expect(JSON.stringify(result)).not.toContain('restricted-');
  });

  it('counts every source row while reading past a page containing only hidden homework', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: {
        homework_activities: Array.from({ length: 50 }, (_, n) => ({ id: 300 + n, course_id: 101, is_hidden: 1 })), total: 51,
      } })
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: [assignment], total: 51 } });
    const result = await reader('platform:pa_fixture');
    expect(result).toMatchObject({ partial: false, homework: [{ id: 201 }] });
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
    expect(source.fetchHomeworkPage).toHaveBeenLastCalledWith(binding.cookies, 101, 2, 50,
      { signal: expect.any(AbortSignal), timeoutMs: expect.any(Number) });
  });

  it.each(['repeated-hidden-id', 'missing-page'] as const)('still reports %s after filtering a full hidden page', async (failure) => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: {
        homework_activities: Array.from({ length: 50 }, (_, n) => ({ ...assignment, id: 300 + n, hidden: true })), total: 51,
      } })
      .mockResolvedValueOnce({ ok: true, value: {
        homework_activities: failure === 'repeated-hidden-id' ? [{ ...assignment, id: 300 }] : [], total: 51,
      } });
    const result = await reader('platform:pa_fixture');
    expect(result).toMatchObject({ partial: true, homework: [], errors: [{ courseId: 101, area: 'homework' }] });
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
  });

  it('rejects another course before reading its activities', async () => {
    const { reader, source } = setup();
    await expect(reader('platform:pa_fixture', { courseId: 999 })).rejects.toMatchObject({ status: 403 });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
  });

  it('does not return data when the owner reconnects during an upstream read', async () => {
    const { reader, source, bindings } = setup();
    vi.mocked(source.fetchHomeworkPage).mockImplementation(async () => {
      bindings.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return { ok: true, value: { homework_activities: [assignment], total: 1 } };
    });
    await expect(reader('platform:pa_fixture')).rejects.toMatchObject({ status: 409 });
  });

  it.each(['homework', 'courseware', 'announcements'] as const)('rejects the whole response after %s reports an expired session', async (area) => {
    const { reader, source } = setup();
    if (area === 'homework') vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: false, status: 401 });
    if (area === 'courseware') vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _id, query) => query ? { ok: false, status: 401 } : { ok: true, value: [] });
    if (area === 'announcements') vi.mocked(source.fetchCourseAnnouncements).mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
    await expect(reader('platform:pa_fixture', { courseId: 101 })).rejects.toMatchObject({ status: 401 });
  });

  it('treats an incomplete second page as a partial sync, not as no homework', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: Array.from({ length: 50 }, (_, n) => ({ ...assignment, id: 201 + n })), total: 51 } })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await reader('platform:pa_fixture');
    expect(result).toMatchObject({ homework: [], partial: true, errors: [{ courseId: 101, area: 'homework' }] });
  });

  it('does not turn a failed course listing into an empty successful result', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchCourses).mockRejectedValue(new Error('unavailable upstream body with cookies'));
    await expect(reader('platform:pa_fixture')).rejects.toMatchObject({ code: 'TRONCLASS_SOURCE_UNAVAILABLE' });
  });

  it.each([404, 503])('distinguishes an absent optional courseware feed from an outage (%s)', async (status) => {
    const { reader, source } = setup();
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookie, _id, query) => query ? { ok: false, status } : { ok: true, value: [] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.partial).toBe(status !== 404);
  });

  it('stops dispatching new school calls when the bounded request has expired', async () => {
    const { source, bindings } = setup();
    let finish!: (value: unknown) => void;
    vi.mocked(source.fetchCourses).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const read = createTronClassIntegrationReader({ source, bindings, budgetMs: 10 });
    await expect(read('platform:pa_fixture')).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    finish([course]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.fetchCourses).toHaveBeenCalledTimes(1);
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(vi.mocked(source.fetchCourses).mock.calls[0][2]?.signal?.aborted).toBe(true);
  });

  it.each(['courses', 'homework', 'activities', 'announcements'] as const)(
    'cancels an in-flight %s transport when the whole sync reaches its deadline', async phase => {
      vi.useFakeTimers();
      const { source, bindings } = setup();
      const activeSignals: AbortSignal[] = [];
      const stall = (options?: LmsReadOptions) => new Promise<never>((_resolve, reject) => {
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(options?.timeoutMs).toBeGreaterThan(0);
        expect(options?.timeoutMs).toBeLessThanOrEqual(100);
        activeSignals.push(options!.signal!);
        options!.signal!.addEventListener('abort', () => reject(new Error('private transport cancellation')), { once: true });
      });
      if (phase === 'courses') vi.mocked(source.fetchCourses).mockImplementationOnce((_cookies, _query, options) => stall(options));
      if (phase === 'homework') vi.mocked(source.fetchHomeworkPage).mockImplementation((_cookies, _course, _page, _size, options) => stall(options));
      if (phase === 'activities') vi.mocked(source.fetchActivities).mockImplementation((_cookies, _course, _query, options) => stall(options));
      if (phase === 'announcements') vi.mocked(source.fetchCourseAnnouncements).mockImplementation((_cookies, _course, options) => stall(options));
      const read = createTronClassIntegrationReader({ source, bindings, budgetMs: 100 });
      const result = expect(read('platform:pa_fixture', { courseId: 101 }))
        .rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT', status: 503 });
      await vi.advanceTimersByTimeAsync(100);
      await result;
      expect(activeSignals.length).toBe(phase === 'activities' ? 2 : 1);
      expect(activeSignals.every(signal => signal.aborted)).toBe(true);
      expect(new Set(activeSignals).size).toBe(1);
    },
  );

  it('does not start binding or school reads for an already cancelled request', async () => {
    const { reader, source, bindings } = setup();
    await expect(reader('platform:pa_fixture', {}, AbortSignal.abort(new Error('private caller reason'))))
      .rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    expect(bindings.requireBinding).not.toHaveBeenCalled();
    expect(source.fetchCourses).not.toHaveBeenCalled();
  });

  it('cancels every active content read on client disconnect without returning a partial success', async () => {
    const { reader, source } = setup();
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    let allStarted!: () => void;
    const started = new Promise<void>(resolve => { allStarted = resolve; });
    const stall = (options?: LmsReadOptions) => new Promise<never>((_resolve, reject) => {
      signals.push(options!.signal!);
      if (signals.length === 3) allStarted();
      options!.signal!.addEventListener('abort', () => reject(new Error('private cancellation detail')), { once: true });
    });
    vi.mocked(source.fetchActivities).mockImplementation((_cookies, _course, _query, options) => stall(options));
    vi.mocked(source.fetchCourseAnnouncements).mockImplementation((_cookies, _course, options) => stall(options));
    const result = expect(reader('platform:pa_fixture', { courseId: 101 }, controller.signal))
      .rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT', message: 'TRONCLASS_READ_TIMEOUT' });
    await started;
    controller.abort(new Error('private client cancellation'));
    await result;
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it.each([401, 403])('cancels sibling course workers immediately when one loses access (%s)', async status => {
    const { reader, source } = setup();
    vi.mocked(source.fetchCourses).mockImplementation(async (_cookies, query) => query.status === 'ongoing'
      ? [101, 102, 103, 104].map(id => ({ ...course, id })) : []);
    const signals: AbortSignal[] = [];
    let allStarted!: () => void;
    let revoke!: (result: LmsReadResult<{ homework_activities: unknown[]; total: number }>) => void;
    const started = new Promise<void>(resolve => { allStarted = resolve; });
    vi.mocked(source.fetchHomeworkPage).mockImplementation((_cookies, courseId, _page, _size, options) => new Promise((resolve, reject) => {
      signals.push(options!.signal!);
      if (signals.length === 3) allStarted();
      if (courseId === 101) revoke = resolve;
      options!.signal!.addEventListener('abort', () => reject(new Error('sibling request cancelled')), { once: true });
    }));
    const result = expect(reader('platform:pa_fixture')).rejects.toMatchObject({
      status, code: status === 401 ? 'TRONCLASS_RECONNECT_REQUIRED' : 'TRONCLASS_COURSE_ACCESS_DENIED',
    });
    await started;
    revoke({ ok: false, status });
    await result;
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(3);
    expect(source.fetchActivities).not.toHaveBeenCalled();
  });

  it('cancels stalled sibling content requests as soon as a feed returns forbidden', async () => {
    const { reader, source } = setup();
    const signals: AbortSignal[] = [];
    vi.mocked(source.fetchActivities).mockImplementation((_cookies, _course, _query, options) => new Promise((_resolve, reject) => {
      signals.push(options!.signal!);
      options!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: false, status: 403 });
    await expect(reader('platform:pa_fixture', { courseId: 101 }))
      .rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED', status: 403 });
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it('shares the remaining budget across courses, homework and parallel content feeds', async () => {
    const { source, bindings } = setup();
    let time = 1_000;
    vi.mocked(source.fetchCourses).mockImplementation(async (_cookies, query) => {
      time += 10;
      return query.status === 'ongoing' ? [course] : [];
    });
    vi.mocked(source.fetchHomeworkPage).mockImplementation(async () => {
      time += 20;
      return { ok: true, value: { homework_activities: [assignment], total: 1 } };
    });
    const read = createTronClassIntegrationReader({ source, bindings, now: () => time, budgetMs: 100 });
    await expect(read('platform:pa_fixture', { courseId: 101 })).resolves.toMatchObject({ partial: false });
    const calls = [
      ...vi.mocked(source.fetchCourses).mock.calls.map(call => call[2]),
      ...vi.mocked(source.fetchHomeworkPage).mock.calls.map(call => call[4]),
      ...vi.mocked(source.fetchActivities).mock.calls.map(call => call[3]),
      ...vi.mocked(source.fetchCourseAnnouncements).mock.calls.map(call => call[2]),
    ];
    expect(calls.map(options => options?.timeoutMs)).toEqual([100, 90, 80, 60, 60, 60]);
    expect(new Set(calls.map(options => options?.signal)).size).toBe(1);
  });

  it('bounds a stalled binding check and never starts school reads when it resolves late', async () => {
    vi.useFakeTimers();
    const { source, bindings } = setup();
    let finish!: (value: typeof binding) => void;
    bindings.requireBinding.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const read = createTronClassIntegrationReader({ source, bindings, budgetMs: 100 });
    const result = expect(read('platform:pa_fixture')).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    finish(binding);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.fetchCourses).not.toHaveBeenCalled();
  });

  it('does not dispatch homework when only announcements are requested', async () => {
    const { reader, source } = setup();
    const result = await reader('platform:pa_fixture', { courseId: 101, include: { announcements: true } });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).toHaveBeenCalled();
    expect(source.fetchActivities).toHaveBeenCalled();
    expect(vi.mocked(source.fetchActivities).mock.calls.every((call) => call[2] === '')).toBe(true);
    expect(result.homework).toEqual([]);
  });

  it('does not dispatch homework when only materials are requested', async () => {
    const { reader, source } = setup();
    const result = await reader('platform:pa_fixture', { courseId: 101, include: { materials: true } });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(result.homework).toEqual([]);
  });

  it('still reads homework when the homework area is requested', async () => {
    const { reader, source } = setup();
    const result = await reader('platform:pa_fixture', { include: { homework: true } });
    expect(source.fetchHomeworkPage).toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(result.homework).toHaveLength(1);
  });

  it('does not dispatch homework or contents for a courses-only include', async () => {
    const { reader, source } = setup();
    const result = await reader('platform:pa_fixture', { include: {} });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(result.homework).toEqual([]);
    expect(result.announcements).toEqual([]);
    expect(result.materials).toEqual([]);
    expect(result.courses).toHaveLength(1);
  });
});
