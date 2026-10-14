import { schoolFromSelection } from '../state/school';

jest.mock('../data/cachedSource', () => ({ clearCacheExceptSchool: jest.fn() }));
jest.mock('../data/hybridSource', () => ({ setHybridSourceSchoolContext: jest.fn() }));
jest.mock('../ui/theme', () => ({
  applySchoolTheme: jest.fn(),
  registerSchoolTheme: jest.fn(),
}));

describe('school selection identity', () => {
  test('bundled school IDs keep their canonical name and code', () => {
    const school = schoolFromSelection({
      schoolId: 'pu',
      code: 'PU',
      schoolName: '不可信任的手動名稱',
    });
    expect(school.id).toBe('pu');
    expect(school.name).toBe('靜宜大學');
  });

  test('a school listed by the remote directory never silently becomes the demo school', () => {
    const school = schoolFromSelection({
      schoolId: 'tw-real-other-university',
      schoolName: '已選擇的校園',
      shortName: '其他大學',
      code: 'OTHER',
      themeColor: '#123abc',
      domains: ['claimed.edu.tw'],
    });
    expect(school).toMatchObject({
      id: 'tw-real-other-university',
      name: '已選擇的校園',
      shortName: '其他大學',
      code: 'OTHER',
      themeColor: '#123abc',
    });
    expect(school.domains).toBeUndefined();
  });

  test('an unknown campus does not inherit the previous university school code or title', () => {
    const school = schoolFromSelection({
      schoolId: 'remote-school-a',
      code: 'PU',
      schoolName: '另一所學校',
    });
    expect(school.id).toBe('remote-school-a');
    expect(school.code).not.toBe('PU');
    expect(school.name).toBe('另一所學校');
  });

  test('invalid school identifiers cannot inject a Firestore path', () => {
    const school = schoolFromSelection({
      schoolId: '../schools/pu',
      schoolName: '偽造校園',
    });
    expect(school.id).toBe('pu');
    expect(school.name).toBe('靜宜大學');
  });

  test('a unique school code still resolves when no ID is stored', () => {
    const school = schoolFromSelection({ schoolId: null, code: 'NTHU' });
    expect(school.id).toBe('nthu');
  });
});
