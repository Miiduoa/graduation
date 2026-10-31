// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as puScraper from '../../../../../backend/functions/puScraper.js';
import { academicSchoolSource } from './academicSchoolSource';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { createMemoryGroupStore } from './memoryGroupStore';
import { resetUidRateLimitForTests } from './uidRateLimit';
import { createPuCampusGateway } from './puCampusClient';
import {
  ECAMPUS_FETCH_PAUSED_ENV,
  ECAMPUS_PAUSED_CODE,
  ECAMPUS_PAUSED_MESSAGE,
  isEcampusFetchPaused,
} from './ecampusFetchPause';

const UID = 'pu-410000001';
const STUDENT = '410000001';
const PASSWORD = 'test-password';

type CampusFetch = (url: string, init?: RequestInit) => Promise<Response>;
const setCampusHttpFetch = (puScraper as unknown as {
  setCampusHttpFetch: (fn: CampusFetch | null) => void;
}).setCampusHttpFetch;

function html(body: string, headers?: Record<string, string>) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html', ...headers } });
}

const studentPage = `學號(Student No.)：${STUDENT} 姓名(Student Name)：測試 query_course`;

function campusFetch() {
  return vi.fn<CampusFetch>(async () => html(studentPage));
}

function setup() {
  const store = createMemoryGroupStore([
    [`users/${UID}`, { schoolId: 'pu', studentId: STUDENT }],
    [`schools/pu/members/${UID}`, { status: 'active', role: 'member' }],
    ['_puSessions/current', {
      ownerUid: UID, cookies: { portal: 'cookie' }, expiresAt: new Date(Date.now() + 60_000),
    }],
  ]);
  const courses = vi.fn().mockResolvedValue({ success: true, courses: [{ courseName: '資料庫' }] });
  const grades = vi.fn().mockResolvedValue({ success: true, grades: [] });
  const runtime: FnRuntime = {
    db: store.db as unknown as FnRuntime['db'],
    verifyIdToken: vi.fn().mockResolvedValue({ uid: UID, schoolId: 'pu' }),
    academicFetchers: { courses, grades },
  };
  const request = (dataType: string) =>
    dispatchFnRequest('getMyAcademicRecords', new Request('https://nuni.tw/api/fn/getMyAcademicRecords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-id-token' },
      body: JSON.stringify({ data: { dataType } }),
    }), runtime);
  return { courses, grades, request };
}

beforeEach(() => {
  resetUidRateLimitForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setCampusHttpFetch(null);
});

it.each([
  ['1', true], ['true', true], ['TRUE', true], [' true ', true],
  ['', false], ['0', false], ['false', false], ['yes', false], ['on', false],
])('PU_ECAMPUS_FETCH_PAUSED=%j → %s', (value, expected) => {
  expect(isEcampusFetchPaused({ [ECAMPUS_FETCH_PAUSED_ENV]: value })).toBe(expected);
});

it('預設（未設定）為關閉', () => {
  expect(isEcampusFetchPaused({})).toBe(false);
});

it.each(['grades', 'courses'])('開啟時 getMyAcademicRecords（%s）不呼叫抓取並回暫停狀態', async (dataType) => {
  vi.stubEnv(ECAMPUS_FETCH_PAUSED_ENV, '1');
  const { request, courses, grades } = setup();
  const response = await request(dataType);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result).toEqual({
    success: true, paused: true, code: ECAMPUS_PAUSED_CODE, message: ECAMPUS_PAUSED_MESSAGE,
    ownerUid: UID, schoolId: 'pu', source: 'pu-campus', dataType, fetchedAt: null, result: null,
  });
  expect(courses).not.toHaveBeenCalled();
  expect(grades).not.toHaveBeenCalled();
});

it('關閉時 getMyAcademicRecords 行為不變', async () => {
  vi.stubEnv(ECAMPUS_FETCH_PAUSED_ENV, '0');
  const { request, courses } = setup();
  const body = await (await request('courses')).json();
  expect(body.result).toMatchObject({ success: true, dataType: 'courses', result: { courses: [{ courseName: '資料庫' }] } });
  expect(body.result.paused).toBeUndefined();
  expect(courses).toHaveBeenCalledTimes(1);
});

it('開啟時伺服器端實際抓取（課表、成績含 mypu SSO）對校方送出 0 個請求', async () => {
  vi.stubEnv(ECAMPUS_FETCH_PAUSED_ENV, 'true');
  const fetchMock = campusFetch();
  setCampusHttpFetch(fetchMock);
  const courses = await academicSchoolSource.courses({ portal: 'cookie' }, '');
  const grades = await academicSchoolSource.grades({ portal: 'cookie' }, '', {
    mypuCookies: { PHPSESSID: 'mypu' },
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(courses).toMatchObject({ success: false, paused: true, code: ECAMPUS_PAUSED_CODE, courses: [] });
  expect(grades).toMatchObject({ success: false, paused: true, code: ECAMPUS_PAUSED_CODE, grades: [] });
});

it('關閉時伺服器端課表照常讀取 alcat', async () => {
  const fetchMock = campusFetch();
  setCampusHttpFetch(fetchMock);
  await academicSchoolSource.courses({ portal: 'cookie' }, '');
  expect(fetchMock).toHaveBeenCalled();
  expect(String(fetchMock.mock.calls[0][0])).toBe('https://alcat.pu.edu.tw/stu_query/query_course.html');
});

it('開啟時 fetchStudentInfo 不送請求，回空資料', async () => {
  vi.stubEnv(ECAMPUS_FETCH_PAUSED_ENV, '1');
  const fetchMock = campusFetch();
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'abc' })).resolves.toEqual({});
  expect(fetchMock).not.toHaveBeenCalled();
});

it('開啟時學號登入不受影響，請求與關閉時相同', async () => {
  const run = async () => {
    const fetchMock = vi.fn<CampusFetch>(async (url, init) => {
      if (String(url).endsWith('/index_check.php')) {
        return html('<html>ok</html>', { 'set-cookie': 'PHPSESSID=abc; Path=/' });
      }
      if (String(url) === 'https://alcat.pu.edu.tw/' && !init?.method) {
        return html('<html>home</html>', { 'set-cookie': 'PHPSESSID=abc; Path=/' });
      }
      return html(studentPage);
    });
    const gateway = createPuCampusGateway({ fetch: fetchMock });
    await expect(gateway.loginStudent(STUDENT, PASSWORD)).resolves.toMatchObject({ studentName: '測試' });
    return fetchMock.mock.calls.map(([url, init]) => `${String(init?.method || 'GET').toUpperCase()} ${String(url)}`);
  };
  const unpaused = await run();
  vi.stubEnv(ECAMPUS_FETCH_PAUSED_ENV, '1');
  const paused = await run();
  expect(paused).toEqual(unpaused);
  expect(paused).toEqual([
    'GET https://alcat.pu.edu.tw/',
    'POST https://alcat.pu.edu.tw/index_check.php',
    'GET https://alcat.pu.edu.tw/stu_query/query_course.html',
  ]);
});
