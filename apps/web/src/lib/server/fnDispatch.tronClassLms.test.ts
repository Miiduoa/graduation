// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { getCloudFunctionUrl } from '../cloudFunctions';
import { LMS_CACHE_COLLECTION, LMS_SNAPSHOT_TTL_MS } from '@campus/shared/src/puLmsReadonly';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type { LmsReadonlySnapshot } from '../tronClassLmsTypes';
import {
  LMS_FIXTURE_ANNOUNCEMENT,
  LMS_FIXTURE_COURSE,
  LMS_FIXTURE_HOMEWORK_DONE,
  LMS_FIXTURE_HOMEWORK_OPEN,
  LMS_FIXTURE_MATERIAL,
} from './fixtures/tronclass-lms-readonly';

const UID = 'pu-410000001';
const LMS_ID = 'b'.repeat(32);
const LMS = `_puTronClassSessions/${LMS_ID}`;
const PORTAL = '_puSessions/current';
const CACHE = `${LMS_CACHE_COLLECTION}/${UID}`;
const RETRY = `${LMS_CACHE_COLLECTION}/${UID}__retry`;

function setup() {
  const expiresAt = new Date(Date.now() + 60_000);
  const store = createMemoryGroupStore([
    [`users/${UID}`, { schoolId: 'pu' }],
    [`schools/pu/members/${UID}`, { status: 'active' }],
    [PORTAL, { ownerUid: UID, cookies: { portal: 'secret' }, expiresAt, tronClassSessionId: LMS_ID }],
    [LMS, { ownerUid: UID, cookies: { session: 'lms-secret' }, userId: 10, expiresAt }],
  ]);
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn().mockResolvedValue([LMS_FIXTURE_COURSE]),
    fetchHomeworkPage: vi.fn().mockResolvedValue({
      ok: true,
      value: { homework_activities: [LMS_FIXTURE_HOMEWORK_OPEN, LMS_FIXTURE_HOMEWORK_DONE], total: 2 },
    }),
    fetchActivities: vi.fn().mockImplementation(async (_cookies, _courseId, query) => (
      query === 'type=courseware_activity'
        ? { ok: true, value: [] }
        : { ok: true, value: [LMS_FIXTURE_MATERIAL] }
    )),
    fetchCourseAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [LMS_FIXTURE_ANNOUNCEMENT] }),
    fetchSiteAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
  const verifyIdToken = vi.fn().mockResolvedValue({ uid: UID, schoolId: 'pu' });
  const runtime: FnRuntime = {
    db: store.db as unknown as FnRuntime['db'], verifyIdToken, lmsReadonlySource: source,
  };
  const request = (data: unknown = {}, authorized = true) => dispatchFnRequest(
    'getMyTronClassLms', new Request('https://nuni.tw/api/fn/getMyTronClassLms', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer id-token' } : {}) },
      body: JSON.stringify({ data }),
    }), runtime,
  );
  return { request, store, source, verifyIdToken };
}

beforeEach(() => {
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', 'true');
  resetUidRateLimitForTests();
});

it('hosts the read-only LMS callable next to the course list', () => {
  expect(getCloudFunctionUrl('getMyTronClassLms', { env: {} })).toBe('/api/fn/getMyTronClassLms');
});

it('loads homework without per-course activities on a cold list', async () => {
  const { request, source } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect(source.fetchCourses).toHaveBeenCalledWith({ session: 'lms-secret' }, { userId: 10, status: 'ongoing' });
  expect(source.fetchCourses).toHaveBeenCalledTimes(2);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  expect(source.fetchActivities).not.toHaveBeenCalled();
  expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
  expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
  const body = await response.json();
  expect(body.result.homework).toEqual([
    expect.objectContaining({
      id: 20001, courseName: '資料庫系統', submitted: false,
      deadlineLabel: '2026/5/29 下午11:59',
      href: 'https://tronclass.pu.edu.tw/course/10001/content#/activity/20001',
    }),
    expect.objectContaining({ id: 20002, submitted: true }),
  ]);
  expect(body.result.announcements).toEqual([]);
  expect(body.result.materials).toEqual([]);
  expect(JSON.stringify(body)).not.toMatch(/secret|cookies/);
});

it('loads general and filtered courseware activities without downloading locked files', async () => {
  const { request, source } = setup();
  await request();
  vi.mocked(source.fetchHomeworkPage).mockClear();
  vi.mocked(source.fetchCourses).mockClear();
  const body = await (await request({ courseId: 10001 })).json();
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(source.fetchCourses).not.toHaveBeenCalled();
  expect(source.fetchActivities).toHaveBeenCalledTimes(2);
  expect(source.fetchActivities).toHaveBeenCalledWith({ session: 'lms-secret' }, 10001, '');
  expect(source.fetchActivities).toHaveBeenCalledWith({ session: 'lms-secret' }, 10001, 'type=courseware_activity');
  expect(source.fetchCourseAnnouncements).toHaveBeenCalledTimes(1);
  expect(body.result.materials[0].files).toEqual([
    expect.objectContaining({ name: 'notes.pdf', allowDownload: true, downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/upload-key-notes/blob' }),
    expect.objectContaining({ name: 'restricted.pdf', allowDownload: false, downloadHref: null }),
  ]);
  expect(body.result.announcements[0]).toMatchObject({ title: '停課通知', source: 'course' });
  expect(JSON.stringify(body)).not.toMatch(/secret|cookies|upload-key-restricted/);
});

it('preserves main visibility for school-returned rows and attachments', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({
    ok: true,
    value: {
      homework_activities: [
        { ...LMS_FIXTURE_HOMEWORK_OPEN, hidden: true },
        { ...LMS_FIXTURE_HOMEWORK_DONE, course_id: 99999 },
        { ...LMS_FIXTURE_HOMEWORK_OPEN, id: 20003, published: false },
        { ...LMS_FIXTURE_HOMEWORK_OPEN, id: 20004, title: '可見作業' },
      ],
      total: 4,
    },
  });
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => ({
    ok: true,
    value: query === 'type=courseware_activity' ? [
      { ...LMS_FIXTURE_MATERIAL, id: 30001, is_hidden: true },
      { ...LMS_FIXTURE_MATERIAL, id: 31001, hidden: true },
      { id: 42004, type: 'announcement', title: '被另一來源隱藏的公告', hidden: true },
    ] : [
      LMS_FIXTURE_MATERIAL,
      { ...LMS_FIXTURE_MATERIAL, id: 31002, course_id: 99999 },
      { ...LMS_FIXTURE_MATERIAL, id: 31003, published: false },
      { ...LMS_FIXTURE_MATERIAL, id: 31004, uploads: [
        { name: 'hidden.pdf', key: 'hidden-key', allow_download: true, hidden: true },
        { name: 'public.pdf', key: 'public-key', allow_download: true },
      ] },
      { id: 42001, type: 'announcement', title: '外課公告', course_id: 99999 },
      { id: 42002, type: 'announcement', title: '草稿公告', published: false },
      { id: 42004, type: 'announcement', title: '被另一來源隱藏的公告' },
    ],
  }));
  vi.mocked(source.fetchCourseAnnouncements).mockResolvedValueOnce({
    ok: true,
    value: [
      LMS_FIXTURE_ANNOUNCEMENT,
      { ...LMS_FIXTURE_ANNOUNCEMENT, id: 40002, course_id: 99999, title: '外課公告' },
      { ...LMS_FIXTURE_ANNOUNCEMENT, id: 40003, is_hidden: true, title: '隱藏公告' },
    ],
  });

  const response = await request({ courseId: 10001 });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.homework.map((row: { id: number }) => row.id)).toEqual([20001, 20002, 20003, 20004]);
  expect(body.result.materials.map((row: { id: number }) => row.id)).toEqual([30001, 31002, 31003, 31004, 31001]);
  expect(body.result.materials.find((row: { id: number }) => row.id === 31004).files).toEqual([
    expect.objectContaining({ name: 'hidden.pdf', allowDownload: true }),
    expect.objectContaining({ name: 'public.pdf', allowDownload: true }),
  ]);
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ title: '停課通知', source: 'course' }),
    expect.objectContaining({ title: '外課公告', source: 'course' }),
    expect.objectContaining({ title: '隱藏公告', source: 'course' }),
    expect.objectContaining({ title: '外課公告', source: 'activity' }),
    expect.objectContaining({ title: '草稿公告', source: 'activity' }),
    expect.objectContaining({ title: '被另一來源隱藏的公告', source: 'activity' }),
  ]);
  expect(body.result.courseErrors).toEqual([]);
});

it('pages homework until total and does not treat a later 500 as an empty course', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkPage)
    .mockResolvedValueOnce({
      ok: true,
      value: { homework_activities: Array.from({ length: 50 }, (_, index) => ({
        id: 21000 + index, title: `作業 ${index + 1}`, submitted: false, deadline: '2026-05-29T15:59:00Z',
      })), total: 51 },
    })
    .mockResolvedValueOnce({ ok: false, status: 500 });
  const body = await (await request()).json();
  expect(body.result.homework).toEqual([]);
  expect(body.result.courseErrors).toEqual([
    expect.objectContaining({ courseId: 10001, area: 'homework', status: 500 }),
  ]);
});

it.each(['empty', 'error', 'repeated', 'recovered'] as const)(
  'counts distinct source IDs across duplicate homework pages (%s)',
  async (ending) => {
    const { request, source } = setup();
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...LMS_FIXTURE_HOMEWORK_OPEN, id: 21000 + index,
    }));
    vi.mocked(source.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: rows, total: 100 } })
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: rows, total: 100 } })
      .mockResolvedValue(ending === 'error'
        ? { ok: false, status: 503 }
        : { ok: true, value: {
          homework_activities: ending === 'empty' ? [] : ending === 'repeated' ? rows
            : rows.map((row) => ({ ...row, id: row.id + 50 })),
          total: 100,
        } });

    const body = await (await request()).json();
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(ending === 'repeated' ? 20 : 3);
    if (ending === 'recovered') {
      expect(body.result.homework).toHaveLength(100);
      expect(body.result.courseErrors).toEqual([]);
    } else {
      expect(body.result.homework).toEqual([]);
      expect(body.result.courseErrors).toEqual([
        expect.objectContaining({ area: 'homework', status: ending === 'error' ? 503 : null }),
      ]);
    }
  },
);

it('counts source IDs even when a homework row has no displayable title', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({
    ok: true, value: {
      homework_activities: [LMS_FIXTURE_HOMEWORK_OPEN, { id: 20002 }], total: 2,
    },
  });
  const body = await (await request()).json();
  expect(body.result.homework).toHaveLength(1);
  expect(body.result.courseErrors).toEqual([]);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
});

it('retries incomplete homework after its stored short TTL expires', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });

  const first = await (await request()).json();
  expect(first.result.homework).toEqual([]);
  expect(first.result.courseErrors).toEqual([
    expect.objectContaining({ area: 'homework', status: 503 }),
  ]);
  const cached = store.docs.get(CACHE)! as { snapshot: LmsReadonlySnapshot; expiresAt: Date };
  const shortTtl = Date.parse(cached.snapshot.cache.expiresAt) - Date.parse(cached.snapshot.fetchedAt);
  expect(shortTtl).toBeGreaterThan(58_000);
  expect(shortTtl).toBeLessThanOrEqual(60_000);

  const immediate = await (await request()).json();
  expect(immediate.result.cache.hit).toBe(true);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);

  // Expire both cache TTLs without waiting for the retry window.
  cached.snapshot.fetchedAt = new Date(Date.now() - 61_000).toISOString();
  cached.snapshot.cache.expiresAt = new Date(Date.now() - 1).toISOString();
  cached.expiresAt = new Date(Date.now() - 1);
  const recovered = await (await request()).json();
  expect(recovered.result.cache.hit).toBe(false);
  expect(recovered.result.homework).toHaveLength(2);
  expect(recovered.result.courseErrors).toEqual([]);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
  const renewed = store.docs.get(CACHE)!.snapshot as LmsReadonlySnapshot;
  expect(Date.parse(renewed.cache.expiresAt) - Date.parse(renewed.fetchedAt))
    .toBeGreaterThan(580_000);
});

it('retries an incomplete upcoming-course list without discarding current homework', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchCourses)
    .mockResolvedValueOnce([LMS_FIXTURE_COURSE])
    .mockRejectedValueOnce(new Error('upcoming course source unavailable'));

  const first = await (await request()).json();
  expect(first.result.homework).toHaveLength(2);
  expect(first.result.upcomingCoursesError).toEqual({ status: null });
  const stored = store.docs.get(CACHE)! as { snapshot: LmsReadonlySnapshot; expiresAt: Date };
  expect(Date.parse(stored.snapshot.cache.expiresAt) - Date.parse(stored.snapshot.fetchedAt))
    .toBeLessThanOrEqual(60_000);

  const immediate = await (await request()).json();
  expect(immediate.result.cache.hit).toBe(true);
  expect(source.fetchCourses).toHaveBeenCalledTimes(2);

  // Expire the stored retry window.
  stored.snapshot.fetchedAt = new Date(Date.now() - 61_000).toISOString();
  stored.snapshot.cache.expiresAt = new Date(Date.now() - 1).toISOString();
  stored.expiresAt = new Date(Date.now() - 1);
  const recovered = await (await request()).json();
  expect(recovered.result.cache.hit).toBe(false);
  expect(recovered.result.homework).toHaveLength(2);
  expect(recovered.result.upcomingCoursesError).toBeNull();
  expect(source.fetchCourses).toHaveBeenCalledTimes(4);
  expect(Date.parse((store.docs.get(CACHE)!.snapshot as LmsReadonlySnapshot).cache.expiresAt) -
    Date.parse((store.docs.get(CACHE)!.snapshot as LmsReadonlySnapshot).fetchedAt)).toBeGreaterThan(580_000);
});

it('keeps the page up when one course feature returns 500', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchCourseAnnouncements).mockResolvedValueOnce({ ok: false, status: 500 });
  vi.mocked(source.fetchActivities).mockResolvedValue({ ok: true, value: [LMS_FIXTURE_MATERIAL] });
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.homework).toHaveLength(2);
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.courseErrors).toEqual([
    expect.objectContaining({ area: 'announcements', status: 500 }),
  ]);
  expect(body.result.announcements).toEqual([]);
});

it('includes courseware-only materials and deduplicates items shared by both feeds', async () => {
  const { request, source } = setup();
  const additional = {
    id: 30999, title: '補充講義', type: 'courseware_activity',
    uploads: [{ name: 'extra.pdf', key: 'extra-pdf', allow_download: true }],
  };
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => ({
    ok: true,
    value: query === 'type=courseware_activity'
      ? [LMS_FIXTURE_MATERIAL, additional] : [LMS_FIXTURE_MATERIAL],
  }));

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.materials).toHaveLength(2);
  expect(body.result.materials.filter((item: { id: number }) => item.id === LMS_FIXTURE_MATERIAL.id))
    .toHaveLength(1);
  expect(body.result.materials).toContainEqual(expect.objectContaining({
    id: 30999, title: '補充講義',
    files: [expect.objectContaining({
      name: 'extra.pdf', downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/extra-pdf/blob',
    })],
  }));
  expect(body.result.courseErrors).toEqual([]);
  expect(source.fetchActivities).toHaveBeenCalledWith(
    { session: 'lms-secret' }, 10001, 'type=courseware_activity',
  );
});

it('does not treat filtered courseware entries as another announcement feed', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => ({
    ok: true,
    value: query === 'type=courseware_activity'
      ? [LMS_FIXTURE_MATERIAL, {
        id: 40099, title: '不應出現在公告列表', type: 'announcement',
        content: '篩選教材端點不是公告來源',
      }]
      : [LMS_FIXTURE_MATERIAL],
  }));

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ title: '停課通知', source: 'course' }),
  ]);
  expect(body.result.courseErrors).toEqual([]);
});

it('reports incomplete announcements when only the filtered courseware feed succeeds', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) =>
    query === 'type=courseware_activity'
      ? { ok: true, value: [LMS_FIXTURE_MATERIAL] }
      : { ok: false, status: 503 });
  vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: false, status: 404 });

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.announcements).toEqual([]);
  expect(body.result.courseErrors).toEqual([
    expect.objectContaining({ courseId: 10001, area: 'materials', status: 503 }),
    expect.objectContaining({ courseId: 10001, area: 'announcements', status: 404 }),
  ]);
});

it('marks announcements incomplete when the general feed fails despite dedicated notices succeeding', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) =>
    query === 'type=courseware_activity'
      ? { ok: true, value: [LMS_FIXTURE_MATERIAL] }
      : { ok: false, status: 503 });

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ title: '停課通知', source: 'course' }),
  ]);
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.courseErrors).toEqual([
    expect.objectContaining({ courseId: 10001, area: 'materials', status: 503 }),
    expect.objectContaining({ courseId: 10001, area: 'announcements', status: 503 }),
  ]);
});

it('retries incomplete course content after its stored one-minute TTL expires', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) =>
    query === 'type=courseware_activity'
      ? { ok: true, value: [LMS_FIXTURE_MATERIAL] }
      : { ok: false, status: 503 });

  const first = await (await request({ courseId: 10001 })).json();
  expect(first.result.materials).toHaveLength(1);
  expect(first.result.courseErrors).toEqual([
    expect.objectContaining({ area: 'materials', status: 503 }),
    expect.objectContaining({ area: 'announcements', status: 503 }),
  ]);

  type CachedExtra = { fetchedAt: string; expiresAt: string; errors: unknown[] };
  const extras = store.docs.get(CACHE)!.extras as Record<string, CachedExtra>;
  const partial = extras['10001'];
  expect(partial.errors).toHaveLength(2);
  const partialTtl = Date.parse(partial.expiresAt) - Date.parse(partial.fetchedAt);
  expect(partialTtl).toBeGreaterThan(58_000);
  expect(partialTtl).toBeLessThanOrEqual(60_000);
  expect(Date.parse(first.result.cache.expiresAt) - Date.parse(partial.fetchedAt))
    .toBeGreaterThan(60_000);

  vi.mocked(source.fetchActivities).mockClear().mockResolvedValue({
    ok: true, value: [LMS_FIXTURE_MATERIAL],
  });
  const cached = await (await request({ courseId: 10001 })).json();
  expect(cached.result.cache.hit).toBe(true);
  expect(source.fetchActivities).not.toHaveBeenCalled();

  // Expire the stored course-content retry window.
  partial.fetchedAt = new Date(Date.now() - 61_000).toISOString();
  partial.expiresAt = new Date(Date.now() - 1).toISOString();
  const recovered = await (await request({ courseId: 10001 })).json();
  expect(recovered.result.cache.hit).toBe(false);
  expect(recovered.result.courseErrors).toEqual([]);
  expect(recovered.result.materials).toHaveLength(1);
  expect(source.fetchActivities).toHaveBeenCalledTimes(2);
  const fresh = (store.docs.get(CACHE)!.extras as Record<string, CachedExtra>)['10001'];
  expect(fresh.errors).toEqual([]);
  expect(Date.parse(fresh.expiresAt) - Date.parse(fresh.fetchedAt)).toBeGreaterThan(580_000);
});

it.each([
  { status: 404, thrown: false },
  { status: 503, thrown: false },
  { status: 503, thrown: true },
  { status: null, thrown: true },
])('keeps original course data after supplementary courseware fails (%j)', async ({ status, thrown }) => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => {
    if (query !== 'type=courseware_activity') return { ok: true, value: [LMS_FIXTURE_MATERIAL] };
    if (thrown) throw Object.assign(new Error('upstream failure'), { status });
    return { ok: false, status };
  });
  const response = await request({ courseId: 10001 });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.homework).toHaveLength(2);
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ title: '停課通知', source: 'course' }),
  ]);
  expect(body.result.courseErrors).toEqual(status === 404
    ? []
    : [expect.objectContaining({ courseId: 10001, area: 'materials', status })]);
  expect(store.docs.get(CACHE)?.sessionVersion).toBeDefined();
  expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
});

it.each([
  { caseName: 'returned 401', mode: 'result' },
  { caseName: 'thrown HTTP 401', mode: 'http-error' },
  { caseName: 'thrown session-expired error', mode: 'expired' },
])('requires reconnect without caching when supplementary courseware has $caseName', async ({ mode }) => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => {
    if (query !== 'type=courseware_activity') return { ok: true, value: [LMS_FIXTURE_MATERIAL] };
    if (mode === 'result') return { ok: false, status: 401 };
    if (mode === 'http-error') throw Object.assign(new Error('HTTP 401'), { status: 401 });
    throw new Error('TronClass session 已失效，請重新登入');
  });

  const response = await request({ courseId: 10001 });
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(store.docs.has(CACHE)).toBe(false);
  expect(store.docs.has(RETRY)).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
});

it.each(['homework', 'activities', 'announcements'] as const)(
  'requires reconnect instead of caching partial course data after a 401 from %s',
  async (feed) => {
    const { request, source, store } = setup();
    if (feed === 'homework') {
      vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: false, status: 401 });
    } else if (feed === 'activities') {
      vi.mocked(source.fetchActivities).mockResolvedValue({ ok: false, status: 401 });
    } else {
      vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: false, status: 401 });
    }

    const response = await request({ courseId: 10001 });
    const body = await response.json();
    expect(body.error.status).toBe('FAILED_PRECONDITION');
    expect(body.result).toBeUndefined();
    expect(store.docs.has(CACHE)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
  },
);

it('requires reconnect when the upcoming course source rejects the session with HTTP 401', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchCourses)
    .mockResolvedValueOnce([LMS_FIXTURE_COURSE])
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }));
  const response = await request();
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(store.docs.has(CACHE)).toBe(false);
});

it.each(['homework', 'activities', 'announcements'] as const)(
  'requires reconnect when the %s feed throws HTTP 401 instead of returning an error result',
  async (feed) => {
    const { request, source, store } = setup();
    const rejection = Object.assign(new Error('HTTP 401'), { status: 401 });
    if (feed === 'homework') {
      vi.mocked(source.fetchHomeworkPage).mockRejectedValue(rejection);
    } else if (feed === 'activities') {
      vi.mocked(source.fetchActivities).mockRejectedValue(rejection);
    } else {
      vi.mocked(source.fetchCourseAnnouncements).mockRejectedValue(rejection);
    }

    const response = await request({ courseId: 10001 });
    const body = await response.json();
    expect(body.error.status).toBe('FAILED_PRECONDITION');
    expect(body.result).toBeUndefined();
    expect(store.docs.has(CACHE)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
  },
);

it.each(['returned', 'thrown'] as const)(
  'stops scheduling queued homework reads after the first 401 (%s)',
  async (failure) => {
    const { request, source, store } = setup();
    const courses = Array.from({ length: 5 }, (_, index) => ({
      id: 10001 + index, name: `Course ${index + 1}`,
    }));
    vi.mocked(source.fetchCourses).mockImplementation(async (_cookies, options) =>
      options.status === 'ongoing' ? courses : []);

    type PageResult = Awaited<ReturnType<LmsReadonlySource['fetchHomeworkPage']>>;
    let resolveFirst!: (result: PageResult) => void;
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<PageResult>((resolve, reject) => {
      resolveFirst = resolve;
      rejectFirst = reject;
    });
    let releasePeers!: () => void;
    const peerGate = new Promise<void>((resolve) => { releasePeers = () => resolve(); });
    let markPeersDone!: () => void;
    const peersDone = new Promise<void>((resolve) => { markPeersDone = resolve; });
    let completedPeers = 0;
    vi.mocked(source.fetchHomeworkPage).mockImplementation(async (_cookies, courseId) => {
      if (courseId === 10001) return first;
      await peerGate;
      if (++completedPeers === 2) markPeersDone();
      return { ok: true, value: { homework_activities: [], total: 0 } };
    });

    const pending = request();
    await vi.waitFor(() => expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(3));
    if (failure === 'returned') resolveFirst({ ok: false, status: 401 });
    else rejectFirst(Object.assign(new Error('HTTP 401'), { status: 401 }));
    // Let the rejected worker classify the failure before releasing peers.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    releasePeers();
    await peersDone;
    const response = await pending;
    const body = await response.json();
    await Promise.resolve();
    expect(body.error.status).toBe('FAILED_PRECONDITION');
    expect(body.result).toBeUndefined();
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(3);
    expect(vi.mocked(source.fetchHomeworkPage).mock.calls.map((args) => args[1]))
      .toEqual([10001, 10002, 10003]);
    expect(store.docs.has(CACHE)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
  },
);

it('does not retain a partial homework page when page two rejects with HTTP 401', async () => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchHomeworkPage)
    .mockResolvedValueOnce({
      ok: true,
      value: { homework_activities: Array.from({ length: 50 }, (_, index) => ({
        id: 31000 + index, title: `作業 ${index + 1}`, submitted: false,
      })), total: 51 },
    })
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }));

  const response = await request();
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
  expect(store.docs.has(CACHE)).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/lms-secret|cookies/);
});

it('uses activity announcements on 404 without marking the course as empty success', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: false, status: 404 });
  vi.mocked(source.fetchActivities).mockResolvedValue({
    ok: true,
    value: [{
      id: 40002, title: '討論區公告', type: 'announcement',
      data: { description: '改從活動讀取' },
    }, LMS_FIXTURE_MATERIAL],
  });
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.courseErrors).toEqual([]);
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ title: '討論區公告', source: 'activity' }),
  ]);
  expect(body.result.materials).toHaveLength(1);
  expect(source.fetchActivities).toHaveBeenCalledTimes(2);
});

it('keeps activity-only notices when the dedicated course announcement feed succeeds', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockResolvedValue({
    ok: true,
    value: [
      { id: 40002, title: '補充公告', type: 'announcement', content: '新增課堂資訊' },
      LMS_FIXTURE_MATERIAL,
    ],
  });
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ id: 'course:10001:40001', source: 'course', title: '停課通知' }),
    expect.objectContaining({ id: 'activity:10001:40002', source: 'activity', title: '補充公告' }),
  ]);
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.courseErrors).toEqual([]);
  expect(source.fetchActivities).toHaveBeenCalledTimes(2);
});

it('deduplicates matching activity and course notices without hiding changed content', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockResolvedValue({
    ok: true,
    value: [
      { ...LMS_FIXTURE_ANNOUNCEMENT, type: 'announcement' },
      { ...LMS_FIXTURE_ANNOUNCEMENT, type: 'announcement', content: '不同的補充內容' },
    ],
  });
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ id: 'course:10001:40001', content: '下週演習停課一次' }),
    expect.objectContaining({ id: 'activity:10001:40001', content: '不同的補充內容' }),
  ]);
  expect(body.result.courseErrors).toEqual([]);
});

it('preserves activity notices and still reports a failed dedicated course feed', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchCourseAnnouncements).mockResolvedValue({ ok: false, status: 503 });
  vi.mocked(source.fetchActivities).mockResolvedValue({
    ok: true,
    value: [{ id: 40003, title: '臨時公告', type: 'announcement', content: '暫時由活動來源提供' }],
  });
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.announcements).toEqual([
    expect.objectContaining({ id: 'activity:10001:40003', source: 'activity' }),
  ]);
  expect(body.result.courseErrors).toEqual([
    expect.objectContaining({ courseId: 10001, area: 'announcements', status: 503 }),
  ]);
});

it('keeps ongoing homework when upcoming courses cannot be listed', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchCourses)
    .mockResolvedValueOnce([LMS_FIXTURE_COURSE])
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 500'), { status: 500 }));
  const body = await (await request()).json();
  expect(body.result.homework).toHaveLength(2);
  expect(body.result.upcomingCoursesError).toEqual({ status: null });
});

it('reports 玩課雲 as connecting while login is still hanging the LMS session', async () => {
  const { request, source, store } = setup();
  Object.assign(store.docs.get(PORTAL)!, {
    tronClassSessionId: null,
    lmsConnectingUntil: new Date(Date.now() + 90_000),
  });
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.error.status).toBe('UNAVAILABLE');
  expect(body.error.message).toMatch(/正在連線玩課雲/);
  expect(body.error.details).toEqual({ code: 'lms-connecting' });
  expect(source.fetchCourses).not.toHaveBeenCalled();
});

it('keeps connecting when the linked LMS document is not written yet', async () => {
  const { request, source, store } = setup();
  Object.assign(store.docs.get(PORTAL)!, {
    lmsConnectingUntil: new Date(Date.now() + 90_000),
  });
  store.docs.delete(LMS);
  const response = await request();
  expect(response.status).toBe(503);
  expect((await response.json()).error.details).toEqual({ code: 'lms-connecting' });
  expect(source.fetchCourses).not.toHaveBeenCalled();
});

it('maps session expiry to reconnect and does not leak the school payload', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchHomeworkPage).mockRejectedValueOnce(new Error('TronClass session 已失效，請重新登入'));
  const response = await request();
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(JSON.stringify(await (await request({ refresh: true })).json())).not.toMatch(/lms-secret/);
});

it('serves a fresh cache within TTL and bypasses it on refresh', async () => {
  const { request, source, store } = setup();
  expect((await (await request()).json()).result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalled();
  vi.mocked(source.fetchHomeworkPage).mockClear();
  const cached = await (await request()).json();
  expect(cached.result.cache.hit).toBe(true);
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)?.ownerUid).toBe(UID);
  const refreshed = await (await request({ refresh: true })).json();
  expect(refreshed.result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalled();
});

it('does not reuse an expired cache document and overwrites it', async () => {
  const { request, source, store } = setup();
  store.docs.set(CACHE, {
    ownerUid: UID,
    expiresAt: new Date(Date.now() - LMS_SNAPSHOT_TTL_MS),
    snapshot: {
      success: true, ownerUid: UID, schoolId: 'pu', source: 'pu-tronclass',
      fetchedAt: '2026-01-01T00:00:00.000Z', cache: { hit: false, expiresAt: '2026-01-01T00:10:00.000Z' },
      courses: [], contentsLoadedFor: [], homework: [], announcements: [], materials: [], courseErrors: [],
      siteAnnouncementError: null, upcomingCoursesError: null,
    },
  });
  const body = await (await request()).json();
  expect(body.result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalled();
  expect((store.docs.get(CACHE) as { snapshot?: { fetchedAt?: string } } | undefined)?.snapshot?.fetchedAt)
    .not.toBe('2026-01-01T00:00:00.000Z');
});

it('does not serve another linked TronClass session\'s cached courses after reconnect', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  expect(store.docs.get(CACHE)?.sessionId).toBe(LMS_ID);

  const nextId = 'c'.repeat(32);
  Object.assign(store.docs.get(PORTAL)!, { tronClassSessionId: nextId });
  store.docs.set(`_puTronClassSessions/${nextId}`, {
    ownerUid: UID, cookies: { session: 'new-lms-session' }, userId: 11,
    expiresAt: new Date(Date.now() + 60_000),
  });
  vi.mocked(source.fetchCourses).mockClear();
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).result.cache.hit).toBe(false);
  expect(source.fetchCourses).toHaveBeenCalledWith(
    { session: 'new-lms-session' }, { userId: 11, status: 'ongoing' },
  );
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  expect(store.docs.get(CACHE)?.sessionId).toBe(nextId);
});

it('refetches a legacy cache missing sessionId', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const cached = store.docs.get(CACHE)!;
  delete cached.sessionId;
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const body = await (await request()).json();
  expect(body.result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  expect(store.docs.get(CACHE)?.sessionId).toBeDefined();
});

it.each([{}, { courseId: 19999 }, { courseId: 10001 }])(
  'refetches a versionless cache and stamps only fresh results (%j)',
  async (data) => {
    const { request, source, store } = setup();
    await request({ courseId: 10001 });
    delete store.docs.get(CACHE)!.sessionVersion;
    for (const method of Object.values(source)) vi.mocked(method).mockClear();

    const response = await request(data);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.cache.hit).toBe(false);
    expect(source.fetchCourses).toHaveBeenCalledTimes(2);
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
    expect(store.docs.get(CACHE)?.sessionVersion).toBeDefined();
    if (data.courseId === 10001) {
      expect(body.result.materials).toHaveLength(1);
      expect(source.fetchActivities).toHaveBeenCalledTimes(2);
    } else {
      expect(body.result.materials).toEqual([]);
      expect(body.result.announcements).toEqual([]);
    }
  },
);

it('preserves a fresh versionless document without serving it when refetch fails', async () => {
  const { request, source, store } = setup();
  await request({ courseId: 10001 });
  delete store.docs.get(CACHE)!.sessionVersion;
  const before = structuredClone(store.docs.get(CACHE));
  vi.mocked(source.fetchCourses).mockRejectedValue(new Error('upstream unavailable'));

  const response = await request({ courseId: 10001 });
  expect(response.status).toBe(503);
  expect((await response.json()).result).toBeUndefined();
  expect(store.docs.get(CACHE)).toEqual(before);
});

it.each([{}, { courseId: 10001 }, { refresh: true }])(
  'preserves an expired legacy document without serving it when refetch fails (%j)',
  async (data) => {
    const { request, source, store } = setup();
    expect((await request({ courseId: 10001 })).status).toBe(200);
    delete store.docs.get(CACHE)!.sessionVersion;
    store.docs.get(CACHE)!.expiresAt = new Date(0);
    const before = structuredClone(store.docs.get(CACHE));
    vi.mocked(source.fetchCourses).mockClear().mockRejectedValue(new Error('upstream unavailable'));
    vi.mocked(source.fetchHomeworkPage).mockClear();
    vi.mocked(source.fetchActivities).mockClear();

    const response = await request(data);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.status).toBe('UNAVAILABLE');
    expect(body.result).toBeUndefined();
    expect(source.fetchCourses).toHaveBeenCalled();
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(store.docs.get(CACHE)).toEqual(before);
  },
);

it.each(['homework', 'contents'] as const)(
  'preserves all legacy data when the %s read fails after listing courses',
  async (area) => {
    const { request, source, store } = setup();
    expect((await request({ courseId: 10001 })).status).toBe(200);
    delete store.docs.get(CACHE)!.sessionVersion;
    store.docs.get(CACHE)!.expiresAt = new Date(0);
    const before = structuredClone(store.docs.get(CACHE));
    if (area === 'homework') {
      vi.mocked(source.fetchHomeworkPage).mockRejectedValue(new Error('upstream unavailable'));
    } else {
      vi.mocked(source.fetchCourseAnnouncements).mockRejectedValue(new Error('upstream unavailable'));
    }

    const response = await request({ courseId: 10001 });
    expect(response.status).toBe(503);
    expect((await response.json()).result).toBeUndefined();
    expect(store.docs.get(CACHE)).toEqual(before);
  },
);

it.each(
  ['legacy expired', 'legacy refresh', 'versioned refresh'].flatMap((cacheState) =>
    ['homework', 'activities', 'courseware', 'announcements', 'upcoming'].map((area) => ({ cacheState, area }))),
)('preserves the complete stored document on returned source failure ($cacheState, $area)', async ({ cacheState, area }) => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const cached = store.docs.get(CACHE)!;
  if (cacheState.startsWith('legacy')) delete cached.sessionVersion;
  if (cacheState.endsWith('expired')) cached.expiresAt = new Date(0);
  // Distinguish stored data from fresh source data to catch an invalid fallback.
  const snapshot = cached.snapshot as LmsReadonlySnapshot;
  snapshot.homework[0].title = '舊快取作業';
  const extras = cached.extras as Record<string, { materials: { title: string }[]; announcements: { title: string }[] }>;
  extras['10001'].materials[0].title = '舊快取教材';
  extras['10001'].announcements[0].title = '舊快取公告';
  const before = structuredClone(cached);
  const write = vi.spyOn(store.db, 'runTransaction');
  if (area === 'homework') {
    vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });
  } else if (area === 'announcements') {
    vi.mocked(source.fetchCourseAnnouncements).mockResolvedValueOnce({ ok: false, status: 503 });
  } else if (area === 'upcoming') {
    vi.mocked(source.fetchCourses).mockResolvedValueOnce([LMS_FIXTURE_COURSE])
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }));
  } else {
    if (area === 'courseware') {
      vi.mocked(source.fetchActivities).mockResolvedValueOnce({ ok: true, value: [LMS_FIXTURE_MATERIAL] });
    }
    vi.mocked(source.fetchActivities).mockResolvedValueOnce({ ok: false, status: 503 });
  }

  const response = await request({ courseId: 10001, refresh: cacheState.endsWith('refresh') });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.cache.hit).toBe(false);
  if (area === 'upcoming') expect(body.result.upcomingCoursesError).not.toBeNull();
  else expect(body.result.courseErrors.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain('舊快取');
  expect(store.docs.get(CACHE)).toEqual(before);
  expect(write).toHaveBeenCalled();
  expect(store.docs.get(RETRY)).toMatchObject({ ownerUid: UID, sessionId: LMS_ID });
  const calls = Object.values(source).map((method) => vi.mocked(method).mock.calls.length);
  const immediate = await (await request({ courseId: 10001 })).json();
  expect(immediate.result.cache.hit).toBe(true);
  expect(immediate.result.courseErrors).toEqual(body.result.courseErrors);
  expect(immediate.result.upcomingCoursesError).toEqual(body.result.upcomingCoursesError);
  expect(JSON.stringify(immediate)).not.toContain('舊快取');
  expect(Object.values(source).map((method) => vi.mocked(method).mock.calls.length)).toEqual(calls);
  expect(store.docs.get(CACHE)).toEqual(before);

  // The next complete refresh may safely replace the document and stamp its version.
  const recovered = await (await request({ courseId: 10001, refresh: true })).json();
  expect(recovered.result.courseErrors).toEqual([]);
  expect(recovered.result.upcomingCoursesError).toBeNull();
  expect(store.docs.get(CACHE)?.sessionVersion).toBeDefined();
  expect(store.docs.get(CACHE)).not.toEqual(before);
  const afterRecovery = await (await request({ courseId: 10001 })).json();
  expect(afterRecovery.result.courseErrors).toEqual([]);
  expect(afterRecovery.result.upcomingCoursesError).toBeNull();
});

it.each(['homework', 'upcoming', 'materials'] as const)(
  'backs off existing-cache %s failures for one minute and retries after expiry',
  async (area) => {
    const { request, source, store } = setup();
    await request();
    if (area !== 'materials') store.docs.get(CACHE)!.expiresAt = new Date(0);
    const before = structuredClone(store.docs.get(CACHE));
    if (area === 'homework') {
      vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });
    } else if (area === 'upcoming') {
      vi.mocked(source.fetchCourses).mockResolvedValueOnce([LMS_FIXTURE_COURSE])
        .mockRejectedValueOnce(new Error('upcoming unavailable'));
    } else {
      vi.mocked(source.fetchActivities).mockResolvedValueOnce({ ok: false, status: 503 });
    }

    const first = await (await request({ courseId: 10001 })).json();
    expect(first.result.cache.hit).toBe(false);
    const retry = store.docs.get(RETRY)!;
    const remaining = (retry.expiresAt as Date).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(58_000);
    expect(remaining).toBeLessThanOrEqual(60_000);
    expect(store.docs.get(CACHE)).toEqual(before);
    const calls = Object.values(source).map((method) => vi.mocked(method).mock.calls.length);

    const immediate = await (await request({ courseId: 10001 })).json();
    expect(immediate.result.cache.hit).toBe(true);
    expect(immediate.result.courseErrors).toEqual(first.result.courseErrors);
    expect(Object.values(source).map((method) => vi.mocked(method).mock.calls.length)).toEqual(calls);

    // The separate deadline controls retrying even if its contents have longer TTLs.
    retry.expiresAt = new Date(0);
    const recovered = await (await request({ courseId: 10001 })).json();
    expect(recovered.result.cache.hit).toBe(false);
    expect(recovered.result.homework).toHaveLength(2);
    expect(recovered.result.materials).toHaveLength(1);
    expect(recovered.result.courseErrors).toEqual([]);
    expect(recovered.result.upcomingCoursesError).toBeNull();
    expect(store.docs.get(CACHE)).not.toEqual(before);
    if (area === 'materials') {
      expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
    } else {
      expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(3);
    }
  },
);

it('does not overwrite a concurrent successful refresh with a retry result', async () => {
  const { request, source, store } = setup();
  await request();
  store.docs.get(CACHE)!.expiresAt = new Date(0);
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });
  const runTransaction = store.db.runTransaction.bind(store.db);
  let winner: unknown;
  vi.spyOn(store.db, 'runTransaction').mockImplementationOnce(async (callback) => {
    expect((await request({ refresh: true })).status).toBe(200);
    winner = structuredClone(store.docs.get(CACHE));
    return runTransaction(callback);
  });

  const body = await (await request()).json();
  expect(body.result.courseErrors).toHaveLength(1);
  expect(store.docs.get(CACHE)).toEqual(winner);
  expect(store.docs.has(RETRY)).toBe(false);
  const next = await (await request()).json();
  expect(next.result.cache.hit).toBe(true);
  expect(next.result.courseErrors).toEqual([]);
});

it('preserves both cache documents if saving a retry fails', async () => {
  const { request, source, store } = setup();
  await request();
  store.docs.get(CACHE)!.expiresAt = new Date(0);
  const before = structuredClone(store.docs.get(CACHE));
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });
  store.failNextCommit();

  const body = await (await request()).json();
  expect(body.result.courseErrors).toHaveLength(1);
  expect(store.docs.get(CACHE)).toEqual(before);
  expect(store.docs.has(RETRY)).toBe(false);
  const next = await (await request()).json();
  expect(next.result.cache.hit).toBe(false);
  expect(next.result.courseErrors).toEqual([]);
});

it('preserves another owner document occupying the retry path', async () => {
  const { request, source, store } = setup();
  await request();
  store.docs.get(CACHE)!.expiresAt = new Date(0);
  const otherCache = { ownerUid: `${UID}__retry`, snapshot: { homework: [] } };
  await store.db.doc(RETRY).set(otherCache);
  const before = structuredClone(store.docs.get(CACHE));
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });

  const body = await (await request()).json();
  expect(body.result.courseErrors).toHaveLength(1);
  expect(store.docs.get(CACHE)).toEqual(before);
  expect(store.docs.get(RETRY)).toEqual(otherCache);
});

it.each([
  { cookies: { session: 'new-cookie' }, userId: 10 },
  { cookies: { session: 'lms-secret' }, userId: 11 },
])('does not reuse retry results after in-place session rotation (%j)', async (session) => {
  const { request, source, store } = setup();
  await request();
  store.docs.get(CACHE)!.expiresAt = new Date(0);
  vi.mocked(source.fetchHomeworkPage).mockResolvedValueOnce({ ok: false, status: 503 });
  await request({ courseId: 10001 });
  expect(store.docs.has(RETRY)).toBe(true);
  await store.db.doc(LMS).set(session, { merge: true });
  vi.mocked(source.fetchCourses).mockClear().mockResolvedValue([{ id: 10002, name: '新課程' }]);

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.cache.hit).toBe(false);
  expect(body.result.courses).toEqual([{ id: 10002, name: '新課程' }]);
  expect(body.result.materials).toEqual([]);
  expect(body.result.announcements).toEqual([]);
  expect(body.result.courseErrors).toEqual([]);
  expect(source.fetchCourses).toHaveBeenCalledWith(session.cookies, { userId: session.userId, status: 'ongoing' });
});

it.each([
  { cookies: { session: 'new-cookie' }, userId: 10 },
  { cookies: { session: 'lms-secret' }, userId: 11 },
])('refetches versionless legacy homework and extras without refresh after an in-place rotation (%j)', async (session) => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  delete store.docs.get(CACHE)!.sessionVersion;
  const before = structuredClone(store.docs.get(CACHE));
  await store.db.doc(LMS).set(session, { merge: true });
  vi.mocked(source.fetchCourses).mockRejectedValue(new Error('upstream unavailable'));

  const failed = await (await request({ courseId: 10001 })).json();
  expect(failed.result).toBeUndefined();
  expect(failed.error.status).toBe('UNAVAILABLE');
  expect(store.docs.get(CACHE)).toEqual(before);

  vi.mocked(source.fetchCourses).mockClear().mockResolvedValue([{ id: 10002, name: '新課程' }]);
  vi.mocked(source.fetchHomeworkPage).mockResolvedValue({
    ok: true, value: { homework_activities: [], total: 0 },
  });
  vi.mocked(source.fetchActivities).mockClear();
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.cache.hit).toBe(false);
  expect(source.fetchCourses).toHaveBeenCalledWith(session.cookies, { userId: session.userId, status: 'ongoing' });
  expect(body.result.courses).toEqual([{ id: 10002, name: '新課程' }]);
  expect(body.result.homework).toEqual([]);
  expect(body.result.materials).toEqual([]);
  expect(body.result.announcements).toEqual([]);
  expect(body.result.contentsLoadedFor).toEqual([]);
  expect(source.fetchActivities).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)?.sessionVersion).toBeDefined();
});

it.each([
  { scenario: 'missing nested cache', corrupted: undefined },
  { scenario: 'non-object nested cache', corrupted: 'broken' },
  { scenario: 'missing nested expiry', corrupted: { hit: false } },
  { scenario: 'unparseable nested expiry', corrupted: { hit: false, expiresAt: 'invalid' } },
  { scenario: 'expired nested cache', corrupted: { hit: false, expiresAt: '2000-01-01T00:00:00.000Z' } },
  { scenario: 'invalid cache hit flag', corrupted: { hit: 'false', expiresAt: '2099-01-01T00:00:00.000Z' } },
])('refetches instead of failing when $scenario is stored', async ({ corrupted }) => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const existing = store.docs.get(CACHE)!;
  (existing.snapshot as Record<string, unknown>).cache = corrupted;
  vi.mocked(source.fetchCourses).mockClear();
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const response = await request();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.cache.hit).toBe(false);
  expect(body.result.homework).toHaveLength(2);
  expect(source.fetchCourses).toHaveBeenCalledTimes(2);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  expect((store.docs.get(CACHE)!.snapshot as { cache: { expiresAt: string } }).cache.expiresAt)
    .toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/);
});

it.each([
  { cookies: { session: 'new-cookie' }, userId: 10 },
  { cookies: { session: 'lms-secret' }, userId: 11 },
])('discards homework and course extras after an in-place LMS rotation to %j', async (session) => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const oldVersion = store.docs.get(CACHE)?.sessionVersion;
  await store.db.doc(LMS).set(session, { merge: true });
  vi.mocked(source.fetchCourses).mockClear().mockResolvedValue([{ id: 10002, name: '新課程' }]);

  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.cache.hit).toBe(false);
  expect(source.fetchCourses).toHaveBeenCalledWith(session.cookies, { userId: session.userId, status: 'ongoing' });
  expect(body.result.courses).toEqual([{ id: 10002, name: '新課程' }]);
  expect(body.result.contentsLoadedFor).toEqual([]);
  expect(body.result.materials).toEqual([]);
  expect(store.docs.get(CACHE)?.sessionVersion).toBeDefined();
  expect(store.docs.get(CACHE)?.sessionVersion).not.toEqual(oldVersion);
});

it('does not expose an otherwise fresh cache when its LMS session changes owner', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  Object.assign(store.docs.get(LMS)!, { ownerUid: 'another-owner' });
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const response = await request();
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
});

it('rejects an in-flight course read when its linked session changes before completion', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  let release!: () => void;
  vi.mocked(source.fetchActivities).mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve({ ok: true, value: [LMS_FIXTURE_MATERIAL] });
  }));
  const pending = request({ courseId: 10001 });
  await vi.waitFor(() => expect(source.fetchActivities).toHaveBeenCalledTimes(2));

  const nextId = 'd'.repeat(32);
  Object.assign(store.docs.get(PORTAL)!, { tronClassSessionId: nextId });
  store.docs.set(`_puTronClassSessions/${nextId}`, {
    ownerUid: UID, cookies: { session: 'new-lms-session' }, userId: 11,
    expiresAt: new Date(Date.now() + 60_000),
  });
  release();
  const response = await pending;
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(store.docs.get(CACHE)?.sessionId).toBe(LMS_ID);
  expect(store.docs.get(CACHE)?.extras).toEqual({});
});

it('rejects an in-flight read when a newer portal takes precedence over the still-valid original', async () => {
  const { request, source, store } = setup();
  const originalPortal = structuredClone(store.docs.get(PORTAL));
  const newId = 'c'.repeat(32);
  const laterExpiry = new Date(Date.now() + 120_000);
  vi.mocked(source.fetchCourses).mockImplementationOnce(async () => {
    await store.db.doc(`_puTronClassSessions/${newId}`).set({
      ownerUid: UID, userId: 11, cookies: { session: 'new-cookie' }, expiresAt: laterExpiry,
    });
    await store.db.doc('_puSessions/new-login').set({
      ownerUid: UID, tronClassSessionId: newId, expiresAt: laterExpiry,
    });
    return [LMS_FIXTURE_COURSE];
  });

  const response = await request();
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(store.docs.has(CACHE)).toBe(false);
  expect(store.docs.get(PORTAL)).toEqual(originalPortal);
});

it.each([
  { scenario: 'homework-list cache hit', data: {} },
  { scenario: 'course-contents cache hit', data: { courseId: 10001 } },
  { scenario: 'cached list with an unknown course', data: { courseId: 99999 } },
])('does not return $scenario after the linked session changes during cache lookup', async ({ data }) => {
  const { request, source, store } = setup();
  expect((await request(data)).status).toBe(200);
  expect(store.docs.get(CACHE)?.sessionId).toBe(LMS_ID);

  // Simulate a legitimate reconnect after the initial session check, while
  // Firestore is returning the already saved cache. No school HTTP call occurs.
  const originalDoc = store.db.doc.bind(store.db);
  let switched = false;
  vi.spyOn(store.db, 'doc').mockImplementation((path) => {
    const ref = originalDoc(path);
    if (path !== CACHE) return ref;
    return {
      ...ref,
      get: async () => {
        const snapshot = await ref.get();
        switched = true;
        Object.assign(store.docs.get(PORTAL)!, { tronClassSessionId: 'c'.repeat(32) });
        return snapshot;
      },
    };
  });
  vi.mocked(source.fetchCourses).mockClear();
  vi.mocked(source.fetchHomeworkPage).mockClear();
  vi.mocked(source.fetchActivities).mockClear();
  vi.mocked(source.fetchCourseAnnouncements).mockClear();
  vi.mocked(source.fetchSiteAnnouncements).mockClear();

  const response = await request(data);
  expect(switched).toBe(true);
  expect(response.ok).toBe(false);
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(source.fetchCourses).not.toHaveBeenCalled();
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(source.fetchActivities).not.toHaveBeenCalled();
  expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
  expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)?.sessionId).toBe(LMS_ID);
});

it.each([
  'expired extras and reconnect',
  'invalid extras and reconnect',
  'deleted LMS session',
  'expired portal',
])('rejects a cache hit with %s during cache lookup without writing or calling school sources', async (scenario) => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const cached = store.docs.get(CACHE)!;
  if (scenario === 'expired extras and reconnect') {
    Object.assign((cached.extras as Record<string, object>)['10001'], { expiresAt: new Date(0).toISOString() });
  } else if (scenario === 'invalid extras and reconnect') {
    cached.extras = { '10001': { invalid: true } };
  }
  const cacheBefore = structuredClone(cached);
  const cacheTransaction = vi.spyOn(store.db, 'runTransaction');
  const originalDoc = store.db.doc.bind(store.db);
  let changed = false;
  vi.spyOn(store.db, 'doc').mockImplementation((path) => {
    const ref = originalDoc(path);
    if (path !== CACHE) return ref;
    return {
      ...ref,
      get: async () => {
        const snapshot = await ref.get();
        changed = true;
        if (scenario === 'deleted LMS session') {
          store.docs.delete(LMS);
        } else if (scenario === 'expired portal') {
          Object.assign(store.docs.get(PORTAL)!, { expiresAt: new Date(0) });
        } else {
          Object.assign(store.docs.get(PORTAL)!, { tronClassSessionId: 'c'.repeat(32) });
        }
        return snapshot;
      },
    };
  });
  for (const method of Object.values(source)) vi.mocked(method).mockClear();

  const response = await request();
  expect(changed).toBe(true);
  expect(response.ok).toBe(false);
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(cacheTransaction).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)).toEqual(cacheBefore);
  for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
});

it.each([
  'expired cached snapshot',
  'cache bound to an older session',
])('does not delete %s after a reconnect during the cache read', async (scenario) => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const existing = store.docs.get(CACHE)!;
  if (scenario === 'expired cached snapshot') {
    existing.expiresAt = new Date(0);
  } else {
    existing.sessionId = 'a'.repeat(32);
  }
  const cacheBefore = structuredClone(existing);
  const originalDoc = store.db.doc.bind(store.db);
  const deleteCache = vi.fn();
  let relinked = false;
  vi.spyOn(store.db, 'doc').mockImplementation((path) => {
    const ref = originalDoc(path);
    if (path !== CACHE) return ref;
    return {
      ...ref,
      delete: deleteCache,
      get: async () => {
        const snapshot = await ref.get();
        // The old request must not remove this cache after the user relinks.
        Object.assign(store.docs.get(PORTAL)!, { tronClassSessionId: 'c'.repeat(32) });
        relinked = true;
        return snapshot;
      },
    };
  });
  for (const method of Object.values(source)) vi.mocked(method).mockClear();

  const response = await request();
  expect(relinked).toBe(true);
  expect(response.ok).toBe(false);
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(deleteCache).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)).toEqual(cacheBefore);
  for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
});

it.each(
  [false, true].flatMap((legacy) =>
    ['rotated cookies', 'changed TronClass user ID', 'changed session version'].map((scenario) => ({ legacy, scenario }))),
)('rejects a cache hit after $scenario during lookup (legacy: $legacy)', async ({ legacy, scenario }) => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  if (legacy) delete store.docs.get(CACHE)!.sessionVersion;
  const cacheBefore = structuredClone(store.docs.get(CACHE));
  const originalDoc = store.db.doc.bind(store.db);
  const cacheTransaction = vi.spyOn(store.db, 'runTransaction');
  const cacheDelete = vi.fn();
  vi.spyOn(store.db, 'doc').mockImplementation((path) => {
    const ref = originalDoc(path);
    if (path !== CACHE) return ref;
    return {
      ...ref,
      delete: cacheDelete,
      get: async () => {
        const snapshot = await ref.get();
        if (scenario === 'rotated cookies') {
          Object.assign(store.docs.get(LMS)!, { cookies: { session: 'rotated-lms-session' } });
        } else if (scenario === 'changed TronClass user ID') {
          Object.assign(store.docs.get(LMS)!, { userId: 11 });
        } else {
          await store.db.doc(LMS).set({ refreshedAt: new Date() }, { merge: true });
        }
        return snapshot;
      },
    };
  });
  for (const method of Object.values(source)) vi.mocked(method).mockClear();

  const response = await request();
  expect(response.ok).toBe(false);
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(cacheTransaction).not.toHaveBeenCalled();
  expect(cacheDelete).not.toHaveBeenCalled();
  expect(store.docs.get(CACHE)).toEqual(cacheBefore);
  for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
});

it.each([
  'rotated cookies',
  'changed TronClass user ID',
])('rejects a cold fetch when %s during the school read', async (scenario) => {
  const { request, source, store } = setup();
  vi.mocked(source.fetchCourses).mockImplementationOnce(async () => {
    if (scenario === 'rotated cookies') {
      Object.assign(store.docs.get(LMS)!, { cookies: { session: 'rotated-lms-session' } });
    } else {
      Object.assign(store.docs.get(LMS)!, { userId: 11 });
    }
    return [LMS_FIXTURE_COURSE];
  });

  const response = await request();
  expect(response.ok).toBe(false);
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(store.docs.has(CACHE)).toBe(false);
});

it('preserves a stale cache when its safe replacement cannot be fetched', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const cached = store.docs.get(CACHE)!;
  cached.expiresAt = new Date(0);
  const cacheBefore = structuredClone(cached);
  vi.mocked(source.fetchCourses).mockRejectedValueOnce(new Error('upstream unavailable'));

  const response = await request();
  expect(response.ok).toBe(false);
  expect((await response.json()).error.status).toBe('UNAVAILABLE');
  // No unconditional delete: another request may have replaced this document
  // after we observed the stale snapshot. It is never returned to the caller.
  expect(store.docs.get(CACHE)).toEqual(cacheBefore);
});

it.each([
  { path: PORTAL, change: { tronClassSessionId: 'c'.repeat(32) }, status: 'FAILED_PRECONDITION' },
  { path: LMS, change: { ownerUid: 'another-owner' }, status: 'FAILED_PRECONDITION' },
  { path: `users/${UID}`, change: { accountDeletionInProgress: true }, status: 'PERMISSION_DENIED' },
  { path: `schools/pu/members/${UID}`, change: { status: 'inactive' }, status: 'PERMISSION_DENIED' },
])('rejects access revoked at $path just before the cache transaction', async ({ path, change, status }) => {
  const { request, store } = setup();
  const runTransaction = store.db.runTransaction.bind(store.db);
  vi.spyOn(store.db, 'runTransaction').mockImplementationOnce(async (callback) => {
    await store.db.doc(path).set(change, { merge: true });
    return runTransaction(callback);
  });

  const response = await request();
  expect((await response.json()).error.status).toBe(status);
  expect(store.docs.has(CACHE)).toBe(false);
});

it('returns fresh homework after a cache commit fails and retries on the next read', async () => {
  const { request, source, store } = setup();
  store.failNextCommit();
  const first = await (await request()).json();
  expect(first.result.cache.hit).toBe(false);
  expect(first.result.homework).toHaveLength(2);
  expect(store.docs.has(CACHE)).toBe(false);

  const retry = await (await request()).json();
  expect(retry.result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(2);
  expect(store.docs.get(CACHE)?.sessionId).toBe(LMS_ID);
});

it('preserves course contents cached by a faster request for the same session', async () => {
  const { request, source, store } = setup();
  let release!: () => void;
  vi.mocked(source.fetchCourses).mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve([LMS_FIXTURE_COURSE]);
  }));
  const pending = request();
  await vi.waitFor(() => expect(source.fetchCourses).toHaveBeenCalledTimes(1));
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const winner = structuredClone(store.docs.get(CACHE));
  release();

  expect((await pending).status).toBe(200);
  expect(store.docs.get(CACHE)).toEqual(winner);
  vi.mocked(source.fetchActivities).mockClear();
  const body = await (await request({ courseId: 10001 })).json();
  expect(body.result.cache.hit).toBe(true);
  expect(body.result.materials).toHaveLength(1);
  expect(source.fetchActivities).not.toHaveBeenCalled();
});

it('drops cached contents for courses absent from the linked session course list', async () => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const extras = store.docs.get(CACHE)!.extras as Record<string, {
    materials: LmsReadonlySnapshot['materials'];
    announcements: LmsReadonlySnapshot['announcements'];
    errors: LmsReadonlySnapshot['courseErrors'];
    fetchedAt: string;
    expiresAt: string;
  }>;
  extras['10002'] = {
    ...structuredClone(extras['10001']),
    materials: [{
      ...extras['10001'].materials[0],
      courseId: 10002,
      title: '不屬於目前課程的教材',
    }],
    announcements: [],
  };
  for (const method of Object.values(source)) vi.mocked(method).mockClear();

  const response = await request();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.cache.hit).toBe(true);
  expect(body.result.contentsLoadedFor).toEqual([10001]);
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.materials).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ title: '不屬於目前課程的教材' }),
  ]));
  expect(store.docs.get(CACHE)!.extras).toHaveProperty('10001');
  expect(store.docs.get(CACHE)!.extras).not.toHaveProperty('10002');
  for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
});

it('does not prune course contents refreshed after the initial cache read', async () => {
  const { request, source, store } = setup();
  expect((await request({ courseId: 10001 })).status).toBe(200);
  const fresh = structuredClone(store.docs.get(CACHE)!);
  const extras = store.docs.get(CACHE)!.extras as Record<string, { expiresAt: string }>;
  extras['10001'].expiresAt = new Date(0).toISOString();
  const runTransaction = store.db.runTransaction.bind(store.db);
  const transaction = vi.spyOn(store.db, 'runTransaction').mockImplementationOnce(async (callback) => {
    await store.db.doc(CACHE).set(fresh);
    return runTransaction(callback);
  });
  for (const method of Object.values(source)) vi.mocked(method).mockClear();

  expect((await request()).status).toBe(200);
  expect(transaction).toHaveBeenCalled();
  expect(store.docs.get(CACHE)).toEqual(fresh);
  for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
});

it.each(['cold fetch', 'extras cleanup'])('rejects %s if the portal relinks after commit', async (scenario) => {
  const { request, source, store } = setup();
  if (scenario === 'extras cleanup') {
    expect((await request({ courseId: 10001 })).status).toBe(200);
    const extras = store.docs.get(CACHE)!.extras as Record<string, { expiresAt: string }>;
    extras['10001'].expiresAt = new Date(0).toISOString();
    for (const method of Object.values(source)) vi.mocked(method).mockClear();
  }
  const runTransaction = store.db.runTransaction.bind(store.db);
  vi.spyOn(store.db, 'runTransaction').mockImplementationOnce(async (callback) => {
    const result = await runTransaction(callback);
    await store.db.doc(PORTAL).set({ tronClassSessionId: 'c'.repeat(32) }, { merge: true });
    return result;
  });

  const response = await request();
  const body = await response.json();
  expect(body.error.status).toBe('FAILED_PRECONDITION');
  expect(body.result).toBeUndefined();
  expect(store.docs.get(CACHE)?.extras).toEqual({});
  if (scenario === 'extras cleanup') {
    for (const method of Object.values(source)) expect(method).not.toHaveBeenCalled();
  }
});

it('makes no LMS calls when the read-only feature flag is disabled', async () => {
  const { request, source, store } = setup();
  const doc = vi.spyOn(store.db, 'doc');
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', 'false');
  const response = await request({ courseId: 10001 });
  expect(response.status).toBe(404);
  expect(doc).not.toHaveBeenCalled();
  expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
  expect(source.fetchCourses).not.toHaveBeenCalled();
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(source.fetchActivities).not.toHaveBeenCalled();
  expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
});

it.each([{ refresh: 'yes' }, { sessionId: LMS_ID }, { status: 'ongoing' }, { courseId: '10001' }, []])('rejects malformed bodies %j', async (data) => {
  const { request, source } = setup();
  expect((await request(data)).status).toBe(400);
  expect(source.fetchCourses).not.toHaveBeenCalled();
});
