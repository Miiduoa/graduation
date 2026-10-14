import { mergeSchoolSelection, schoolFromSelection } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({}).id).toBe('pu');
});

test('selecting a new school by code replaces the previous school ID', () => {
  const previous = mergeSchoolSelection({ code: 'PU', schoolId: 'pu' }, {});
  expect(mergeSchoolSelection(previous, { code: 'NTHU' })).toMatchObject({
    code: 'NTHU',
    schoolId: 'nthu',
    schoolName: '國立清華大學',
  });
  expect(mergeSchoolSelection(previous, { schoolId: 'nccu' })).toMatchObject({
    code: 'NCCU',
    schoolId: 'nccu',
  });
  expect(mergeSchoolSelection(previous, { schoolName: '任意名稱' }).schoolName)
    .toBe('靜宜大學');
});

test('initial selection from code alone resolves the requested campus', () => {
  const preference = mergeSchoolSelection({ code: 'PU', schoolId: 'pu' }, { code: 'THU' });
  expect(preference.schoolId).toBe('thu');
  expect(preference.code).toBe('THU');
});
