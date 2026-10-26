// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { resetFirebaseAdminForTests } from './firebaseAdmin';
import { resetLoginRateLimitForTests } from './loginRateLimit';
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
    },
  };
}

beforeEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  resetLoginRateLimitForTests();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'true');
});

afterEach(() => {
  resetFirebaseAdminForTests();
  resetUidRateLimitForTests();
  resetLoginRateLimitForTests();
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
