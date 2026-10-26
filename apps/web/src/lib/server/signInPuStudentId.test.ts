// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeFirebaseCustomTokenPayload } from './firebaseCustomToken';
import { resetLoginRateLimitForTests } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import { PuCampusError, type PuCampusGateway } from './puCampusClient';
import { handleSignInPuStudentId, PuLoginHttpError } from './signInPuStudentId';

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
  return {
    store,
    runtime: {
      db: store.db,
      campus: options?.campus ?? campus(),
      signCustomToken: async (uid: string, claims: Record<string, string>) =>
        options?.token ?? `token:${uid}:${claims.role}:${claims.schoolId}`,
    },
  };
}

beforeEach(() => {
  resetLoginRateLimitForTests();
});

afterEach(() => {
  resetLoginRateLimitForTests();
  vi.restoreAllMocks();
});

it('returns a custom token and writes student profile fields without clobbering extras', async () => {
  const store = createMemoryGroupStore([
    ['users/pu-1110700321', { bio: 'keep-me', favoriteColor: 'blue' }],
  ]);
  const { runtime } = deps({ store });
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
    department: '資管三A',
    isNewUser: false,
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
});

it('rejects non-pu schools, invalid student ids, and missing fields', async () => {
  const { runtime } = deps();
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET, schoolId: 'ntpu' }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 400, message: '只接受靜宜大學帳號' });
  await expect(
    handleSignInPuStudentId({ studentId: '12', password: SECRET }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 400, message: '學號格式不正確' });
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT }, '1.1.1.1', runtime),
  ).rejects.toMatchObject({ status: 400, message: 'Missing required fields: studentId, password' });
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
  ).rejects.toMatchObject({ status: 504, message: '學校系統無回應' });

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

it('rate-limits repeated student attempts in this process', async () => {
  const { runtime } = deps({
    campus: campus({
      loginStudent: async () => {
        throw new PuCampusError('credentials', '學號或密碼錯誤');
      },
    }),
  });
  for (let i = 0; i < 5; i += 1) {
    await expect(
      handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.9', runtime),
    ).rejects.toMatchObject({ status: 401 });
  }
  await expect(
    handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '9.9.9.9', runtime),
  ).rejects.toMatchObject({ status: 429, message: 'Too many requests' });
});
