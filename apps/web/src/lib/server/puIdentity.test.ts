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
  providenceAlcatUidCandidates,
} from './puIdentity';

it('accepts 7 to 10 digit Providence student ids', () => {
  expect(isPuStudentId(normalizePuStudentId('1110700321'))).toBe(true);
  expect(isPuStudentId('099123456')).toBe(true);
  expect(isPuStudentId('7654321')).toBe(true);
  expect(isPuStudentId('87654321')).toBe(true);
  expect(isPuStudentId('111070')).toBe(false);
  expect(isPuStudentId('A110700321')).toBe(false);
  expect(isPuStudentId('')).toBe(false);
});

it('canonicalizes s-prefixed and pu.edu.tw student ids to digits', () => {
  expect(canonicalizePuStudentId('1110700321')).toBe('1110700321');
  expect(canonicalizePuStudentId('s1110700321')).toBe('1110700321');
  expect(canonicalizePuStudentId('S099123456')).toBe('099123456');
  expect(canonicalizePuStudentId('7654321')).toBe('7654321');
  expect(canonicalizePuStudentId('s7654321')).toBe('7654321');
  expect(canonicalizePuStudentId('S7654321')).toBe('7654321');
  expect(canonicalizePuStudentId('87654321')).toBe('87654321');
  expect(canonicalizePuStudentId('s87654321')).toBe('87654321');
  expect(canonicalizePuStudentId('1110700321@pu.edu.tw')).toBe('1110700321');
  expect(canonicalizePuStudentId('S1110700321@PU.EDU.TW')).toBe('1110700321');
  expect(canonicalizePuStudentId('s7654321@pu.edu.tw')).toBe('7654321');
  expect(canonicalizePuStudentId('changyi')).toBeNull();
  expect(canonicalizePuStudentId('T0000001')).toBeNull();
  expect(canonicalizePuStudentId('s123456')).toBeNull();
  expect(canonicalizePuStudentId('1110700321@o365st.pu.edu.tw')).toBeNull();
});

it('accepts faculty accounts that are not student ids', () => {
  expect(isPuTeacherAccount('changyi')).toBe(true);
  expect(isPuTeacherAccount('T0000001')).toBe(true);
  expect(isPuTeacherAccount('1110700321')).toBe(false);
  expect(isPuTeacherAccount('s1110700321')).toBe(false);
  expect(isPuTeacherAccount('S1110700321@pu.edu.tw')).toBe(false);
  expect(isPuTeacherAccount('s7654321')).toBe(false);
  expect(isPuTeacherAccount('7654321')).toBe(false);
  expect(isPuTeacherAccount('ab')).toBe(true);
  expect(isPuTeacherAccount('a')).toBe(false);
});

it('builds stable Firebase uids from the digit form', () => {
  expect(buildPuStudentUid('1110700321')).toBe('pu-1110700321');
  expect(buildPuStudentUid(canonicalizePuStudentId('s7654321')!)).toBe('pu-7654321');
  expect(buildPuStudentUid(canonicalizePuStudentId('7654321')!)).toBe('pu-7654321');
  expect(buildPuStudentEmail('1110700321')).toBe('1110700321@pu.edu.tw');
  expect(buildPuTeacherUid('ChangYi')).toBe('pu-t-changyi');
});

it('sends the typed alcat uid first and offers the other s/digit form once', () => {
  expect(providenceAlcatUidCandidates('s7654321')).toEqual(['s7654321', '7654321']);
  expect(providenceAlcatUidCandidates('S7654321')).toEqual(['s7654321', '7654321']);
  expect(providenceAlcatUidCandidates('7654321')).toEqual(['7654321', 's7654321']);
  expect(providenceAlcatUidCandidates('s7654321@pu.edu.tw')).toEqual(['s7654321', '7654321']);
  expect(providenceAlcatUidCandidates('1110700321')).toEqual(['1110700321', 's1110700321']);
  expect(providenceAlcatUidCandidates('changyi')).toEqual([]);
  expect(providenceAlcatUidCandidates('s7654321')).toHaveLength(2);
});

it('rejects schools other than pu', () => {
  expect(() => assertOnlyProvidence('ntpu')).toThrow('only-pu');
  expect(() => assertOnlyProvidence('pu')).not.toThrow();
  expect(() => assertOnlyProvidence(undefined)).not.toThrow();
});
