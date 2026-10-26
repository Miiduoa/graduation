import { expect, it } from 'vitest';
import {
  getSchoolLoginConfig,
  isSchoolLoginOffered,
  matchSchoolLoginAccount,
  schoolLoginAccountScope,
  schoolLoginConfigAcceptsSignIn,
  schoolLoginHasAdapter,
  schoolLoginIpScope,
} from './schoolLoginConfig';

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
  expect(matchSchoolLoginAccount(pu!, 'changyi')).toBe('teacher');
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
