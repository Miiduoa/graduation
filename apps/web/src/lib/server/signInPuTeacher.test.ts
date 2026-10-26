// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resetLoginRateLimitForTests } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import type { PuCampusGateway } from './puCampusClient';
import { handleSignInPuStudentId } from './signInPuStudentId';

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
    },
  };
}

beforeEach(() => {
  resetLoginRateLimitForTests();
});

afterEach(() => {
  resetLoginRateLimitForTests();
});

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
