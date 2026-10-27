import { expect, it, vi } from 'vitest';
import {
  getSchoolLoginConfig,
  isSchoolLoginOffered,
  matchSchoolLoginAccount,
  schoolLoginAccountScope,
  schoolLoginConfigAcceptsSignIn,
  schoolLoginHasAdapter,
  schoolLoginIpScope,
} from './schoolLoginConfig';
import { writeSchoolLoginProfile } from './schoolLoginProfile';

it('keeps Providence as the only open school with the current adapters', () => {
  const pu = getSchoolLoginConfig('pu');
  expect(pu).toMatchObject({
    schoolId: 'pu',
    status: 'open',
    studentAdapter: 'form-password',
    teacherAdapter: 'lms-password',
    teacherProof: 'tronclass-profile',
    endpoints: {
      portal: 'https://alcat.pu.edu.tw',
      lms: 'https://tronclass.pu.edu.tw',
    },
    uid: { studentPrefix: 'pu-', teacherPrefix: 'pu-t-' },
    emailDomain: 'pu.edu.tw',
    membershipSchoolId: 'pu',
  });
  expect(schoolLoginConfigAcceptsSignIn(pu)).toBe(true);
  expect(schoolLoginHasAdapter(pu!, 'student')).toBe(true);
  expect(schoolLoginHasAdapter(pu!, 'teacher')).toBe(true);
  expect(schoolLoginAccountScope('pu')).toBe('school-login-pu-account');
  expect(schoolLoginIpScope('pu')).toBe('school-login-pu-ip');
  expect(matchSchoolLoginAccount(pu!, '1110700321')).toBe('student');
  expect(matchSchoolLoginAccount(pu!, '7654321')).toBe('student');
  expect(matchSchoolLoginAccount(pu!, '87654321')).toBe('student');
  expect(matchSchoolLoginAccount(pu!, 'changyi')).toBe('teacher');
  expect(matchSchoolLoginAccount(pu!, 'T0000001')).toBe('teacher');
});

it('treats omitted schoolId as Providence and unknown ids as unavailable', () => {
  expect(getSchoolLoginConfig(undefined)?.schoolId).toBe('pu');
  expect(getSchoolLoginConfig('')?.schoolId).toBe('pu');
  expect(getSchoolLoginConfig('ntu')).toBeNull();
  expect(getSchoolLoginConfig('no-such-school')).toBeNull();
  expect(isSchoolLoginOffered('pu')).toBe(true);
  expect(isSchoolLoginOffered('ntu')).toBe(false);
  expect(isSchoolLoginOffered('unknown-campus')).toBe(false);
});

it('never writes an explicitly unknown school login into Providence membership', async () => {
  const doc = vi.fn();
  const runTransaction = vi.fn();
  const db = { doc, runTransaction } as unknown as Parameters<typeof writeSchoolLoginProfile>[0]['db'];
  const profile = { email: 'student@example.test', displayName: 'Student', role: 'student' };
  for (const schoolId of ['ntu', '../pu', 'nonexistent-university']) {
    await expect(
      writeSchoolLoginProfile({ db, uid: 'test-student', schoolId, profile }),
    ).rejects.toThrow('school-login-unavailable');
  }
  expect(doc).not.toHaveBeenCalled();
  expect(runTransaction).not.toHaveBeenCalled();
});
