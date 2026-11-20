import { mockSchools } from '@campus/shared/src/schools';
import { mergeSchoolLists } from '../../services/schoolDirectory';

test('official NCHU remains available for public browsing without an active SSO integration', () => {
  const schools = mergeSchoolLists([], mockSchools);
  expect(schools).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'tw-nchu', name: '國立中興大學', code: 'NCHU' }),
  ]));
  expect(schools.some((school) => school.id === 'tw-demo-uni')).toBe(false);
});
