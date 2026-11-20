// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  PU_ECAMPUS_DATA_PAUSED_CODE,
  PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} from '@campus/shared/src/puEcampusDataPolicy';
import { createPuCampusGateway, isTransientCampusError } from './puCampusClient';
import { handleSignInPuStudentId } from './signInPuStudentId';
import { createLoginRateGate, LOGIN_RATE_LIMIT } from './loginRateLimit';
import { createMemoryGroupStore } from './memoryGroupStore';

it.each([undefined, 'https://portal.test'])('blocks portal login and existing-session reads before fetch (%s)', async (portalOrigin) => {
  const fetch = vi.fn(async () => new Response('must not be requested'));
  const gateway = createPuCampusGateway({ fetch, portalOrigin });
  const paused = {
    kind: 'paused',
    code: PU_ECAMPUS_DATA_PAUSED_CODE,
    message: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
  };

  await expect(gateway.loginStudent('1110700321', 'unused-password')).rejects.toMatchObject(paused);
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'existing-session' })).rejects.toMatchObject(paused);
  expect(fetch).not.toHaveBeenCalled();
  expect(isTransientCampusError(await gateway.loginStudent('1110700321', 'unused').catch(error => error))).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves independent TronClass reads while the e-campus policy is paused', async () => {
  const fetch = vi.fn(async (url: string) => {
    expect(url).toBe('https://tronclass.pu.edu.tw/api/my-courses');
    return new Response(JSON.stringify({
      courses: [{ name: '資料庫', role: 'student', teachers: [{ name: '王老師' }] }],
    }), { headers: { 'Content-Type': 'application/json' } });
  });
  const gateway = createPuCampusGateway({ fetch });

  await expect(gateway.fetchTronClassCourses({
    cookies: { session: 'lms-session' }, userId: 1, userName: '測試同學', role: 'student',
  })).resolves.toEqual([{ name: '資料庫', role: 'student', teachers: [{ name: '王老師' }] }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe('https://tronclass.pu.edu.tw/api/my-courses');
});

it('returns an explicit pause without retrying credentials, creating sessions or exhausting the account limit', async () => {
  const fetch = vi.fn(async () => new Response('must not be requested'));
  const gateway = createPuCampusGateway({ fetch });
  const login = vi.spyOn(gateway, 'loginStudent');
  const signCustomToken = vi.fn(async () => 'must-not-mint');
  const store = createMemoryGroupStore();
  const runtime = {
    db: store.db,
    campus: gateway,
    signCustomToken,
    rateLimitGate: createLoginRateGate(),
    rateLimitSalt: 'test-paused-policy',
  };

  for (let attempt = 0; attempt <= LOGIN_RATE_LIMIT.account.limit; attempt += 1) {
    await expect(handleSignInPuStudentId(
      { studentId: '1110700321', password: 'unused-password', schoolId: 'pu' },
      `10.20.0.${attempt + 1}`,
      runtime,
    )).rejects.toMatchObject({
      status: 503, code: PU_ECAMPUS_DATA_PAUSED_CODE, message: PU_ECAMPUS_DATA_PAUSED_MESSAGE,
    });
  }

  expect(login).toHaveBeenCalledTimes(LOGIN_RATE_LIMIT.account.limit + 1);
  expect(fetch).not.toHaveBeenCalled();
  expect(signCustomToken).not.toHaveBeenCalled();
  expect([...store.docs.keys()].some(path => /^(users|_puSessions|_puTronClassSessions)\//.test(path))).toBe(false);
});
