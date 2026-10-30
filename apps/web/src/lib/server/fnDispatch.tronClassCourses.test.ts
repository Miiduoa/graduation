// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { getCloudFunctionUrl } from '../cloudFunctions';

const UID = 'pu-410000001';
const LMS_ID = 'a'.repeat(32);
const LMS = `_puTronClassSessions/${LMS_ID}`;
const PORTAL = '_puSessions/current';

function setup() {
  const expiresAt = new Date(Date.now() + 60_000);
  const store = createMemoryGroupStore([
    [`users/${UID}`, { schoolId: 'pu' }],
    [`schools/pu/members/${UID}`, { status: 'active' }],
    [PORTAL, { ownerUid: UID, cookies: { portal: 'secret' }, expiresAt, tronClassSessionId: LMS_ID }],
    [LMS, { ownerUid: UID, cookies: { session: 'lms-secret' }, userId: 10, expiresAt }],
  ]);
  const fetchCourses = vi.fn().mockResolvedValue([{
    id: 42, name: '資料庫', course_code: 'IM101', teachers: [{ name: '林老師', email: 'unused@example.test' }],
    status: 'ongoing', semester: '1151', cookies: 'must-not-leak', cover_image_url: 'javascript:alert(1)',
  }]);
  const verifyIdToken = vi.fn().mockResolvedValue({ uid: UID, schoolId: 'pu' });
  const runtime: FnRuntime = {
    db: store.db as unknown as FnRuntime['db'], verifyIdToken, lmsCoursesFetcher: fetchCourses,
  };
  const request = (data: unknown = { status: 'ongoing' }, authorized = true) => dispatchFnRequest(
    'getMyTronClassCourses', new Request('https://nuni.tw/api/fn/getMyTronClassCourses', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer id-token' } : {}) },
      body: JSON.stringify({ data }),
    }), runtime,
  );
  return { request, store, fetchCourses, verifyIdToken };
}

beforeEach(() => resetUidRateLimitForTests());

it('hosts LMS course reads alongside the school login', () => {
  expect(getCloudFunctionUrl('getMyTronClassCourses', { env: {} })).toBe('/api/fn/getMyTronClassCourses');
});

it('returns only the linked owner courses with trusted links and source metadata', async () => {
  const { request, fetchCourses, verifyIdToken } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect(verifyIdToken).toHaveBeenCalledWith('id-token', true);
  expect(fetchCourses).toHaveBeenCalledWith({ session: 'lms-secret' }, { userId: 10, status: 'ongoing' });
  const body = await response.json();
  expect(body.result).toMatchObject({ ownerUid: UID, schoolId: 'pu', source: 'pu-tronclass',
    courses: [{ id: 42, name: '資料庫', code: 'IM101', teachers: ['林老師'], href: 'https://tronclass.pu.edu.tw/course/42/content' }] });
  expect(JSON.stringify(body)).not.toMatch(/secret|cookies|unused@example|javascript/);
});

it.each(['ongoing', 'completed', 'upcoming'])('passes only the validated course status %s', async (status) => {
  const { request, fetchCourses } = setup();
  expect((await request({ status })).status).toBe(200);
  expect(fetchCourses.mock.calls[0][1].status).toBe(status);
});

it.each([
  [{ id: 12, code: '1151', name: '115 學年度第 1 學期' }, '115 學年度第 1 學期'],
  [{ code: '1151' }, '1151'],
  ['1151', '1151'],
  [null, null],
] as const)('preserves the school semester label from %j', async (semester, expected) => {
  const { request, fetchCourses } = setup();
  fetchCourses.mockResolvedValueOnce([{ id: 42, name: '資料庫', semester }]);
  const response = await request();
  expect((await response.json()).result.courses[0].semester).toBe(expected);
});

it.each([{ status: ['ongoing'] }, { status: null }, { status: 'all' }, { userId: 99 },
  { sessionId: LMS_ID }, { status: 'ongoing', schoolId: 'other' }, [], null])('rejects malformed or owner-selected requests %j', async (data) => {
  const { request, fetchCourses } = setup();
  expect((await request(data)).status).toBe(400);
  expect(fetchCourses).not.toHaveBeenCalled();
});

it('does not read when the token or school membership is missing', async () => {
  const { request, store, fetchCourses, verifyIdToken } = setup();
  expect((await request({}, false)).status).toBe(401);
  verifyIdToken.mockResolvedValueOnce({ uid: UID, schoolId: 'other' });
  expect((await request()).status).toBe(403);
  store.docs.delete(`schools/pu/members/${UID}`);
  expect((await request()).status).toBe(403);
  expect(fetchCourses).not.toHaveBeenCalled();
});

it('reads an owned WOW Class session even without a portal link', async () => {
  const { request, store, fetchCourses } = setup();
  store.docs.delete(PORTAL);
  const response = await request();
  expect(response.status).toBe(200);
  expect(fetchCourses).toHaveBeenCalledWith({ session: 'lms-secret' }, { userId: 10, status: 'ongoing' });
});

it('does not substitute campus cookies when TronClass did not connect during login', async () => {
  const { request, store, fetchCourses } = setup();
  store.docs.get(PORTAL)!.tronClassSessionId = null;
  store.docs.delete(LMS);
  const response = await request();
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(fetchCourses).not.toHaveBeenCalled();
});

it('reports WOW Class as connecting while the login sidecar window is still open', async () => {
  const { request, store, fetchCourses } = setup();
  store.docs.delete(LMS);
  Object.assign(store.docs.get(PORTAL)!, {
    tronClassSessionId: null,
    lmsConnectingUntil: new Date(Date.now() + 90_000),
  });
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.error.status).toBe('UNAVAILABLE');
  expect(body.error.details).toEqual({ code: 'lms-connecting' });
  expect(JSON.stringify(body)).not.toMatch(/secret|cookies|session/);
  expect(fetchCourses).not.toHaveBeenCalled();
});

it.each([{ ownerUid: 'someone-else' }, { expiresAt: new Date(0) }, { cookies: {} }])('rejects invalid linked LMS sessions: %j', async (change) => {
  const { request, store, fetchCourses } = setup();
  Object.assign(store.docs.get(LMS)!, change);
  expect((await request()).status).toBe(400);
  expect(fetchCourses).not.toHaveBeenCalled();
});

it.each(['membership', 'account', 'portal', 'lms'])('blocks data if %s is revoked during school response', async (change) => {
  const { request, store, fetchCourses } = setup();
  fetchCourses.mockImplementationOnce(async () => {
    if (change === 'membership') store.docs.delete(`schools/pu/members/${UID}`);
    if (change === 'account') store.docs.get(`users/${UID}`)!.accountDeletionInProgress = true;
    if (change === 'portal') store.docs.delete(PORTAL);
    if (change === 'lms') store.docs.delete(LMS);
    return [{ id: 42, name: '不得回傳' }];
  });
  const response = await request();
  expect(response.status).toBe(change === 'membership' || change === 'account' ? 403 : 400);
  expect(JSON.stringify(await response.json())).not.toContain('不得回傳');
});

it('shows a real empty list as empty and rejects malformed results', async () => {
  const { request, fetchCourses } = setup();
  fetchCourses.mockResolvedValueOnce([]);
  expect((await (await request()).json()).result.courses).toEqual([]);
  for (const data of [null, {}, [{ id: '../secret', name: '課程' }], [{ id: true, name: '課程' }],
    [{ id: [1], name: '課程' }], [{ id: 1, name: '' }]]) {
    fetchCourses.mockResolvedValueOnce(data);
    expect((await request()).status).toBe(503);
  }
});

it('maps session expiry to reconnect and does not expose underlying network errors', async () => {
  const { request, fetchCourses } = setup();
  fetchCourses.mockRejectedValueOnce(new Error('TronClass session 已失效，請重新登入'));
  expect((await (await request()).json()).error.status).toBe('FAILED_PRECONDITION');
  fetchCourses.mockRejectedValueOnce(new Error('cookie=lms-secret'));
  const response = await request();
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('lms-secret');
});

it('finds the WOW Class session without orderBy so no composite index is needed', async () => {
  const { request, store, fetchCourses } = setup();
  store.docs.delete(PORTAL);
  store.docs.delete(LMS);
  const now = Date.now();
  const expiredId = 'b'.repeat(32);
  const olderId = 'c'.repeat(32);
  const newestId = 'd'.repeat(32);
  store.docs.set(`_puTronClassSessions/${expiredId}`, {
    ownerUid: UID, cookies: { session: 'expired' }, userId: 10, expiresAt: new Date(now - 1_000),
  });
  store.docs.set(`_puTronClassSessions/${olderId}`, {
    ownerUid: UID, cookies: { session: 'older' }, userId: 10, expiresAt: new Date(now + 30_000),
  });
  store.docs.set(`_puTronClassSessions/${newestId}`, {
    ownerUid: UID, cookies: { session: 'newest' }, userId: 10, expiresAt: new Date(now + 90_000),
  });
  store.docs.set(`_puTronClassSessions/${'e'.repeat(32)}`, {
    ownerUid: 'pu-someone-else', cookies: { session: 'other' }, userId: 11, expiresAt: new Date(now + 999_000),
  });
  const db = store.db as unknown as { collection: (name: string) => Record<string, unknown> };
  const original = db.collection.bind(db);
  const limits: number[] = [];
  const guard = (query: Record<string, unknown>, name: string): Record<string, unknown> => ({
    ...query,
    where: (...args: unknown[]) =>
      guard((query.where as (...a: unknown[]) => Record<string, unknown>)(...args), name),
    limit: (count: number) => {
      if (name === '_puTronClassSessions') limits.push(count);
      return guard((query.limit as (n: number) => Record<string, unknown>)(count), name);
    },
    orderBy: (...args: unknown[]) => {
      if (name === '_puTronClassSessions') throw new Error('orderBy needs a composite index');
      return guard((query.orderBy as (...a: unknown[]) => Record<string, unknown>)(...args), name);
    },
  });
  db.collection = (name: string) => guard(original(name), name);
  const response = await request();
  expect(response.status).toBe(200);
  expect(limits).toEqual([20]);
  expect(fetchCourses).toHaveBeenCalledWith({ session: 'newest' }, { userId: 10, status: 'ongoing' });
});
