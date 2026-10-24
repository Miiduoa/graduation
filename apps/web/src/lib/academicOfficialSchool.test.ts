import { expect, it } from 'vitest';
import {
  isOfficialAcademicSchool,
  OFFICIAL_ACADEMIC_SCHOOL_ID,
} from './academicOfficialSchool';

it('only canonical pu is an official academic school', () => {
  expect(isOfficialAcademicSchool(OFFICIAL_ACADEMIC_SCHOOL_ID)).toBe(true);
  expect(isOfficialAcademicSchool('pu')).toBe(true);
  expect(isOfficialAcademicSchool('tw-pu')).toBe(false);
  expect(isOfficialAcademicSchool('nthu')).toBe(false);
  expect(isOfficialAcademicSchool('all')).toBe(false);
  expect(isOfficialAcademicSchool(null)).toBe(false);
  expect(isOfficialAcademicSchool(undefined)).toBe(false);
});
