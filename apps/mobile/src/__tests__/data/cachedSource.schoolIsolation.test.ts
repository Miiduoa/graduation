import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCachedSource, schoolScopedCacheKey } from '../../data/cachedSource';
import type { DataSource } from '../../data/source';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function source(getAnnouncement: DataSource['getAnnouncement']): DataSource {
  return { getAnnouncement } as DataSource;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('announcement cache keys include schoolId and do not leak across schools', async () => {
  expect(schoolScopedCacheKey('announcement', 'pu', 'a1')).toBe('announcement_pu_a1');
  const getAnnouncement = jest
    .fn()
    .mockImplementation(async (_id: string, schoolId?: string) =>
      schoolId === 'pu' ? { id: 'a1', title: '靜宜公告', schoolId: 'pu' } : { id: 'a1', title: '清華公告', schoolId: 'nthu' },
    );
  const cached = createCachedSource(source(getAnnouncement));
  await expect(cached.getAnnouncement('a1', 'pu')).resolves.toMatchObject({ title: '靜宜公告' });
  await expect(cached.getAnnouncement('a1', 'nthu')).resolves.toMatchObject({ title: '清華公告' });
  expect(getAnnouncement).toHaveBeenCalledWith('a1', 'pu');
  expect(getAnnouncement).toHaveBeenCalledWith('a1', 'nthu');
  getAnnouncement.mockClear();
  await expect(cached.getAnnouncement('a1', 'pu')).resolves.toMatchObject({ title: '靜宜公告' });
  expect(getAnnouncement).not.toHaveBeenCalled();
});

test('NCKU announcement cache does not serve NTPU copy', async () => {
  const getAnnouncement = jest
    .fn()
    .mockImplementation(async (_id: string, schoolId?: string) =>
      schoolId === 'ncku'
        ? { id: 'a1', title: '成大選課', schoolId: 'ncku' }
        : { id: 'a1', title: '北大實習辦法', schoolId: 'ntpu' },
    );
  const cached = createCachedSource(source(getAnnouncement));
  await expect(cached.getAnnouncement('a1', 'ncku')).resolves.toMatchObject({ title: '成大選課' });
  await expect(cached.getAnnouncement('a1', 'ntpu')).resolves.toMatchObject({
    title: '北大實習辦法',
  });
  getAnnouncement.mockClear();
  await expect(cached.getAnnouncement('a1', 'ncku')).resolves.toMatchObject({ title: '成大選課' });
  expect(getAnnouncement).not.toHaveBeenCalled();
});
