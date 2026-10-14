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

test('a directory school outside the built-in list stays selected by its unique ID', () => {
  const remote = {
    schoolId: 'tw-new-university',
    code: 'NEWU',
    schoolName: '新大學',
    shortName: '新大',
    themeColor: '#123456',
  };
  const selected = mergeSchoolSelection({ code: 'PU', schoolId: 'pu' }, remote);
  expect(selected).toMatchObject(remote);
  expect(schoolFromSelection(selected)).toMatchObject({ id: 'tw-new-university', name: '新大學' });
  expect(mergeSchoolSelection(selected, { schoolName: '更新別名' }).schoolId).toBe('tw-new-university');
  expect(mergeSchoolSelection(selected, { code: 'PU' }).schoolId).toBe('pu');
});
