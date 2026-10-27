// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import { createLoginRateGate, LOGIN_RATE_LIMIT } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import { PuCampusError, type PuCampusGateway } from './puCampusClient';
import { resetUidRateLimitForTests } from './uidRateLimit';

const STUDENT = '1110700321';
const SECRET = 'dispatch-secret-password';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://nuni.tw/api/fn/signInPuStudentId', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function campus(overrides: Partial<PuCampusGateway> = {}): PuCampusGateway {
  return {
    loginStudent: async () => ({ cookies: { PHPSESSID: 'ok' }, studentName: '陳同學' }),
    fetchStudentInfo: async () => ({ studentId: STUDENT, name: '陳同學', class: '資管三A' }),
    loginTronClass: async () => ({
      cookies: {},
      userId: null,
      userName: '陳同學',
      role: 'student',
    }),
    fetchTronClassCourses: async () => [],
    ...overrides,
  };
}

function runtime(): { runtime: FnRuntime; store: ReturnType<typeof createMemoryGroupStore> } {
  const store = createMemoryGroupStore();
  return {
    store,
    runtime: {
      db: store.db as FnRuntime['db'],
      verifyIdToken: async () => ({ uid: 'unused' }),
      createCustomToken: async (uid, claims) => `token:${uid}:${claims.role}`,
      puCampus: campus(),
      rateLimitGate: createLoginRateGate(),
      rateLimitSalt: 'test-rate-limit-salt',
    },
  };
}

beforeEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'true');
});

afterEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  vi.unstubAllEnvs();
});

it('returns 503 尚未啟用 when the runtime switch is off', async () => {
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN', 'true');
  const { runtime: deps, store } = runtime();
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }),
    deps,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: '尚未啟用' });
  expect(store.docs.size).toBe(0);
});

it('does not treat leftover NEXT_PUBLIC flag as the write switch', async () => {
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_SCHOOL_STUDENT_ID_LOGIN', 'false');
  const { runtime: deps } = runtime();
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }),
    deps,
  );
  expect(res.status).toBe(200);
  expect((await res.json()).customToken).toBe('token:pu-1110700321:student');
});

it('uses the original HTTP body and response shape, not callable wrapping', async () => {
  const { runtime: deps } = runtime();
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }),
    deps,
  );
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.result).toBeUndefined();
  expect(body.error).toBeUndefined();
  expect(body.success).toBe(true);
  expect(typeof body.customToken).toBe('string');
});

it('does not require a bearer token', async () => {
  const { runtime: deps } = runtime();
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }),
    deps,
  );
  expect(res.status).toBe(200);
});

it('returns 401 for bad campus credentials without the password', async () => {
  const { runtime: deps } = runtime();
  deps.puCampus = campus({
    loginStudent: async () => {
      throw new PuCampusError('credentials', '學號或密碼錯誤');
    },
  });
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }),
    deps,
  );
  expect(res.status).toBe(401);
  const text = await res.text();
  expect(text).toBe(JSON.stringify({ error: '學號或密碼錯誤' }));
  expect(text).not.toContain(SECRET);
});

it('does not let a spoofed X-Forwarded-For hop bypass the IP limit', async () => {
  const { runtime: deps } = runtime();
  deps.puCampus = campus({
    loginStudent: async () => {
      throw new PuCampusError('credentials', '學號或密碼錯誤');
    },
  });
  for (let i = 0; i < LOGIN_RATE_LIMIT.ip.limit; i += 1) {
    const res = await dispatchFnRequest(
      'signInPuStudentId',
      request(
        { studentId: String(1110700300 + i), password: SECRET },
        { 'fly-client-ip': '203.0.113.10', 'x-forwarded-for': `${i}.1.1.1, 203.0.113.10` },
      ),
      deps,
    );
    expect(res.status).toBe(401);
  }
  const spoofed = await dispatchFnRequest(
    'signInPuStudentId',
    request(
      { studentId: '1110700400', password: SECRET },
      { 'fly-client-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.1' },
    ),
    deps,
  );
  expect(spoofed.status).toBe(429);
  const otherFlyIp = await dispatchFnRequest(
    'signInPuStudentId',
    request(
      { studentId: '1110700401', password: SECRET },
      { 'fly-client-ip': '203.0.113.11', 'x-forwarded-for': '198.51.100.1' },
    ),
    deps,
  );
  expect(otherFlyIp.status).toBe(401);
});

it('returns 503 without Firestore or campus when the daily write budget is spent', async () => {
  const { runtime: deps, store } = runtime();
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  deps.puCampus = campus({ loginStudent });
  deps.rateLimitGate = createLoginRateGate({ dailyWriteLimit: 0 });
  const runTransaction = vi.spyOn(store.db, 'runTransaction');
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }, { 'fly-client-ip': '203.0.113.13' }),
    deps,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: '服務暫時無法使用' });
  expect(loginStudent).not.toHaveBeenCalled();
  expect(runTransaction).not.toHaveBeenCalled();
});

it('returns 503 without campus when FIREBASE_SERVICE_ACCOUNT_JSON is empty', async () => {
  const { runtime: deps } = runtime();
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  deps.puCampus = campus({ loginStudent });
  delete deps.rateLimitSalt;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }, { 'fly-client-ip': '203.0.113.14' }),
    deps,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: '服務暫時無法使用' });
  expect(loginStudent).not.toHaveBeenCalled();
});

it('returns 503 when shared rate-limit storage cannot be written', async () => {
  const { runtime: deps, store } = runtime();
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  deps.puCampus = campus({ loginStudent });
  store.failNextCommit();
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: STUDENT, password: SECRET }, { 'fly-client-ip': '203.0.113.12' }),
    deps,
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: '服務暫時無法使用' });
  expect(loginStudent).not.toHaveBeenCalled();
});

it('returns the teacher LMS unavailability code without echoing the password', async () => {
  const { runtime: deps } = runtime();
  deps.puCampus = campus({
    loginTronClass: async () => {
      throw new PuCampusError('timeout', '學校系統無回應', {
        route: 'teacher',
        stage: 'submit',
        code: 'ETIMEDOUT',
      });
    },
  });
  const res = await dispatchFnRequest(
    'signInPuStudentId',
    request({ studentId: 'changyi', password: SECRET }, { 'fly-client-ip': '203.0.113.20' }),
    deps,
  );
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body).toEqual({
    error: '老師登入暫時無法使用',
    code: 'teacher_lms_unreachable',
  });
  expect(JSON.stringify(body)).not.toContain(SECRET);
});
