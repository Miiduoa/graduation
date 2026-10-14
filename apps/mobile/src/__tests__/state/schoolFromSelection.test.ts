import { mergeSchoolSelection, schoolFromSelection } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({}).id).toBe('pu');
});

test('a code-only change resolves the new school without keeping the last ID', () => {
  const previous = { code: 'PU', schoolId: 'pu', schoolName: '靜宜大學' };
  expect(mergeSchoolSelection(previous, { code: 'NTHU' })).toMatchObject({
    code: 'NTHU',
    schoolId: 'nthu',
    schoolName: '國立清華大學',
  });
  expect(mergeSchoolSelection(previous, { code: 'NOT-A-SCHOOL' })).toEqual(previous);
});

test('unknown or ambiguous codes never select a demonstration school', () => {
  const previous = { code: 'PU', schoolId: 'pu', schoolName: '靜宜大學' };
  expect(mergeSchoolSelection(previous, { code: 'TCU' })).toEqual(previous);
  expect(schoolFromSelection({ code: 'INVALID' }).id).toBe('pu');
});
