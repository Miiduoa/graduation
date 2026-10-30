// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLoginRateGate } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';
import { createPuCampusGateway, type PuCampusGateway, type TronClassSession } from './puCampusClient';
import { resetCampusCircuitForTests } from './puCampusCircuit';
import { handleSignInPuStudentId, STUDENT_ROLE_REJECTED } from './signInPuStudentId';
import { isEcampusFetchPausedForLogin, isStudentLoginViaTronClass } from './studentLoginSwitches';

const STUDENT = '1110700321';
const SECRET = 'never-log-this-password';

function studentTronClass(account: string = STUDENT, extra: Partial<TronClassSession> = {}): TronClassSession {
  return {
    cookies: { session: 'tc-cookie' },
    userId: 9,
    userName: '陳同學',
    role: 'student',
    profile: { login_name: account, role: 'student', name: '陳同學' },
    ...extra,
  };
}

function mockCampus(overrides: Partial<PuCampusGateway> = {}) {
  const loginStudent = vi.fn(async () => ({ cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' }));
  const loginTronClass = vi.fn(async (account: string) => studentTronClass(account));
  const fetchStudentInfo = vi.fn(async () => ({}));
  const campus: PuCampusGateway = {
    loginStudent,
    loginTronClass,
    fetchStudentInfo,
    fetchTronClassCourses: async () => [],
    ...overrides,
  } as PuCampusGateway;
  return { campus, loginStudent, loginTronClass, fetchStudentInfo };
}

function runtimeFor(campus: PuCampusGateway, store = createMemoryGroupStore()) {
  const scheduled: Array<() => Promise<void>> = [];
  return {
    store,
    scheduled,
    flush: async () => {
      while (scheduled.length > 0) {
        const tasks = scheduled.splice(0, scheduled.length);
        await Promise.all(tasks.map((task) => task()));
      }
    },
    runtime: {
      db: store.db,
      campus,
      signCustomToken: async (uid: string, claims: Record<string, string>) =>
        `token:${uid}:${claims.role}:${claims.schoolId}`,
      rateLimitGate: createLoginRateGate(),
      rateLimitSalt: 'test-rate-limit-salt',
      scheduleCampusSso: (task: () => Promise<void>) => {
        scheduled.push(task);
      },
    },
  };
}

function keys(store: ReturnType<typeof createMemoryGroupStore>, prefix: string): string[] {
  return [...store.docs.keys()].filter((path) => path.startsWith(prefix));
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** 真的 gateway＋假的 fetch：記錄每個請求的主機，用來證明有沒有碰 alcat／mypu。 */
function recordingGateway() {
  const hosts: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const href = String(url);
    hosts.push(new URL(href).hostname);
    if (href.endsWith('/api/login')) {
      return jsonResponse(200, { id: 9 }, { 'set-cookie': 'session=tc-cookie; Path=/' });
    }
    if (href.endsWith('/api/profile')) {
      return jsonResponse(200, { id: 9, name: '陳同學', login_name: STUDENT, role: 'student' });
    }
    return new Response('<html>alcat</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  });
  return { hosts, gateway: createPuCampusGateway({ fetch: fetchMock }) };
}

const ECAMPUS_HOSTS = new Set(['alcat.pu.edu.tw', 'mypu.pu.edu.tw']);

beforeEach(() => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '');
  vi.stubEnv('PU_ECAMPUS_FETCH_PAUSED', '');
});

afterEach(() => {
  resetCampusCircuitForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('turns the switches on only for 1 or true', () => {
  for (const value of ['1', 'true', 'TRUE', ' True ']) {
    expect(isStudentLoginViaTronClass({ PU_STUDENT_LOGIN_VIA_TRONCLASS: value })).toBe(true);
    expect(isEcampusFetchPausedForLogin({ PU_ECAMPUS_FETCH_PAUSED: value })).toBe(true);
  }
  for (const value of [undefined, '', '0', 'false', 'yes', 'on']) {
    expect(isStudentLoginViaTronClass({ PU_STUDENT_LOGIN_VIA_TRONCLASS: value })).toBe(false);
    expect(isEcampusFetchPausedForLogin({ PU_ECAMPUS_FETCH_PAUSED: value })).toBe(false);
  }
});

it.each(['', '0', 'false', 'yes'])('keeps the old alcat login flow when the switch is %j', async (value) => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', value);
  const { campus, loginStudent, loginTronClass } = mockCampus();
  const { runtime, store, flush } = runtimeFor(campus);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(loginStudent).toHaveBeenCalledTimes(1);
  expect(loginTronClass).not.toHaveBeenCalled();
  expect(result).toMatchObject({ success: true, tronClassSessionId: null, tronClassOk: false });
  expect(typeof result.puSessionId).toBe('string');
  expect(keys(store, '_puSessions/')).toHaveLength(1);
  await flush();
  expect(loginTronClass).toHaveBeenCalledTimes(1);
  expect((loginTronClass.mock.calls[0] as unknown[] | undefined)?.[2]).toMatchObject({ route: 'student' });
});

it('does not call alcat during login when the switch is on', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  const { campus, loginStudent, loginTronClass } = mockCampus();
  const { runtime, flush } = runtimeFor(campus);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ success: true, tronClassOk: true, puSessionId: null });
  expect(loginTronClass).toHaveBeenCalledTimes(1);
  expect(loginStudent).not.toHaveBeenCalled();
  await flush();
  expect(loginStudent).toHaveBeenCalledTimes(1);
});

it('sends no request to alcat while signing in when the switch is on (real gateway)', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', 'true');
  const { hosts, gateway } = recordingGateway();
  const { runtime } = runtimeFor(gateway);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ success: true, tronClassOk: true });
  expect(hosts.length).toBeGreaterThan(0);
  expect(hosts.filter((host) => ECAMPUS_HOSTS.has(host))).toEqual([]);
});

it('sends zero alcat/mypu requests in the whole flow, background included, when switched on and paused', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  vi.stubEnv('PU_ECAMPUS_FETCH_PAUSED', 'true');
  const { hosts, gateway } = recordingGateway();
  const { runtime, store, flush, scheduled } = runtimeFor(gateway);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(result).toMatchObject({ success: true, tronClassOk: true, puSessionId: null });
  expect(scheduled.length).toBeGreaterThan(0);
  await flush();
  expect(hosts.filter((host) => ECAMPUS_HOSTS.has(host))).toEqual([]);
  expect(hosts.every((host) => host === 'tronclass.pu.edu.tw' || host === 'identity.pu.edu.tw')).toBe(true);
  expect(keys(store, '_puSessions/')).toEqual([]);
});

it('does hit alcat in the background when switched on but not paused (control)', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  const { hosts, gateway } = recordingGateway();
  const { runtime, flush } = runtimeFor(gateway);
  await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  expect(hosts.filter((host) => ECAMPUS_HOSTS.has(host))).toEqual([]);
  await flush();
  expect(hosts).toContain('alcat.pu.edu.tw');
});

it.each(['teacher', 'assistant', 'admin', 'guest', 'students'])(
  'rejects TronClass role %j on the student route',
  async (role) => {
    vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
    const { campus, loginStudent } = mockCampus({
      loginTronClass: vi.fn(async (account: string) =>
        studentTronClass(account, { role, profile: { login_name: account, role, name: '某人' } }),
      ),
    });
    const { runtime, store, scheduled } = runtimeFor(campus);
    await expect(
      handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime),
    ).rejects.toMatchObject({ status: 403, message: STUDENT_ROLE_REJECTED });
    expect(loginStudent).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    expect(keys(store, '_puTronClassSessions/')).toEqual([]);
    expect(keys(store, '_puSessions/')).toEqual([]);
  },
);

it('does not write _puSessions when the user logged out before the background step', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  const { campus, loginStudent } = mockCampus();
  const { runtime, store, flush } = runtimeFor(campus);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  store.docs.delete(`_puTronClassSessions/${result.tronClassSessionId}`);
  await flush();
  expect(loginStudent).not.toHaveBeenCalled();
  expect(keys(store, '_puSessions/')).toEqual([]);
});

it('does not write _puSessions when the user logs out while alcat is still answering', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  let tronClassSessionId = '';
  const store = createMemoryGroupStore();
  const loginStudent = vi.fn(async () => {
    store.docs.delete(`_puTronClassSessions/${tronClassSessionId}`);
    return { cookies: { PHPSESSID: 'stu-cookie' }, studentName: '陳同學' };
  });
  const { campus } = mockCampus({ loginStudent });
  const { runtime, flush } = runtimeFor(campus, store);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  tronClassSessionId = String(result.tronClassSessionId);
  await flush();
  expect(loginStudent).toHaveBeenCalledTimes(1);
  expect(keys(store, '_puSessions/')).toEqual([]);
});

it('still links _puSessions when the TronClass session is owned and alive', async () => {
  vi.stubEnv('PU_STUDENT_LOGIN_VIA_TRONCLASS', '1');
  const { campus } = mockCampus();
  const { runtime, store, flush } = runtimeFor(campus);
  const result = await handleSignInPuStudentId({ studentId: STUDENT, password: SECRET }, '1.1.1.1', runtime);
  await flush();
  const portal = keys(store, '_puSessions/');
  expect(portal).toHaveLength(1);
  expect(store.docs.get(portal[0]!)).toMatchObject({
    ownerUid: 'pu-1110700321',
    tronClassSessionId: result.tronClassSessionId,
  });
});

it('stops before CAS when TronClass /api/login explicitly rejects the student password', async () => {
  const hosts: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    hosts.push(new URL(String(url)).hostname);
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(401, { message: 'Invalid username or password' });
    }
    return new Response('<form action="/login"></form>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass(STUDENT, SECRET, { route: 'student' })).rejects.toMatchObject({
    kind: 'credentials',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(hosts).toEqual(['tronclass.pu.edu.tw']);
});
