// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { getCloudFunctionUrl } from '../cloudFunctions';

const UID = 'pu-410000001';
const SESSION = '_puSessions/current';
const expiry = () => new Date(Date.now() + 60_000);

function setup() {
  const store = createMemoryGroupStore([
    [`users/${UID}`, { schoolId: 'pu', studentId: '410000001' }],
    [`schools/pu/members/${UID}`, { status: 'active', role: 'member' }],
    [SESSION, { ownerUid: UID, cookies: { portal: 'private-school-cookie' }, expiresAt: expiry() }],
    ['_puSessions/another-account', {
      ownerUid: 'pu-499999999', cookies: { portal: 'other-user-cookie' },
      expiresAt: new Date(Date.now() + 120_000),
    }],
  ]);
  const courses = vi.fn().mockResolvedValue({ success: true, courses: [{ courseName: '資料庫' }] });
  const grades = vi.fn().mockResolvedValue({
    success: true,
    grades: [{ semester: '1151', courseName: '資料庫', credits: 3, score: 0 }],
    allSemesters: ['1151'],
    summary: { '1151': { average: '0' } },
    creditSummary: { source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 0 },
    cookies: { portal: 'should-never-be-returned' },
    error: 'private internal response',
  });
  const verifyIdToken = vi.fn().mockResolvedValue({ uid: UID, schoolId: 'pu' });
  const runtime: FnRuntime = {
    db: store.db as unknown as FnRuntime['db'],
    verifyIdToken,
    academicFetchers: { courses, grades },
  };
  const request = (data: unknown = { dataType: 'grades' }, authorized = true) =>
    dispatchFnRequest('getMyAcademicRecords', new Request('https://nuni.tw/api/fn/getMyAcademicRecords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer firebase-id-token' } : {}),
      },
      body: JSON.stringify({ data }),
    }), runtime);
  return { store, courses, grades, verifyIdToken, runtime, request };
}

beforeEach(() => resetUidRateLimitForTests());

it('uses the same-origin academic endpoint without enabling any Cloud Functions service', () => {
  expect(getCloudFunctionUrl('getMyAcademicRecords', { env: {} })).toBe('/api/fn/getMyAcademicRecords');
  expect(getCloudFunctionUrl('getMyAcademicRecords', {
    env: { NEXT_PUBLIC_FUNCTIONS_BASE_URL: 'https://separate-functions.example' },
  })).toBe('/api/fn/getMyAcademicRecords');
  expect(getCloudFunctionUrl('clearPuCampusSessions', { env: {} })).toBe('/api/fn/clearPuCampusSessions');
});

it('reads only the authenticated owner session and returns provenance with no session secrets', async () => {
  const { request, grades, verifyIdToken } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(verifyIdToken).toHaveBeenCalledWith('firebase-id-token', true);
  expect(grades).toHaveBeenCalledWith({ portal: 'private-school-cookie' }, '', { mypuCookies: null });
  const body = await response.json();
  expect(body.result).toMatchObject({
    success: true, ownerUid: UID, schoolId: 'pu', source: 'pu-campus', dataType: 'grades',
    result: { grades: [{ credits: 3, score: 0 }], creditSummary: { officialAudit: false } },
  });
  expect(Number.isFinite(Date.parse(body.result.fetchedAt))).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/private-school-cookie|should-never|other-user-cookie|cookies|internal response/);
});

it('does not recreate a deleted portal session when a late grade read has mypu cookies', async () => {
  const { request, store, grades } = setup();
  grades.mockImplementationOnce(async () => {
    store.docs.delete(SESSION);
    return {
      success: true,
      grades: [{ semester: '1151', courseName: '資料庫', credits: 3, score: 86 }],
      mypuCookies: { PHPSESSID: 'mypu-orphan' },
    };
  });
  const response = await request();
  expect(response.status).toBe(400);
  expect(store.docs.has(SESSION)).toBe(false);
  expect(JSON.stringify(await response.json())).not.toMatch(/mypu-orphan|PHPSESSID/);
});

it('stores mypu cookies on the portal session and only bridges once across two grade reads', async () => {
  const { request, store, grades } = setup();
  grades.mockImplementation(async (_cookies, _semester, options) => ({
    success: true,
    grades: [{ semester: '1151', courseName: '資料庫', credits: 3, score: 86 }],
    allSemesters: ['1151'],
    mypuCookies: { PHPSESSID: 'mypu-live' },
    usedStored: Boolean(options?.mypuCookies?.PHPSESSID),
  }));
  expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(200);
  expect(store.docs.get(SESSION)).toMatchObject({
    cookies: { portal: 'private-school-cookie' },
    mypuCookies: { PHPSESSID: 'mypu-live' },
  });
  expect(grades).toHaveBeenNthCalledWith(1, { portal: 'private-school-cookie' }, '', {
    mypuCookies: null,
  });
  expect(grades).toHaveBeenNthCalledWith(2, { portal: 'private-school-cookie' }, '', {
    mypuCookies: { PHPSESSID: 'mypu-live' },
  });
  const body = await (await request()).json();
  expect(JSON.stringify(body)).not.toMatch(/mypu-live|PHPSESSID|private-school-cookie/);
});

it('uses the school timetable source for courses', async () => {
  const { request, courses, grades } = setup();
  const response = await request({ dataType: 'courses' });
  expect(response.status).toBe(200);
  expect(courses).toHaveBeenCalledTimes(1);
  expect(grades).not.toHaveBeenCalled();
});

it.each([
  { dataType: 'grades', uid: 'pu-499999999' },
  { dataType: 'grades', sessionId: 'another-account' },
  { dataType: 'grades', schoolId: 'other' },
  { dataType: 'grades', semester: '1151' },
  { dataType: 'unknown' },
  { dataType: ['grades'] },
  { dataType: { value: 'grades' } },
  [],
  null,
])('rejects caller-selected identities, sessions and unsupported data: %j', async (data) => {
  const { request, grades } = setup();
  const response = await request(data);
  expect(response.status).toBe(400);
  expect(grades).not.toHaveBeenCalled();
});

it('requires a valid unrevoked Firebase identity before reading the school', async () => {
  const { request, grades, verifyIdToken } = setup();
  expect((await request({ dataType: 'grades' }, false)).status).toBe(401);
  verifyIdToken.mockRejectedValueOnce(new Error('auth/id-token-revoked'));
  expect((await request()).status).toBe(401);
  expect(grades).not.toHaveBeenCalled();
});

it('rejects a token belonging to a different school', async () => {
  const { request, grades, verifyIdToken } = setup();
  verifyIdToken.mockResolvedValueOnce({ uid: UID, schoolId: 'other' });
  expect((await request()).status).toBe(403);
  expect(grades).not.toHaveBeenCalled();
});

it.each([
  { status: 'deleted' },
  { accountDeletionInProgress: true },
  { schoolId: 'other' },
])('rejects a removed, deleting or mismatched account: %j', async (fields) => {
  const { request, store, grades } = setup();
  store.docs.set(`users/${UID}`, { schoolId: 'pu', ...fields });
  expect((await request()).status).toBe(403);
  expect(grades).not.toHaveBeenCalled();
});

it('requires an explicitly active school membership', async () => {
  const { request, store, grades } = setup();
  store.docs.set(`schools/pu/members/${UID}`, { role: 'member' });
  expect((await request()).status).toBe(403);
  expect(grades).not.toHaveBeenCalled();
});

it.each([
  { expiresAt: new Date(0) },
  { expiresAt: '2099-01-01' },
  { cookies: {} },
  { cookies: { portal: 'invalid\r\nheader' } },
])('requires a fresh valid school session: %j', async (fields) => {
  const { request, store, grades } = setup();
  store.docs.set(SESSION, { ...store.docs.get(SESSION), ...fields });
  const response = await request();
  expect(response.status).toBe(400);
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
  expect(grades).not.toHaveBeenCalled();
});

it('asks to reconnect after the school rejects an otherwise unexpired session', async () => {
  const { request, grades } = setup();
  grades.mockResolvedValueOnce({ success: false, code: 'session-expired', grades: [] });
  const response = await request();
  expect((await response.json()).error.status).toBe('FAILED_PRECONDITION');
});

it('does not turn failed or malformed school responses into an empty successful result', async () => {
  const { request, grades } = setup();
  for (const value of [{ success: false, grades: [] }, { success: true, grades: null }, null]) {
    grades.mockResolvedValueOnce(value);
    const response = await request();
    expect(response.status).toBe(503);
  }
});

it.each(['membership', 'account', 'session'])('checks %s again after a pending school read', async (change) => {
  const { request, store, grades } = setup();
  grades.mockImplementationOnce(async () => {
    if (change === 'membership') store.docs.set(`schools/pu/members/${UID}`, { status: 'revoked' });
    if (change === 'account') store.docs.set(`users/${UID}`, { schoolId: 'pu', accountDeletionInProgress: true });
    if (change === 'session') store.docs.delete(SESSION);
    return { success: true, grades: [{ courseName: '不得外洩' }] };
  });
  const response = await request();
  expect(response.status).toBe(change === 'session' ? 400 : 403);
  expect(JSON.stringify(await response.json())).not.toContain('不得外洩');
});

it('does not expose network errors or session values to clients', async () => {
  const { request, grades } = setup();
  grades.mockRejectedValueOnce(new Error('https://school.invalid/?ticket=SECRET cookie=SECRET'));
  const response = await request();
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('SECRET');
});

it('deletes the owner campus sessions including cookies and mypuCookies', async () => {
  const { store, verifyIdToken } = setup();
  store.docs.set(SESSION, {
    ...store.docs.get(SESSION),
    mypuCookies: { PHPSESSID: 'mypu-live' },
  });
  const response = await dispatchFnRequest(
    'clearPuCampusSessions',
    new Request('https://nuni.tw/api/fn/clearPuCampusSessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-id-token' },
      body: JSON.stringify({ data: {} }),
    }),
    {
      db: store.db as unknown as FnRuntime['db'],
      verifyIdToken,
    },
  );
  expect(response.status).toBe(200);
  expect(verifyIdToken).toHaveBeenCalledWith('firebase-id-token', true);
  expect(await response.json()).toEqual({ result: { success: true, deleted: 1 } });
  expect(store.docs.has(SESSION)).toBe(false);
  expect(store.docs.has('_puSessions/another-account')).toBe(true);
});

it('retains the existing request limit on repeated reads', async () => {
  const { request, grades } = setup();
  for (let count = 0; count < 10; count += 1) expect((await request()).status).toBe(200);
  expect((await request()).status).toBe(429);
  expect(grades).toHaveBeenCalledTimes(10);
});
