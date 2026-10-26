import { expect, it } from 'vitest';
import {
  assertOnlyProvidence,
  buildPuStudentEmail,
  buildPuStudentUid,
  buildPuTeacherUid,
  canonicalizePuStudentId,
  isPuStudentId,
  isPuTeacherAccount,
  normalizePuStudentId,
} from './puIdentity';

it('accepts 9 or 10 digit Providence student ids', () => {
  expect(isPuStudentId(normalizePuStudentId('1110700321'))).toBe(true);
  expect(isPuStudentId('099123456')).toBe(true);
  expect(isPuStudentId('11107003')).toBe(false);
  expect(isPuStudentId('A110700321')).toBe(false);
  expect(isPuStudentId('')).toBe(false);
});

it('canonicalizes s-prefixed and pu.edu.tw student ids to digits', () => {
  expect(canonicalizePuStudentId('1110700321')).toBe('1110700321');
  expect(canonicalizePuStudentId('s1110700321')).toBe('1110700321');
  expect(canonicalizePuStudentId('S099123456')).toBe('099123456');
  expect(canonicalizePuStudentId('1110700321@pu.edu.tw')).toBe('1110700321');
  expect(canonicalizePuStudentId('S1110700321@PU.EDU.TW')).toBe('1110700321');
  expect(canonicalizePuStudentId('changyi')).toBeNull();
  expect(canonicalizePuStudentId('T0000001')).toBeNull();
  expect(canonicalizePuStudentId('s12345678')).toBeNull();
  expect(canonicalizePuStudentId('1110700321@o365st.pu.edu.tw')).toBeNull();
});

it('accepts faculty accounts that are not student ids', () => {
  expect(isPuTeacherAccount('changyi')).toBe(true);
  expect(isPuTeacherAccount('T0000001')).toBe(true);
  expect(isPuTeacherAccount('1110700321')).toBe(false);
  expect(isPuTeacherAccount('s1110700321')).toBe(false);
  expect(isPuTeacherAccount('S1110700321@pu.edu.tw')).toBe(false);
  expect(isPuTeacherAccount('ab')).toBe(true);
  expect(isPuTeacherAccount('a')).toBe(false);
});

it('builds stable Firebase uids and emails', () => {
  expect(buildPuStudentUid('1110700321')).toBe('pu-1110700321');
  expect(buildPuStudentEmail('1110700321')).toBe('1110700321@pu.edu.tw');
  expect(buildPuTeacherUid('ChangYi')).toBe('pu-t-changyi');
});

it('rejects schools other than pu', () => {
  expect(() => assertOnlyProvidence('ntpu')).toThrow('only-pu');
  expect(() => assertOnlyProvidence('pu')).not.toThrow();
  expect(() => assertOnlyProvidence(undefined)).not.toThrow();
});
