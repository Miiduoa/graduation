import { schoolFromSelection } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({}).id).toBe('pu');
});

test('changing only the school code does not keep Providence or silently choose a demo university', () => {
  expect(schoolFromSelection({ code: 'NTHU', schoolId: null }).id).toBe('nthu');
  expect(schoolFromSelection({ code: 'NTU' }).id).toBe('ntu');
  expect(schoolFromSelection({ code: 'NOT_A_SCHOOL' }).id).toBe('pu');
  expect(schoolFromSelection({ code: 'TCU' }).id).toBe('pu');
});

test('a new directory tenant does not silently inherit another university identity', () => {
  expect(schoolFromSelection({ schoolId: 'campus-b', schoolName: '乙校', code: 'PU' })).toMatchObject({
    id: 'campus-b',
    code: 'CAMPUS-B',
    name: '乙校',
  });
  expect(schoolFromSelection({ schoolId: 'campus-b', schoolName: '乙校', code: 'B' })).toMatchObject({
    id: 'campus-b',
    code: 'B',
    name: '乙校',
  });
});
