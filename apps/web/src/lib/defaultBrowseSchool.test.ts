import { expect, it } from 'vitest';
import { resolveBrowseQuerySchoolId } from '@/components/SelectedSchoolProvider';

const schools = [{ id: 'pu', name: '靜宜大學' }, { id: 'nthu', name: '國立清華大學' }];

it('keeps first visits neutral even when Providence is first or the only listed school', () => {
  expect(resolveBrowseQuerySchoolId(schools, {}, null)).toBeNull();
  expect(resolveBrowseQuerySchoolId(schools.slice(0, 1), {}, null)).toBeNull();
});

it('preserves stored schools and gives explicit school and all-campus links precedence', () => {
  expect(resolveBrowseQuerySchoolId(schools, {}, 'nthu')).toBe('nthu');
  expect(resolveBrowseQuerySchoolId(schools, {}, 'pu')).toBe('pu');
  expect(resolveBrowseQuerySchoolId(schools, { campus: 'all', schoolId: 'pu' }, 'nthu')).toBeNull();
  expect(resolveBrowseQuerySchoolId(schools, { campus: 'nthu', schoolId: 'pu' }, 'pu')).toBe('nthu');
  expect(resolveBrowseQuerySchoolId(schools, { school: 'PU' }, null)).toBe('pu');
});
