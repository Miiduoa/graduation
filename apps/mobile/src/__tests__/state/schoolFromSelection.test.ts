import { schoolFromSelection } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({})).toEqual({ id: '', code: '', name: '尚未選校' });
});

test('changing only the school code does not keep Providence or silently choose a demo university', () => {
  expect(schoolFromSelection({ code: 'NTHU', schoolId: null }).id).toBe('nthu');
  expect(schoolFromSelection({ code: 'NTU' }).id).toBe('ntu');
  expect(schoolFromSelection({ code: 'NOT_A_SCHOOL' }).id).toBe('');
  expect(schoolFromSelection({ code: 'TCU' }).id).toBe('');
  expect(schoolFromSelection({ schoolId: 'invalid/id', code: 'PU' }).id).toBe('');
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

test('unknown school IDs do not borrow an existing school code or untrusted login domains', () => {
  const school = schoolFromSelection({
    schoolId: 'remote-school-id',
    schoolName: '外部校園',
    code: 'NTHU',
    themeColor: '#123456',
    domains: ['nthu.edu.tw'],
  });
  expect(school.id).toBe('remote-school-id');
  expect(school.code).toBe('REMOTE-SCHOOL-ID');
  expect(school.name).toBe('外部校園');
  expect(school.themeColor).toBe('#123456');
  expect(school.domains).toBeUndefined();
});


test('National Chung Hsing University is selectable as an official browsing campus', () => {
  const school = schoolFromSelection({ schoolId: 'tw-nchu' });
  expect(school).toMatchObject({ id: 'tw-nchu', code: 'NCHU', name: '國立中興大學' });
  expect(school.name).not.toContain('示範');
});

test('reserved scopes stay unselected and a stored MOE school ID restores its official name', () => {
  expect(schoolFromSelection({ schoolId: 'all', code: 'PU' }).id).toBe('');
  expect(schoolFromSelection({ schoolId: 'unknown' }).id).toBe('');
  expect(schoolFromSelection({ schoolId: 'nkust' })).toMatchObject({ id: 'nkust', name: '國立高雄科技大學' });
});
