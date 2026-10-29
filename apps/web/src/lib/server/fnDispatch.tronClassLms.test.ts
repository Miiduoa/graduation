// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { getCloudFunctionUrl } from '../cloudFunctions';
import { LMS_CACHE_COLLECTION, LMS_SNAPSHOT_TTL_MS } from '@campus/shared/src/puLmsReadonly';
import type { LmsReadonlySource } from './tronClassLmsSource';
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

beforeEach(() => resetUidRateLimitForTests());

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
  expect(source.fetchSiteAnnouncements).toHaveBeenCalledOnce();
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

it('loads one activities request when opening a course and does not download locked files', async () => {
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

it.each([{ refresh: 'yes' }, { sessionId: LMS_ID }, { status: 'ongoing' }, { courseId: '10001' }, []])('rejects malformed bodies %j', async (data) => {
  const { request, source } = setup();
  expect((await request(data)).status).toBe(400);
  expect(source.fetchCourses).not.toHaveBeenCalled();
});


it('imports site announcements once and keeps them in the per-user cache', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchSiteAnnouncements).mockResolvedValue({
    ok: true,
    value: [{ id: 890, title: '全校公告', content: '學校學習平臺通知', created_at: '2026-05-20T02:00:00Z' }],
  });
  const first = await (await request()).json();
  expect(first.result.announcements).toEqual([
    expect.objectContaining({ title: '全校公告', source: 'site', courseId: null }),
  ]);
  const cached = await (await request()).json();
  expect(cached.result.cache.hit).toBe(true);
  expect(cached.result.announcements).toEqual(first.result.announcements);
  expect(source.fetchSiteAnnouncements).toHaveBeenCalledTimes(1);
});

it('does not erase homework when site-wide announcements are unavailable', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchSiteAnnouncements).mockResolvedValue({ ok: false, status: 503 });
  const body = await (await request()).json();
  expect(body.result.homework).toHaveLength(2);
  expect(body.result.siteAnnouncementError).toEqual({ status: 503 });
});


it('enriches a course material from the courseware endpoint without duplicate cards', async () => {
  const { request, source } = setup();
  vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _courseId, query) => {
    if (query === 'type=courseware_activity') {
      return { ok: true, value: [{
        id: 30001, title: '簡樸生活講義', type: 'material',
        uploads: [{ name: 'new.pdf', key: 'new-safe-key', allow_download: true }],
      }] };
    }
    return { ok: true, value: [{
      id: 30001, title: '簡樸生活講義', type: 'material', uploads: [],
    }] };
  });
  const response = await request({ courseId: 10001 });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.materials).toHaveLength(1);
  expect(body.result.materials[0].files).toEqual([
    expect.objectContaining({ name: 'new.pdf', allowDownload: true }),
  ]);
  expect(source.fetchActivities).toHaveBeenCalledTimes(2);
});
