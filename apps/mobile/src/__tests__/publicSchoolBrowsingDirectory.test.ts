import Constants from 'expo-constants';
import { getDocs } from 'firebase/firestore';
import { fetchSchoolDirectory } from '../services/schoolDirectory';
import { isStudentIdLoginAvailable } from '../services/schoolLoginAvailability';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db, ...path) => path.join('/')),
  limit: jest.fn((size) => size),
  query: jest.fn((root, ...values) => ({ root, values })),
  getDocs: jest.fn(),
}));
jest.mock('../firebase', () => ({ getDb: () => ({}) }));

const source = jest.mocked(getDocs);

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: {
        releasedSchoolIds: ['pu'],
        features: {
          enabled: true,
          sso: true,
          courses: true,
          grades: true,
          widgets: true,
          payments: false,
          deeplinks: false,
        },
      },
    },
  });
  source.mockResolvedValue({ docs: [] } as never);
});

test('official public universities stay selectable even before school login is enabled', async () => {
  const schools = await fetchSchoolDirectory();
  const ids = schools.map((school) => school.id);
  expect(ids).toContain('pu');
  expect(ids).toContain('nthu');
  expect(ids).toContain('ntu');
  expect(ids).toContain('ncku');
  expect(ids).not.toContain('tw-demo-uni');
  expect(ids).not.toContain('tw-taichung-uni-a');
  expect(ids).not.toContain('tw-taichung-uni-b');
  expect(ids).toContain('tw-nchu');
  expect(schools.find((school) => school.id === 'tw-nchu')?.name).toBe('國立中興大學');
  expect(schools.find((school) => school.id === 'tw-nchu')?.integrationStatus?.enabled).toBe(false);
  expect(isStudentIdLoginAvailable('tw-nchu')).toBe(false);
  expect(schools.find((school) => school.id === 'nthu')?.integrationStatus?.enabled).toBe(false);
  expect(isStudentIdLoginAvailable('nthu')).toBe(false);
});

test('a private remote school is hidden until its public browsing is explicitly enabled', async () => {
  source.mockResolvedValueOnce({
    docs: [
      { id: 'private-campus', data: () => ({ name: '未公開學校', code: 'PRIVATE' }) },
      { id: 'public-campus', data: () => ({ name: '公開校園', publicBrowsing: true }) },
    ],
  } as never);
  const schools = await fetchSchoolDirectory();
  expect(schools.some((school) => school.id === 'private-campus')).toBe(false);
  expect(schools.find((school) => school.id === 'public-campus')?.name).toBe('公開校園');
  expect(schools.find((school) => school.id === 'public-campus')?.integrationStatus?.sso).toBe(
    false,
  );
});

test('a remote alias cannot replace an official university identity', async () => {
  source.mockResolvedValueOnce({
    docs: [
      {
        id: 'nthu',
        data: () => ({
          name: '另一所冒名校園',
          code: 'PU',
          domain: 'attacker.invalid',
          publicBrowsing: true,
        }),
      },
    ],
  } as never);
  const schools = await fetchSchoolDirectory();
  const nthu = schools.find((school) => school.id === 'nthu');
  expect(nthu).toMatchObject({ name: '國立清華大學', code: 'NTHU' });
  expect(nthu?.domains).toEqual(['nthu.edu.tw']);
});

test('a directory connection failure keeps only explicitly labeled public universities', async () => {
  source.mockRejectedValueOnce(new Error('offline'));
  const schools = await fetchSchoolDirectory();
  expect(schools.some((school) => school.id === 'ntu')).toBe(true);
  expect(schools.some((school) => school.id === 'tw-demo-uni')).toBe(false);
  expect(schools.some((school) => school.name.includes('（示範）'))).toBe(false);
});
