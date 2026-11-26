// @vitest-environment node
import { randomInt } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { expect, it, vi } from 'vitest';

import { dispatchFnRequest, type FnRuntime } from './fnDispatch';
import { LMS_FIXTURE_HOMEWORK_DONE, LMS_FIXTURE_HOMEWORK_OPEN } from './fixtures/tronclass-lms-readonly';
import { createLoginRateGate } from './loginRateLimit';
import type { LmsReadonlySource } from './tronClassLmsSource';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '';
const loopback = /^(?:127\.0\.0\.1|localhost):\d{1,5}$/;
const hasEmulators = loopback.test(authHost) && loopback.test(firestoreHost);

it.skipIf(!hasEmulators)('keeps student homework private and stops cached and fresh reads on disconnect', async () => {
  const projectId = 'demo-campus-school-pilot';
  const app = initializeApp({ projectId }, 'student-read-lifecycle');
  const studentA = String(randomInt(100000000, 499999999));
  const studentB = String(Number(studentA) + 1);
  const courseFor = (account: string) => Number(account) + 100;
  const schoolRead = vi.fn();
  const afterLogin: Array<() => Promise<void>> = [];

  vi.stubEnv('SCHOOL_STUDENT_ID_LOGIN_ENABLED', 'true');
  vi.stubEnv('SCHOOL_LMS_READONLY_ENABLED', 'true');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  try {
    const db = getFirestore(app);
    const auth = getAuth(app);
    // School and LMS are fixture providers. Every profile, token, session and cache uses the local SDKs.
    const unexpectedRead = async (): Promise<never> => {
      schoolRead();
      throw new Error('Unrequested school data');
    };
    const source: LmsReadonlySource = {
      fetchCourses: async (cookies, { userId, status }) => {
        schoolRead();
        expect(userId).toBe(Number(cookies.session));
        return status === 'ongoing' ? [{ id: courseFor(cookies.session), name: '試點課程' }] : [];
      },
      fetchHomeworkPage: async (cookies, courseId) => {
        schoolRead();
        expect(courseId).toBe(courseFor(cookies.session));
        return { ok: true, value: {
          homework_activities: [LMS_FIXTURE_HOMEWORK_OPEN, LMS_FIXTURE_HOMEWORK_DONE], total: 2,
        } };
      },
      fetchActivities: unexpectedRead,
      fetchCourseAnnouncements: unexpectedRead,
      fetchSiteAnnouncements: unexpectedRead,
    };
    const runtime: FnRuntime = {
      db: db as unknown as FnRuntime['db'],
      verifyIdToken: (token, checkRevoked) => auth.verifyIdToken(token, checkRevoked),
      createCustomToken: (uid, claims) => auth.createCustomToken(uid, claims),
      rateLimitSalt: 'local-lifecycle-' + studentA,
      rateLimitGate: createLoginRateGate(),
      scheduleCampusSso: (task) => { afterLogin.push(task); },
      puCampus: {
        loginStudent: async (account) => ({
          cookies: { portal: account }, studentId: account, studentName: '試點學生',
        }),
        loginTronClass: async (account) => ({
          cookies: { session: account }, userId: Number(account), userName: '試點學生', role: 'student',
        }),
        fetchStudentInfo: unexpectedRead,
        fetchTronClassCourses: unexpectedRead,
      },
      lmsReadonlySource: source,
    };
    function request(name: string, body: object, token?: string) {
      return dispatchFnRequest(name, new Request('http://localhost/api/fn/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
      }), runtime);
    }
    async function login(account: string, isNewUser: boolean) {
      const loginResponse = await request('signInPuStudentId', {
        schoolId: 'pu', studentId: account, password: 'local-fixture',
      });
      expect(loginResponse.status).toBe(200);
      const login = await loginResponse.json();
      expect(login).toMatchObject({ uid: 'pu-' + account, role: 'student', isNewUser });
      const exchange = await fetch(
        `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=local-test`,
        {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: login.customToken, returnSecureToken: true }),
        },
      );
      expect(exchange.status).toBe(200);
      const { idToken } = await exchange.json();
      expect(await auth.verifyIdToken(idToken)).toMatchObject({ uid: login.uid, schoolId: 'pu', role: 'student' });
      expect(afterLogin).toHaveLength(1);
      await afterLogin.shift()!();
      return idToken as string;
    }
    function read(token: string, refresh = false) {
      return request('getMyTronClassLms', { data: { refresh } }, token);
    }
    async function expectHomework(token: string, account: string, cacheHit: boolean, refresh = false) {
      const response = await read(token, refresh);
      expect(response.status).toBe(200);
      const { result } = await response.json();
      expect(result).toMatchObject({
        ownerUid: 'pu-' + account, source: 'pu-tronclass', cache: { hit: cacheHit }, courseErrors: [],
        courses: [{ id: courseFor(account) }],
        homework: [
          { courseId: courseFor(account), title: LMS_FIXTURE_HOMEWORK_OPEN.title, submitted: false },
          { courseId: courseFor(account), title: LMS_FIXTURE_HOMEWORK_DONE.title, submitted: true },
        ],
      });
    }

    const tokenA = await login(studentA, true);
    await login(studentA, false);
    const tokenB = await login(studentB, true);
    await expectHomework(tokenA, studentA, false);
    await expectHomework(tokenB, studentB, false);
    schoolRead.mockClear();
    await expectHomework(tokenA, studentA, true);
    const disconnected = await request('clearPuCampusSessions', { data: {} }, tokenA);
    expect(disconnected.status).toBe(200);
    expect((await disconnected.json()).result).toMatchObject({ success: true });
    for (const refresh of [false, true]) {
      const denied = await read(tokenA, refresh);
      expect(denied.status).toBe(400);
      expect(await denied.json()).toMatchObject({ error: { status: 'FAILED_PRECONDITION' } });
    }
    await expectHomework(tokenB, studentB, true);
    expect(schoolRead).not.toHaveBeenCalled();
    await expectHomework(tokenB, studentB, false, true);
    expect(schoolRead).toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    await deleteApp(app);
  }
}, 30_000);
