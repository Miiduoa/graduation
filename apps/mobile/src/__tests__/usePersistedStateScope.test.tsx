import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePersistedState } from '../hooks/usePersistedState';
import * as persistedStorage from '../services/persistedStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const actualLoad = jest.requireActual('../services/persistedStorage')
  .loadPersistedValue as typeof persistedStorage.loadPersistedValue;
const actualSave = jest.requireActual('../services/persistedStorage')
  .savePersistedValue as typeof persistedStorage.savePersistedValue;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.spyOn(persistedStorage, 'loadPersistedValue').mockImplementation(actualLoad);
  jest.spyOn(persistedStorage, 'savePersistedValue').mockImplementation(actualSave);
  await AsyncStorage.clear();
});

test('A→B clears value/loaded on the first render and never persists A into B', async () => {
  await AsyncStorage.setItem('key-a', JSON.stringify('from-a'));
  await AsyncStorage.setItem('key-b', JSON.stringify('from-b'));

  const { result, rerender } = renderHook(
    ({ storageKey }) =>
      usePersistedState({
        storageKey,
        defaultValue: 'default',
      }),
    { initialProps: { storageKey: 'key-a' } },
  );

  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('from-a');
  });

  rerender({ storageKey: 'key-b' });

  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');

  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('from-b');
  });

  expect(await AsyncStorage.getItem('key-a')).toBe(JSON.stringify('from-a'));
  expect(await AsyncStorage.getItem('key-b')).toBe(JSON.stringify('from-b'));
});

test('a delayed A read cannot override B or a later return to A', async () => {
  const pendingA1 = deferred<string>();
  const pendingA2 = deferred<string>();
  let aReads = 0;

  jest.mocked(persistedStorage.loadPersistedValue).mockImplementation(async (params) => {
    if (params.storageKey === 'key-a') {
      aReads += 1;
      return aReads === 1 ? pendingA1.promise : pendingA2.promise;
    }
    return actualLoad(params);
  });

  await AsyncStorage.setItem('key-b', JSON.stringify('from-b'));

  const { result, rerender } = renderHook(
    ({ storageKey }) =>
      usePersistedState({
        storageKey,
        defaultValue: 'default',
      }),
    { initialProps: { storageKey: 'key-a' } },
  );

  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');

  rerender({ storageKey: 'key-b' });
  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');

  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('from-b');
  });

  rerender({ storageKey: 'key-a' });
  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');

  await act(async () => {
    pendingA1.resolve('stale-a');
  });
  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');
  expect(await AsyncStorage.getItem('key-b')).toBe(JSON.stringify('from-b'));

  await act(async () => {
    pendingA2.resolve('fresh-a');
  });
  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('fresh-a');
  });
});

test('retained setValue/reset from A cannot mutate B; functional setters still work', async () => {
  const pendingB = deferred<string>();
  jest.mocked(persistedStorage.loadPersistedValue).mockImplementation(async (params) => {
    if (params.storageKey === 'key-b') {
      return pendingB.promise;
    }
    return actualLoad(params);
  });

  await AsyncStorage.setItem('key-a', JSON.stringify('from-a'));

  const { result, rerender } = renderHook(
    ({ storageKey }) =>
      usePersistedState({
        storageKey,
        defaultValue: 'default',
      }),
    { initialProps: { storageKey: 'key-a' } },
  );

  await waitFor(() => expect(result.current.value).toBe('from-a'));

  const setFromA = result.current.setValue;
  const resetFromA = result.current.reset;

  rerender({ storageKey: 'key-b' });
  expect(result.current.value).toBe('default');
  expect(result.current.loaded).toBe(false);

  act(() => {
    setFromA('leaked-from-a');
    resetFromA();
  });
  expect(result.current.value).toBe('default');
  expect(result.current.loaded).toBe(false);

  await act(async () => {
    pendingB.resolve('from-b');
  });
  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('from-b');
  });

  await act(async () => {
    setFromA('leaked-from-a');
    resetFromA();
  });
  expect(result.current.value).toBe('from-b');

  await act(async () => {
    result.current.setValue((prev) => `${prev}!`);
  });
  expect(result.current.value).toBe('from-b!');

  await act(async () => {
    result.current.reset();
  });
  expect(result.current.value).toBe('default');

  await waitFor(async () => {
    expect(await AsyncStorage.getItem('key-b')).toBe(JSON.stringify('default'));
  });
  expect(await AsyncStorage.getItem('key-a')).toBe(JSON.stringify('from-a'));
});
test('switching keys before hydration never writes the prior in-memory value under the new key', async () => {
  const pendingA = deferred<string>();
  jest.mocked(persistedStorage.loadPersistedValue).mockImplementation(async (params) => {
    if (params.storageKey === 'key-a') {
      return pendingA.promise;
    }
    return actualLoad(params);
  });

  const { result, rerender } = renderHook(
    ({ storageKey }) =>
      usePersistedState({
        storageKey,
        defaultValue: 'default',
      }),
    { initialProps: { storageKey: 'key-a' } },
  );

  await act(async () => {
    result.current.setValue('edit-before-hydrate');
  });
  expect(result.current.value).toBe('edit-before-hydrate');
  expect(result.current.loaded).toBe(false);

  rerender({ storageKey: 'key-b' });
  expect(result.current.value).toBe('default');
  expect(result.current.loaded).toBe(false);

  await act(async () => {
    pendingA.resolve('from-a');
  });

  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.value).toBe('default');
  expect(await AsyncStorage.getItem('key-b')).toBe(JSON.stringify('default'));
  expect(await AsyncStorage.getItem('key-a')).toBeNull();
});

test('legacy keys and custom deserialize/serialize still apply for the active scope', async () => {
  await AsyncStorage.setItem('legacy-b', 'raw:legacy');

  const { result, rerender } = renderHook(
    ({ storageKey, legacyKeys }) =>
      usePersistedState({
        storageKey,
        legacyKeys,
        defaultValue: 'default',
        deserialize: (raw) => raw.replace(/^raw:/, ''),
        serialize: (value) => `raw:${value}`,
      }),
    { initialProps: { storageKey: 'key-a', legacyKeys: ['legacy-a'] } },
  );

  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.value).toBe('default');

  rerender({ storageKey: 'key-b', legacyKeys: ['legacy-b'] });
  expect(result.current.loaded).toBe(false);
  expect(result.current.value).toBe('default');

  await waitFor(() => {
    expect(result.current.loaded).toBe(true);
    expect(result.current.value).toBe('legacy');
  });

  await act(async () => {
    result.current.setValue('saved');
  });
  await waitFor(async () => {
    expect(await AsyncStorage.getItem('key-b')).toBe('raw:saved');
  });
  expect(await AsyncStorage.getItem('legacy-b')).toBe('raw:legacy');
});
