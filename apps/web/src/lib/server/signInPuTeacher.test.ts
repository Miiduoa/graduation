// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createLoginRateGate, LOGIN_RATE_LIMIT } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createPuCampusGateway, PuCampusError, type PuCampusGateway } from './puCampusClient';
import {
  handleSignInPuStudentId,
  TEACHER_LMS_UNAVAILABLE,
  TEACHER_LMS_UNAVAILABLE_CODE,
} from './signInPuStudentId';

const SECRET = 'never-log-this-password';
const TEACHER = 'changyi';

function campus(overrides: Partial<PuCampusGateway> = {}): PuCampusGateway {
  return {
    loginStudent: async () => ({ cookies: { PHPSESSID: 'stu-cookie' } }),
    fetchStudentInfo: async () => ({}),
    loginTronClass: async () => ({
      cookies: { session: 'tc' },
      userId: 44,
      userName: '王老師',
      role: 'teacher',
    }),
    fetchTronClassCourses: async () => [
      { name: '資料庫', role: 'teacher', teachers: [{ name: '王老師' }] },
    ],
    ...overrides,
  };
}

function deps(options?: {
  store?: ReturnType<typeof createMemoryGroupStore>;
  campus?: PuCampusGateway;
}) {
  const store = options?.store ?? createMemoryGroupStore();
  return {
    store,
    runtime: {
      db: store.db,
      campus: options?.campus ?? campus(),
      signCustomToken: async (uid: string, claims: Record<string, string>) =>
        `token:${uid}:${claims.role}:${claims.schoolId}`,
      rateLimitGate: createLoginRateGate(),
      rateLimitSalt: 'test-rate-limit-salt',
    },
  };
}

it('lets a TronClass teacher in and unions teacherUids without wiping others', async () => {
  const store = createMemoryGroupStore([
    [
      'schools/pu/courseTeachers/資料庫｜王老師',
      { teacherUids: ['existing-teacher'], note: 'keep' },
    ],
    ['schools/pu/members/pu-t-changyi', { role: 'admin', status: 'active', extra: 1 }],
  ]);
  const { runtime } = deps({ store });
  const result = await handleSignInPuStudentId(
    { studentId: TEACHER, password: SECRET, role: 'student' },
    '7.7.7.7',
    runtime,
  );
  expect(result).toMatchObject({
    uid: 'pu-t-changyi',
    customToken: 'token:pu-t-changyi:admin:pu',
    role: 'admin',
  });
  expect(store.docs.get('schools/pu/courseTeachers/資料庫｜王老師')).toMatchObject({
    teacherUids: ['existing-teacher', 'pu-t-changyi'],
    note: 'keep',
  });
  expect(store.docs.get('schools/pu/members/pu-t-changyi')).toMatchObject({
    role: 'admin',
    extra: 1,
    status: 'active',
  });
});

it('does not let a TronClass student claim to be a teacher', async () => {
  const { runtime, store } = deps({
    campus: campus({
      loginTronClass: async () => ({
        cookies: { session: 'tc' },
        userId: 8,
        userName: '冒充',
        role: 'student',
      }),
      fetchTronClassCourses: async () => [
        { name: '資料庫', role: 'student', teachers: [{ name: '王老師' }] },
      ],
    }),
  });
  await expect(
    handleSignInPuStudentId(
      { studentId: TEACHER, password: SECRET, role: 'teacher' },
      '8.8.8.8',
      runtime,
    ),
  ).rejects.toMatchObject({ status: 403, message: '此帳號沒有教師或校管身分' });
  expect([...store.docs.keys()].some((path) => path.startsWith('schools/pu/courseTeachers/'))).toBe(
    false,
  );
});

it('rejects a TronClass 200 that did not actually create a session', async () => {
  const { runtime, store } = deps({
    campus: campus({
      loginTronClass: async () => ({
        cookies: {},
        userId: 44,
        userName: '王老師',
        role: 'teacher',
      }),
    }),
  });
  await expect(
    handleSignInPuStudentId({ studentId: TEACHER, password: SECRET }, '8.8.8.9', runtime),
  ).rejects.toMatchObject({ status: 401, message: '學號或密碼錯誤' });
  expect(store.docs.get('schools/pu/courseTeachers/資料庫｜王老師')).toBeUndefined();
});

it('only adds the signed-in teacher to 課名｜自己的名字 on a co-taught course', async () => {
  const store = createMemoryGroupStore([
    ['schools/pu/courseTeachers/資料庫｜李老師', { teacherUids: ['pu-t-lee'], note: 'keep' }],
  ]);
  const { runtime } = deps({
    store,
    campus: campus({
      loginTronClass: async () => ({
        cookies: { session: 'tc' },
        userId: 44,
        userName: '王老師',
        role: 'teacher',
      }),
      fetchTronClassCourses: async () => [
        {
          name: '資料庫',
          role: 'teacher',
          teachers: [{ name: '王老師' }, { name: '李老師' }],
        },
      ],
    }),
  });
  const result = await handleSignInPuStudentId(
    { studentId: TEACHER, password: SECRET },
    '7.7.7.8',
    runtime,
  );
  expect(result).toMatchObject({
    uid: 'pu-t-changyi',
    displayName: '王老師',
    offerings: ['資料庫｜王老師'],
  });
  expect(store.docs.get('schools/pu/courseTeachers/資料庫｜王老師')).toMatchObject({
    teacherUids: ['pu-t-changyi'],
  });
  expect(store.docs.get('schools/pu/courseTeachers/資料庫｜李老師')).toMatchObject({
    teacherUids: ['pu-t-lee'],
    note: 'keep',
  });
});

it('returns 503 when TronClass is down and refunds the account debit', async () => {
  const loginTronClass = async () => {
    throw new PuCampusError('timeout', '學校系統無回應');
  };
  const { runtime } = deps({ campus: campus({ loginTronClass }) });
  for (let i = 0; i < LOGIN_RATE_LIMIT.account.limit + 1; i += 1) {
    await expect(
      handleSignInPuStudentId({ studentId: TEACHER, password: SECRET }, `10.0.0.${i + 1}`, runtime),
    ).rejects.toMatchObject({
      status: 503,
      message: TEACHER_LMS_UNAVAILABLE,
      code: TEACHER_LMS_UNAVAILABLE_CODE,
    });
  }
});

it('does not mint a token when login echoes user_name but profile cannot verify the account', async () => {
  const mint = vi.fn(async () => 'should-not-mint');
  const gateway = createPuCampusGateway({
    fetch: async (url: string) => {
      if (String(url).endsWith('/api/login')) {
        return new Response(JSON.stringify({ id: 44, name: '王老師', role: 'teacher', user_name: TEACHER }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'set-cookie': 'session=tc-cookie; Path=/' },
        });
      }
      if (String(url).endsWith('/api/profile')) {
        return new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ courses: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const { runtime } = deps({ campus: gateway });
  await expect(
    handleSignInPuStudentId({ studentId: TEACHER, password: SECRET }, '8.8.8.7', {
      ...runtime,
      signCustomToken: mint,
    }),
  ).rejects.toMatchObject({ status: 503, message: '暫時無法驗證老師身分' });
  expect(mint).not.toHaveBeenCalled();
});
