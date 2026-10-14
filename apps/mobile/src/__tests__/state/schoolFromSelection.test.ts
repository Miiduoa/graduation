import { schoolFromSelection, schoolIdForUpdate } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({}).id).toBe('pu');
});


test('code-only campus switching replaces the old canonical school ID', () => {
  expect(schoolIdForUpdate('pu', { code: 'NTHU' })).toBe('nthu');
  expect(schoolIdForUpdate('nthu', { code: 'PU' })).toBe('pu');
  expect(schoolIdForUpdate('pu', { schoolId: 'ntu', code: 'NTU' })).toBe('ntu');
  expect(schoolIdForUpdate('pu', { code: 'TCU' })).toBeNull();
  expect(schoolIdForUpdate('pu', {})).toBe('pu');
});
