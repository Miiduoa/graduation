// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { decodeFirebaseCustomTokenPayload } from './firebaseCustomToken';
import {
  ACCOUNT_SCOPE,
  createLoginRateGate,
  hashRateLimitDocId,
  LOGIN_RATE_LIMIT,
  LoginRateLimitError,
  RATE_LIMITS_COLLECTION,
} from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import { PuCampusError, type PuCampusGateway } from './puCampusClient';
import {
  clientIpFromRequest,
  handleSignInPuStudentId,
  MIN_STUDENT_PORTAL_TIMEOUT_MS,
  PuLoginHttpError,
  STUDENT_LMS_SOFT_TIMEOUT_MS,
  studentPortalTimeoutMs,
  TEACHER_LMS_UNAVAILABLE,
  TEACHER_LMS_UNAVAILABLE_CODE,
} from './signInPuStudentId';

const STUDENT = '1110700321';
const SECRET = 'never-log-this-password';

function campus(overrides: Partial<PuCampusGateway> = {}): PuCampusGateway {
  return {
    loginStudent: async () => ({
      cookies: { PHPSESSID: 'stu-cookie' },
      studentName: '陳同學',
    }),
    fetchStudentInfo: async () => ({
      studentId: STUDENT,
      name: '陳同學',
      class: '資管三A',
    }),
    loginTronClass: async () => ({
      cookies: { session: 'tc-cookie' },
      userId: 9,
      userName: '陳同學',
      role: 'student',
    }),
    fetchTronClassCourses: async () => [],
    ...overrides,
  };
}

function deps(options?: {
  store?: ReturnType<typeof createMemoryGroupStore>;
  campus?: PuCampusGateway;
  token?: string;
}) {
  const store = options?.store ?? createMemoryGroupStore();
  const scheduled: Array<() => Promise<void>> = [];
  return {
    store,
    scheduled,
    flushSso: async () => {
      const tasks = scheduled.splice(0, scheduled.length);
      await Promise.all(tasks.map((task) => task()));
    },
    runtime: {
      db: store.db,
      campus: options?.campus ?? campus(),
      signCustomToken: async (uid: string, claims: Record<string, string>) =>
        options?.token ?? `token:${uid}:${claims.role}:${claims.schoolId}`,
      rateLimitGate: createLoginRateGate(),
      rateLimitSalt: 'test-rate-limit-salt',
      scheduleCampusSso: (task: () => Promise<void>) => {
        scheduled.push(task);
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('returns a custom token and writes student profile fields without clobbering extras', async () => {
  const store = createMemoryGroupStore([
    ['users/pu-1110700321', { bio: 'keep-me', favoriteColor: 'blue' }],
  ]);
  const { runtime, flushSso } = deps({ store });
  const result = await handleSignInPuStudentId(
    { studentId: STUDENT, password: SECRET, schoolId: 'pu' },
    '1.1.1.1',
    runtime,
  );
  expect(result).toMatchObject({
    success: true,
    customToken: 'token:pu-1110700321:student:pu',
    uid: 'pu-1110700321',
    studentId: STUDENT,
    displayName: '陳同學',
    department: '',
    isNewUser: false,
    tronClassOk: false,
    tronClassSessionId: null,
  });
  expect(store.docs.get('users/pu-1110700321')).toMatchObject({
    bio: 'keep-me',
    favoriteColor: 'blue',
    studentId: STUDENT,
    displayName: '陳同學',
    role: 'student',
    schoolId: 'pu',
    email: '1110700321@pu.edu.tw',
  });
  expect(store.docs.get('schools/pu/members/pu-1110700321')).toMatchObject({
    studentId: STUDENT,
    status: 'active',
    role: 'member',
  });
  expect(store.docs.get(`_puSessions/${result.puSessionId}`)).toMatchObject({
    ownerUid: result.uid,
  });
  expect(store.docs.get(`_puSessions/${result.puSessionId}`)).not.toHaveProperty('tronClassSessionId');
  await flushSso();
  const portal = store.docs.get(`_puSessions/${result.puSessionId}`) as { tronClassSessionId?: string };
  expect(typeof portal.tronClassSessionId).toBe('string');
  expect(store.docs.get(`_puTronClassSessions/${portal.tronClassSessionId}`)).toMatchObject({
    ownerUid: result.uid,
  });
});

it('rejects unknown or closed schools with 尚未開放 without campus or account rate limits', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' } }));
  const loginTronClass = vi.fn(async () => {
    throw new Error('should not run');
  });
  const { runtime, store } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET, schoolId: 'ntu' }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 503, message: '尚未開放' });
  await expect(
    handleSignInPuStudentId(
      { studentId: STUDENT, password: SECRET, schoolId: 'no-such-school' },
      '8.8.8.8',
      runtime,
    ),
  ).rejects.toMatchObject({ status: 503, message: '尚未開放' });
  expect(loginStudent).not.toHaveBeenCalled();
  expect(loginTronClass).not.toHaveBeenCalled();
  expect([...store.docs.keys()].filter((path) => path.startsWith('_rateLimits/'))).toEqual([]);
});

it('rejects invalid student ids and missing fields', async () => {
  const { runtime } = deps();
  await expect(
    handleSignInPuStudentId({ studentId: '12', password: SECRET }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 400, message: '學號格式不正確' });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 400, message: 'Missing required fields: studentId, password' });
});

it('logs the actual TronClass soft-failure reason instead of campus_unreachable', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    lines.push(args.map((item) => String(item)).join(' '));
  });
  const loginTronClass = vi.fn(async () => {
    throw new PuCampusError('unavailable', '學校系統無回應', {
      route: 'student',
      stage: 'submit',
      code: 'HTTP_400',
    });
  });
  const { runtime, flushSso } = deps({ campus: campus({ loginTronClass }) });
  await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(loginTronClass).not.toHaveBeenCalled();
  await flushSso();
  const soft = lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((row) => row?.msg === 'pu_campus_login_soft_failure');
  expect(soft).toMatchObject({
    msg: 'pu_campus_login_soft_failure',
    reason: 'unavailable',
    code: 'HTTP_400',
    route: 'student',
    stage: 'submit',
  });
  expect(soft?.reason).not.toBe('campus_unreachable');
});

it.each([
  ['s1110700321', 's1110700321'],
  ['S1110700321', 's1110700321'],
  ['1110700321@pu.edu.tw', '1110700321'],
  ['s1110700321@pu.edu.tw', 's1110700321'],
])('routes %s to student alcat as %s and keeps the digit uid', async (input, portalUid) => {
  const loginStudent = vi.fn(async (studentId: string) => {
    expect(studentId).toBe(portalUid);
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const loginTronClass = vi.fn(async () => {
    throw new PuCampusError('timeout', '學校系統無回應', { route: 'student', stage: 'submit', code: 'ETIMEDOUT' });
  });
  const { runtime, flushSso } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  const result = await handleSignInPuStudentId({ studentId: input, password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ uid: 'pu-1110700321', studentId: STUDENT, success: true, tronClassOk: false });
  expect(loginStudent).toHaveBeenCalledOnce();
  expect(loginTronClass).not.toHaveBeenCalled();
  await flushSso();
  expect(loginTronClass).toHaveBeenCalledWith(portalUid, SECRET, {
    timeoutMs: STUDENT_LMS_SOFT_TIMEOUT_MS,
    route: 'student',
  });
});

it.each([
  ['s7654321', 's7654321', '7654321'],
  ['S7654321', 's7654321', '7654321'],
  ['7654321', '7654321', '7654321'],
  ['s87654321', 's87654321', '87654321'],
  ['87654321', '87654321', '87654321'],
  ['s7654321@pu.edu.tw', 's7654321', '7654321'],
])('routes short campus account %s to alcat and a stable digit uid', async (input, portalUid, digits) => {
  const loginStudent = vi.fn(async (studentId: string) => {
    expect(studentId).toBe(portalUid);
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const loginTronClass = vi.fn(async () => {
    throw new PuCampusError('timeout', '學校系統無回應', { route: 'student', stage: 'submit', code: 'ETIMEDOUT' });
  });
  const { runtime, flushSso } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  const result = await handleSignInPuStudentId({ studentId: input, password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ uid: `pu-${digits}`, studentId: digits, success: true, tronClassOk: false });
  expect(loginStudent).toHaveBeenCalledOnce();
  expect(loginTronClass).not.toHaveBeenCalled();
  await flushSso();
  expect(loginTronClass).toHaveBeenCalledWith(portalUid, SECRET, {
    timeoutMs: STUDENT_LMS_SOFT_TIMEOUT_MS,
    route: 'student',
  });
});

it('maps s-prefixed and digit-only short accounts to the same Firebase uid', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' }));
  const { runtime: withS } = deps({ campus: campus({ loginStudent }) });
  const { runtime: digits } = deps({ campus: campus({ loginStudent }) });
  const fromS = await handleSignInPuStudentId({ studentId: 's7654321', password: SECRET }, '1.1.1.1', withS);
  const fromDigits = await handleSignInPuStudentId({ studentId: '7654321', password: SECRET }, '1.1.1.2', digits);
  expect(fromS.uid).toBe('pu-7654321');
  expect(fromDigits.uid).toBe('pu-7654321');
  expect(fromS.studentId).toBe('7654321');
  expect(fromDigits.studentId).toBe('7654321');
});

it('retries the other alcat uid once after credentials then stops', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  const loginTronClass = vi.fn(async () => {
    throw new Error('should not run');
  });
  const { runtime } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  await expect(
    handleSignInPuStudentId({ studentId: 's7654321', password: SECRET }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 401, message: '學號或密碼錯誤' });
  expect(loginStudent).toHaveBeenNthCalledWith(1, 's7654321', SECRET);
  expect(loginStudent).toHaveBeenNthCalledWith(2, '7654321', SECRET);
  expect(loginStudent).toHaveBeenCalledTimes(2);
  expect(loginTronClass).not.toHaveBeenCalled();
});

it('succeeds on the second alcat form after the first is rejected', async () => {
  const loginStudent = vi.fn(async (studentId: string) => {
    if (studentId === 's7654321') throw new PuCampusError('credentials', '學號或密碼錯誤');
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const { runtime } = deps({ campus: campus({ loginStudent }) });
  const result = await handleSignInPuStudentId({ studentId: 's7654321', password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ uid: 'pu-7654321', studentId: '7654321', success: true });
  expect(loginStudent).toHaveBeenNthCalledWith(1, 's7654321', SECRET);
  expect(loginStudent).toHaveBeenNthCalledWith(2, '7654321', SECRET);
});

it('retries the same alcat uid once after a campus timeout and does not try the other uid', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('timeout', '學校系統無回應', { route: 'student', stage: 'submit', code: 'ETIMEDOUT' });
  });
  const { runtime } = deps({ campus: campus({ loginStudent }) });
  await expect(
    handleSignInPuStudentId({ studentId: 's7654321', password: SECRET }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 503, message: '學校系統暫時無法連線' });
  expect(loginStudent).toHaveBeenCalledTimes(2);
  expect(loginStudent).toHaveBeenNthCalledWith(1, 's7654321', SECRET);
  expect(loginStudent).toHaveBeenNthCalledWith(2, 's7654321', SECRET);
});

it('succeeds on the second alcat attempt after a timeout', async () => {
  const loginStudent = vi.fn(async () => {
    if (loginStudent.mock.calls.length === 1) {
      throw new PuCampusError('timeout', '學校系統無回應', { route: 'student', stage: 'submit', code: 'AbortError' });
    }
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const loginTronClass = vi.fn(async () => {
    throw new Error('lms should stay in the background');
  });
  const { runtime } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  const result = await handleSignInPuStudentId({ studentId: 's7654321', password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ success: true, uid: 'pu-7654321', tronClassOk: false });
  expect(loginStudent).toHaveBeenCalledTimes(2);
  expect(loginTronClass).not.toHaveBeenCalled();
});

it('keeps a configurable portal timeout at or above 15 seconds', () => {
  expect(studentPortalTimeoutMs(undefined)).toBe(MIN_STUDENT_PORTAL_TIMEOUT_MS);
  expect(studentPortalTimeoutMs('8000')).toBe(MIN_STUDENT_PORTAL_TIMEOUT_MS);
  expect(studentPortalTimeoutMs('20000')).toBe(20_000);
  expect(studentPortalTimeoutMs('999999')).toBe(60_000);
});

it('still signs in when e-campus submit takes 11 seconds and does not wait for WOW Class', async () => {
  vi.useFakeTimers();
  const loginStudent = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const loginTronClass = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    throw new PuCampusError('timeout', '學校系統無回應', {
      route: 'student',
      stage: 'submit',
      code: 'AbortError',
    });
  });
  const { runtime } = deps({ campus: campus({ loginStudent, loginTronClass }) });
  const pending = handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  await vi.advanceTimersByTimeAsync(11_000);
  const result = await pending;
  expect(result).toMatchObject({
    success: true,
    customToken: expect.any(String),
    tronClassOk: false,
    tronClassSessionId: null,
  });
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(loginTronClass).not.toHaveBeenCalled();
});

it('returns a clear school timeout without minting a session after the retry is exhausted', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('timeout', '學校系統無回應', {
      route: 'student',
      stage: 'submit',
      code: 'AbortError',
    });
  });
  const { runtime, store, scheduled } = deps({ campus: campus({ loginStudent }) });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 503, message: '學校系統暫時無法連線' });
  expect(loginStudent).toHaveBeenCalledTimes(2);
  expect(scheduled).toEqual([]);
  expect([...store.docs.keys()].some((path) => path.startsWith('_puSessions/'))).toBe(false);
  expect([...store.docs.keys()].some((path) => path.startsWith('users/'))).toBe(false);
});

it('keeps romanized faculty accounts on the teacher route', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu' } }));
  const loginTronClass = vi.fn(async () => ({
    cookies: { session: 'tc' },
    userId: 44,
    userName: '王老師',
    role: 'teacher',
  }));
  const { runtime } = deps({
    campus: campus({
      loginStudent,
      loginTronClass,
      fetchTronClassCourses: async () => [
        { name: '資料庫', role: 'teacher', teachers: [{ name: '王老師' }] },
      ],
    }),
  });
  const result = await handleSignInPuStudentId({ studentId: 'changyi', password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ uid: 'pu-t-changyi', role: 'teacher' });
  expect(loginStudent).not.toHaveBeenCalled();
  expect(loginTronClass).toHaveBeenCalled();
});

it('keeps T-prefixed faculty accounts on the teacher route', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu' } }));
  const loginTronClass = vi.fn(async () => ({
    cookies: { session: 'tc' },
    userId: 44,
    userName: '王老師',
    role: 'teacher',
  }));
  const { runtime } = deps({
    campus: campus({
      loginStudent,
      loginTronClass,
      fetchTronClassCourses: async () => [
        { name: '資料庫', role: 'teacher', teachers: [{ name: '王老師' }] },
      ],
    }),
  });
  const result = await handleSignInPuStudentId({ studentId: 'T0000001', password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ uid: 'pu-t-t0000001', role: 'teacher' });
  expect(loginStudent).not.toHaveBeenCalled();
  expect(loginTronClass).toHaveBeenCalledWith('T0000001', SECRET, { route: 'teacher' });
});

it('logs expected campus failures without account, password, or IP', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    lines.push(args.map((item) => String(item)).join(' '));
  });
  const { runtime: closed } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('closed', '尚未開放');
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '2.2.2.2', closed),
  ).rejects.toMatchObject({ status: 503, message: '尚未開放' });
  const closedLog = JSON.parse(lines.at(-1) || '{}') as Record<string, unknown>;
  expect(closedLog).toMatchObject({
    msg: 'pu_campus_login_expected_failure',
    reason: 'campus_closed',
    school: 'pu',
    route: 'student',
  });
  expect(typeof closedLog.elapsedMs).toBe('number');
  expect(JSON.stringify(closedLog)).not.toContain(STUDENT);
  expect(JSON.stringify(closedLog)).not.toContain(SECRET);
  expect(JSON.stringify(closedLog)).not.toContain('2.2.2.2');
  expect(JSON.stringify(closedLog)).not.toContain('PHPSESSID');
  expect(JSON.stringify(closedLog)).not.toContain('token');

  const { runtime: timeout } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('timeout', '學校系統無回應', {
          route: 'student',
          stage: 'submit',
          code: 'ETIMEDOUT',
        });
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '3.3.3.3', timeout),
  ).rejects.toMatchObject({ status: 503, message: '學校系統暫時無法連線' });
  const timeoutLog = JSON.parse(lines.at(-1) || '{}') as Record<string, unknown>;
  expect(timeoutLog).toMatchObject({
    msg: 'pu_campus_login_expected_failure',
    reason: 'campus_unreachable',
    school: 'pu',
    route: 'student',
    stage: 'submit',
    code: 'ETIMEDOUT',
  });
  expect(JSON.stringify(timeoutLog)).not.toContain(SECRET);
  expect(JSON.stringify(timeoutLog)).not.toContain('3.3.3.3');
});

it('tells teachers the LMS is temporarily unavailable when TronClass cannot be reached', async () => {
  const lines: string[] = [];
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    lines.push(args.map((item) => String(item)).join(' '));
  });
  const { runtime } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new Error('should not run');
      },
      loginTronClass: async () => {
        throw new PuCampusError('timeout', '學校系統無回應', {
          route: 'teacher',
          stage: 'submit',
          code: 'ETIMEDOUT',
        });
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: 'changyi', password: SECRET }, '8.8.8.8', runtime),
  ).rejects.toMatchObject({
    status: 503,
    message: TEACHER_LMS_UNAVAILABLE,
    code: TEACHER_LMS_UNAVAILABLE_CODE,
  });
  const timeoutLog = JSON.parse(lines.at(-1) || '{}') as Record<string, unknown>;
  expect(timeoutLog).toMatchObject({
    msg: 'pu_campus_login_expected_failure',
    route: 'teacher',
    stage: 'submit',
    code: 'ETIMEDOUT',
  });
  expect(JSON.stringify(timeoutLog)).not.toContain('changyi');
  expect(JSON.stringify(timeoutLog)).not.toContain(SECRET);
});

it('maps campus credential, timeout and closed errors', async () => {
  const { runtime: creds } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('credentials', '學號或密碼錯誤');
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '2.2.2.2', creds),
  ).rejects.toMatchObject({ status: 401, message: '學號或密碼錯誤' });

  const { runtime: timeout } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('timeout', '學校系統無回應');
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '3.3.3.3', timeout),
  ).rejects.toMatchObject({ status: 503, message: '學校系統暫時無法連線' });

  const { runtime: closed } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('closed', '尚未開放');
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '4.4.4.4', closed),
  ).rejects.toMatchObject({ status: 503, message: '尚未開放' });
});

it('never puts the password into logs, thrown errors, or the JSON result', async () => {
  const errors: unknown[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args);
  });
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    errors.push(args);
  });
  vi.spyOn(console, 'info').mockImplementation((...args) => {
    errors.push(args);
  });
  const { runtime } = deps({
    campus: campus({
      loginTronClass: async () => {
        throw new Error(`upstream exploded ${SECRET}`);
      },
      fetchStudentInfo: async () => {
        throw new Error(`profile ${SECRET}`);
      },
    }),
  });
  const result = await handleSignInPuStudentId(
    { studentId: STUDENT, password: SECRET },
    '5.5.5.5',
    runtime,
  );
  expect(JSON.stringify(result)).not.toContain(SECRET);
  expect(JSON.stringify(errors)).not.toContain(SECRET);
  const { runtime: failing } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new Error(`login boom ${SECRET}`);
      },
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '5.5.5.6', failing),
  ).rejects.toMatchObject({ status: 500, message: 'PU student login failed' });
  try {
    await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '5.5.5.7', failing);
  } catch (error) {
    expect(error).toBeInstanceOf(PuLoginHttpError);
    expect(String(error)).not.toContain(SECRET);
  }
  expect(JSON.stringify(errors)).not.toContain(SECRET);
});

it('signs real custom token claims when a service account is provided', async () => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { runtime } = deps();
  const result = await handleSignInPuStudentId(
    { studentId: STUDENT, password: SECRET },
    '6.6.6.6',
    {
      ...runtime,
      signCustomToken: undefined,
      serviceAccount: {
        client_email: 'firebase-adminsdk@campus-one-tw.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
    },
  );
  const payload = decodeFirebaseCustomTokenPayload(String(result.customToken));
  expect(payload.uid).toBe('pu-1110700321');
  expect(payload.claims).toEqual({ schoolId: 'pu', role: 'student' });
});

it('rate-limits repeated student attempts before calling the campus', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  const { runtime, store } = deps({ campus: campus({ loginStudent }) });
  for (let i = 0; i < 5; i += 1) {
    await expect(
      handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.9', runtime),
    ).rejects.toMatchObject({ status: 401 });
  }
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.9', runtime),
  ).rejects.toMatchObject({ status: 429, message: 'Too many requests' });
  expect(loginStudent).toHaveBeenCalledTimes(LOGIN_RATE_LIMIT.account.limit * 2);
  const rateLimitPaths = [...store.docs.keys()].filter((path) => path.startsWith('_rateLimits/'));
  expect(rateLimitPaths.join('\n')).not.toContain(STUDENT);
});

it('lets at most 5 concurrent attempts for the same account reach campus', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  const { runtime } = deps({ campus: campus({ loginStudent }) });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      handleSignInPuStudentId(
        { studentId: STUDENT, password: SECRET },
        `10.1.0.${index + 1}`,
        runtime,
      ).catch((error: unknown) => error),
    ),
  );
  expect(loginStudent.mock.calls.length).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.account.limit * 2);
  expect(
    results.filter((item) => item instanceof LoginRateLimitError || (item instanceof PuLoginHttpError && item.status === 429))
      .length,
  ).toBeGreaterThan(0);
});

it('rejects from shared Firestore even when this process memory is empty', async () => {
  const loginStudent = vi.fn(async () => {
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  const salt = 'test-rate-limit-salt';
  const hashed = hashRateLimitDocId(ACCOUNT_SCOPE, STUDENT, salt);
  const store = createMemoryGroupStore([
    [
      `${RATE_LIMITS_COLLECTION}/${hashed}`,
      { count: LOGIN_RATE_LIMIT.account.limit, ttl: new Date(Date.now() + 15 * 60 * 1000), scope: ACCOUNT_SCOPE },
    ],
  ]);
  const { runtime } = deps({ store, campus: campus({ loginStudent }) });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.8.8', runtime),
  ).rejects.toMatchObject({ status: 429, message: 'Too many requests' });
  expect(loginStudent).not.toHaveBeenCalled();
});

it('refunds the account debit after a campus timeout', async () => {
  let mode: 'timeout' | 'credentials' = 'timeout';
  const loginStudent = vi.fn(async () => {
    if (mode === 'timeout') throw new PuCampusError('timeout', '學校系統無回應');
    throw new PuCampusError('credentials', '學號或密碼錯誤');
  });
  const { runtime } = deps({ campus: campus({ loginStudent }) });
  for (let i = 0; i < LOGIN_RATE_LIMIT.account.limit; i += 1) {
    await expect(
      handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, `11.0.0.${i + 1}`, runtime),
    ).rejects.toMatchObject({ status: 503, message: '學校系統暫時無法連線' });
  }
  mode = 'credentials';
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '11.0.0.9', runtime),
  ).rejects.toMatchObject({ status: 401, message: '學號或密碼錯誤' });
  expect(loginStudent).toHaveBeenCalledTimes(LOGIN_RATE_LIMIT.account.limit * 2 + 2);
});

it('returns 503 without campus when the service-account secret is empty', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' } }));
  const { runtime } = deps({ campus: campus({ loginStudent }) });
  const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try {
    await expect(
      handleSignInPuStudentId(
        { studentId: STUDENT, password: SECRET },
        '9.9.9.6',
        {
          db: runtime.db,
          campus: runtime.campus,
          signCustomToken: runtime.signCustomToken,
          rateLimitGate: runtime.rateLimitGate,
        },
      ),
    ).rejects.toMatchObject({ status: 503, message: '服務暫時無法使用' });
    expect(loginStudent).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
  }
});

it('returns 503 and does not call the campus when rate-limit storage fails', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' } }));
  const store = createMemoryGroupStore();
  store.failNextCommit();
  const { runtime } = deps({ store, campus: campus({ loginStudent }) });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.8', runtime),
  ).rejects.toMatchObject({ status: 503, message: '服務暫時無法使用' });
  expect(loginStudent).not.toHaveBeenCalled();
});

it('returns 503 without Firestore or campus when the daily write budget is spent', async () => {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' } }));
  const store = createMemoryGroupStore();
  const runTransaction = vi.spyOn(store.db, 'runTransaction');
  const { runtime } = deps({ store, campus: campus({ loginStudent }) });
  runtime.rateLimitGate = createLoginRateGate({ dailyWriteLimit: 0 });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.7', runtime),
  ).rejects.toMatchObject({ status: 503, message: '服務暫時無法使用' });
  expect(loginStudent).not.toHaveBeenCalled();
  expect(runTransaction).not.toHaveBeenCalled();
});

it('uses only Fly-Client-IP and otherwise a shared unknown bucket', () => {
  expect(
    clientIpFromRequest(
      new Request('https://nuni.tw/api/fn/signInPuStudentId', {
        headers: {
          'fly-client-ip': '203.0.113.10',
          'x-forwarded-for': '198.51.100.1, 203.0.113.10',
          'x-real-ip': '192.0.2.1',
        },
      }),
    ),
  ).toBe('203.0.113.10');
  expect(
    clientIpFromRequest(
      new Request('https://nuni.tw/api/fn/signInPuStudentId', {
        headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9', 'x-real-ip': '192.0.2.1' },
      }),
    ),
  ).toBe('unknown');
});
