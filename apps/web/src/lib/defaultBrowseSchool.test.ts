import { expect, it } from 'vitest';
import { DEFAULT_BROWSE_SCHOOL_ID, defaultBrowseSchoolId, fallbackBusSchool } from './defaultBrowseSchool';

it('uses Providence only when the person has not chosen a campus and Providence is in the directory', () => {
  expect(defaultBrowseSchoolId(['pu', 'nthu'], undefined, false, null)).toBe('pu');
  expect(defaultBrowseSchoolId(['nthu'], undefined, false, null)).toBeNull();
  expect(DEFAULT_BROWSE_SCHOOL_ID).toBe('pu');
});

it('keeps an explicit all-campus or saved choice instead of mixing in Providence', () => {
  expect(defaultBrowseSchoolId(['pu', 'nthu'], 'all', false, null)).toBeNull();
  expect(defaultBrowseSchoolId(['pu', 'nthu'], 'nthu', false, 'pu')).toBe('nthu');
  expect(defaultBrowseSchoolId(['pu', 'nthu'], undefined, true, 'nthu')).toBe('nthu');
  expect(defaultBrowseSchoolId(['pu', 'nthu'], undefined, true, null)).toBeNull();
});

it('opens Providence buses when no campus is chosen, and leaves another school alone', () => {
  expect(fallbackBusSchool(null, '', 'unselected')).toEqual({
    schoolId: 'pu',
    schoolName: '靜宜大學',
  });
  expect(fallbackBusSchool('nthu', '國立清華大學', 'ready')).toEqual({
    schoolId: 'nthu',
    schoolName: '國立清華大學',
  });
  expect(fallbackBusSchool(null, '', 'loading')).toEqual({ schoolId: null, schoolName: '' });
});
