import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllCache } from '../../data/cachedSource';
import { clearAllOfflineData } from '../../services/offline';
import { clearUserScopedStorage } from '../../services/scopedStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(() => jest.fn()),
}));

const cleanupCases = [
  { name: 'cache', run: (guard?: () => void) => clearAllCache(guard), key: '@campus_cache_private' },
  { name: 'offline', run: (guard?: () => void) => clearAllOfflineData(guard), key: '@offline_data_private' },
  {
    name: 'scoped storage',
    run: (guard?: () => void) => clearUserScopedStorage({ uid: 'account-a', schoolId: 'pu' }, guard),
    key: 'campus.scope.notes.u:account-a.s:pu',
  },
];

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test.each(cleanupCases)('$name preserves data written by the next account while key scanning is pending', async ({ run, key }) => {
  const nextAccountKey = key.replace('u:account-a.s:pu', 'u:account-b.s:nthu');
  let owner = 'account-a';
  const guard = () => {
    if (owner !== 'account-a') throw new Error('account changed');
  };
  let finishScan!: (keys: readonly string[]) => void;
  jest.mocked(AsyncStorage.getAllKeys).mockImplementationOnce(() => new Promise((resolve) => {
    finishScan = resolve;
  }));
  const pending = run(guard);
  const rejected = expect(pending).rejects.toThrow('account changed');
  owner = 'account-b';
  await AsyncStorage.multiSet([
    [nextAccountKey, 'new account data'],
    ['@offline_queue', '[{"userId":"account-b"}]'],
  ]);
  finishScan([nextAccountKey, '@offline_queue']);
  await rejected;
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(nextAccountKey)).toBe('new account data');
  expect(await AsyncStorage.getItem('@offline_queue')).toBe('[{"userId":"account-b"}]');
});

test.each(cleanupCases)('$name refuses a stale owner before starting a key scan', async ({ run }) => {
  await expect(run(() => { throw new Error('account changed'); })).rejects.toThrow('account changed');
  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
});

test.each(cleanupCases)('$name still removes its data for the same owner', async ({ run, key }) => {
  await AsyncStorage.setItem(key, 'old account data');
  const guard = jest.fn();
  await run(guard);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(guard).toHaveBeenCalledTimes(key.startsWith('@offline_data_') ? 3 : 2);
});

test.each(cleanupCases)('$name retains the existing explicit cleanup API without a guard', async ({ run, key }) => {
  await AsyncStorage.setItem(key, 'old account data');
  await run();
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

test('offline cleanup preserves the next account queue when identity changes during data removal', async () => {
  let owner = 'account-a';
  const guard = () => {
    if (owner !== 'account-a') throw new Error('account changed');
  };
  let finishRemoval!: () => void;
  jest.mocked(AsyncStorage.multiRemove).mockImplementationOnce(() => new Promise((resolve) => {
    finishRemoval = resolve;
  }));
  const pending = clearAllOfflineData(guard);
  const rejected = expect(pending).rejects.toThrow('account changed');
  await Promise.resolve();
  expect(AsyncStorage.multiRemove).toHaveBeenCalledTimes(1);
  owner = 'account-b';
  const newQueue = '[{"userId":"account-b"}]';
  await AsyncStorage.setItem('@offline_queue', newQueue);
  finishRemoval();
  await rejected;
  expect(await AsyncStorage.getItem('@offline_queue')).toBe(newQueue);
});
