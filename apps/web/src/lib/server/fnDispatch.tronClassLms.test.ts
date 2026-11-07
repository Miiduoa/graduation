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

it('loads one activities request when opening a course and does not download locked files', async () => {
  const { request, source } = setup();
  await request();
  vi.mocked(source.fetchHomeworkPage).mockClear();
  vi.mocked(source.fetchCourses).mockClear();
  const body = await (await request({ courseId: 10001 })).json();
  expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  expect(source.fetchCourses).not.toHaveBeenCalled();
  expect(source.fetchActivities).toHaveBeenCalledTimes(1);
  expect(source.fetchActivities).toHaveBeenCalledWith({ session: 'lms-secret' }, 10001, '');
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
  expect(source.fetchActivities).toHaveBeenCalledTimes(1);
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
  expect(source.fetchActivities).toHaveBeenCalledTimes(1);
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

it.each(['sessionId', 'sessionVersion'])('refetches a legacy cache missing %s', async (field) => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const cached = store.docs.get(CACHE)!;
  delete cached[field];
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const body = await (await request()).json();
  expect(body.result.cache.hit).toBe(false);
  expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  expect(store.docs.get(CACHE)?.[field]).toBeDefined();
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

it('uses one validated snapshot when its nested TTL expires during cache handling', async () => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
  const expiresAt = Date.now() + 1_000;
  const nestedExpiresAt = new Date(expiresAt).toISOString();
  const snapshot = store.docs.get(CACHE)!.snapshot as { cache: { expiresAt: string } };
  snapshot.cache.expiresAt = nestedExpiresAt;
  vi.mocked(source.fetchCourses).mockClear();
  vi.mocked(source.fetchHomeworkPage).mockClear();

  const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAt - 1);
  const parseDate = Date.parse;
  const parse = vi.spyOn(Date, 'parse').mockImplementation((value) => {
    const timestamp = parseDate(value);
    // Cross the deadline after validating the nested TTL, before using the snapshot.
    if (value === nestedExpiresAt) clock.mockReturnValue(expiresAt);
    return timestamp;
  });
  try {
    const cachedResponse = await request();
    expect(cachedResponse.status).toBe(200);
    const cachedBody = await cachedResponse.json();
    expect(cachedBody.result.cache.hit).toBe(true);
    expect(cachedBody.result.homework).toHaveLength(2);
    expect(Date.now()).toBe(expiresAt);
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();

    const refreshedResponse = await request();
    expect(refreshedResponse.status).toBe(200);
    expect((await refreshedResponse.json()).result.cache.hit).toBe(false);
    expect(source.fetchCourses).toHaveBeenCalledTimes(2);
    expect(source.fetchHomeworkPage).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore();
    clock.mockRestore();
  }
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
  await vi.waitFor(() => expect(source.fetchActivities).toHaveBeenCalledTimes(1));

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

it.each([
  'rotated cookies',
  'changed TronClass user ID',
])('rejects a cache hit after %s in the same session document', async (scenario) => {
  const { request, source, store } = setup();
  expect((await request()).status).toBe(200);
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
        } else {
          Object.assign(store.docs.get(LMS)!, { userId: 11 });
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
  ...['deleted', 'disabled', 'suspended', 'inactive'].map((accountStatus) => ({
    path: `users/${UID}`, change: { status: accountStatus }, status: 'PERMISSION_DENIED',
  })),
  { path: `schools/pu/members/${UID}`, change: { status: 'inactive' }, status: 'PERMISSION_DENIED' },
])('rejects access revoked at $path just before the cache transaction', async ({ path, change, status }) => {
  const { request, store } = setup();
  const runTransaction = store.db.runTransaction.bind(store.db);
  vi.spyOn(store.db, 'runTransaction').mockImplementationOnce(async (callback) => {
    await store.db.doc(path).set(change, { merge: true });
    return runTransaction(callback);
  });

  const response = await request();
  expect(response.ok).toBe(false);
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

it.each(['deleted', 'disabled', 'suspended', 'inactive'])(
  'rejects account status %s before any LMS source or cache write',
  async (status) => {
    const { request, source, store } = setup();
    store.docs.get(`users/${UID}`)!.status = status;

    const response = await request({ courseId: 10001 });
    expect(response.status).toBe(403);
    expect((await response.json()).error.status).toBe('PERMISSION_DENIED');
    expect(source.fetchCourses).not.toHaveBeenCalled();
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
    expect(source.fetchCourseAnnouncements).not.toHaveBeenCalled();
    expect(source.fetchSiteAnnouncements).not.toHaveBeenCalled();
    expect(store.docs.has(CACHE)).toBe(false);
  },
);

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
