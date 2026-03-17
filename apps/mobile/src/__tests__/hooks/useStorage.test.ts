import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useAsyncStorage,
  useMultiStorage,
  useBooleanStorage,
  useHistoryStorage,
} from '../../hooks/useStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('useAsyncStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('should return default value initially', () => {
    const { result, unmount } = renderHook(() =>
      useAsyncStorage('testKey', { defaultValue: 'default' })
    );

    const [value, , loading] = result.current;
    expect(value).toBe('default');
    expect(loading).toBe(true);
    unmount();
  });

  it('should load stored value', async () => {
    await AsyncStorage.setItem('testKey', JSON.stringify('stored'));

    const { result, unmount } = renderHook(() =>
      useAsyncStorage('testKey', { defaultValue: 'default' })
    );

    await waitFor(() => {
      expect(result.current[2]).toBe(false);
    }, { timeout: 5000 });

    expect(result.current[0]).toBe('stored');
    unmount();
  });

  it('should save value to storage', async () => {
    const { result, unmount } = renderHook(() =>
      useAsyncStorage('testKey', { defaultValue: '' })
    );

    await waitFor(() => {
      expect(result.current[2]).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current[1]('newValue');
    });

    expect(result.current[0]).toBe('newValue');
    const stored = await AsyncStorage.getItem('testKey');
    expect(JSON.parse(stored!)).toBe('newValue');
    unmount();
  });

  it('should handle function updater', async () => {
    await AsyncStorage.setItem('counterKey', JSON.stringify(5));

    const { result, unmount } = renderHook(() =>
      useAsyncStorage<number>('counterKey', { defaultValue: 0 })
    );

    await waitFor(() => {
      expect(result.current[2]).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(6);
    unmount();
  });

  it('should remove value from storage', async () => {
    await AsyncStorage.setItem('testKey', JSON.stringify('toRemove'));

    const { result, unmount } = renderHook(() =>
      useAsyncStorage('testKey', { defaultValue: 'default' })
    );

    await waitFor(() => {
      expect(result.current[0]).toBe('toRemove');
    }, { timeout: 5000 });

    await act(async () => {
      await result.current[3]();
    });

    expect(result.current[0]).toBe('default');
    const stored = await AsyncStorage.getItem('testKey');
    expect(stored).toBeNull();
    unmount();
  });

  it('should handle corrupted storage data gracefully', async () => {
    await AsyncStorage.setItem('corruptedKey', 'not-valid-json');

    const { result, unmount } = renderHook(() =>
      useAsyncStorage('corruptedKey', { defaultValue: 'fallback' })
    );

    await waitFor(() => {
      expect(result.current[2]).toBe(false);
    }, { timeout: 5000 });

    expect(result.current[0]).toBe('fallback');
    unmount();
  });
});

describe('useMultiStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const keys = ['name', 'email', 'age'] as const;
  type TestValues = {
    name: string;
    email: string;
    age: number;
  };
  const defaults: TestValues = { name: '', email: '', age: 0 };

  it('should return default values initially', () => {
    const { result, unmount } = renderHook(() =>
      useMultiStorage<TestValues>([...keys], defaults)
    );

    expect(result.current.values).toEqual(defaults);
    expect(result.current.loading).toBe(true);
    unmount();
  });

  it('should load stored values', async () => {
    await AsyncStorage.setItem('name', JSON.stringify('John'));
    await AsyncStorage.setItem('email', JSON.stringify('john@example.com'));

    const { result, unmount } = renderHook(() =>
      useMultiStorage<TestValues>([...keys], defaults)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 5000 });

    expect(result.current.values.name).toBe('John');
    expect(result.current.values.email).toBe('john@example.com');
    expect(result.current.values.age).toBe(0);
    unmount();
  });

  it('should set single value', async () => {
    const { result, unmount } = renderHook(() =>
      useMultiStorage<TestValues>([...keys], defaults)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current.setValue('name', 'Jane');
    });

    expect(result.current.values.name).toBe('Jane');
    const stored = await AsyncStorage.getItem('name');
    expect(JSON.parse(stored!)).toBe('Jane');
    unmount();
  });

  it('should set multiple values', async () => {
    const { result, unmount } = renderHook(() =>
      useMultiStorage<TestValues>([...keys], defaults)
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current.setValues({
        name: 'Bob',
        age: 30,
      });
    });

    expect(result.current.values.name).toBe('Bob');
    expect(result.current.values.age).toBe(30);
    unmount();
  });
});

describe('useBooleanStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('should return default false', () => {
    const { result, unmount } = renderHook(() => useBooleanStorage('boolKey'));

    const [value, , , loading] = result.current;
    expect(value).toBe(false);
    expect(loading).toBe(true);
    unmount();
  });

  it('should return custom default', () => {
    const { result, unmount } = renderHook(() => useBooleanStorage('boolKey', true));

    expect(result.current[0]).toBe(true);
    unmount();
  });

  it('should toggle value', async () => {
    const { result, unmount } = renderHook(() => useBooleanStorage('boolKey', false));

    await waitFor(() => {
      expect(result.current[3]).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current[1]();
    });

    expect(result.current[0]).toBe(true);

    await act(async () => {
      await result.current[1]();
    });

    expect(result.current[0]).toBe(false);
    unmount();
  });

  it('should set true', async () => {
    const { result, unmount } = renderHook(() => useBooleanStorage('boolKey', false));

    await waitFor(() => {
      expect(result.current[3]).toBe(false);
    }, { timeout: 5000 });

    await act(async () => {
      await result.current[2]();
    });

    expect(result.current[0]).toBe(true);
    unmount();
  });
});

describe('useHistoryStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('should return empty history initially', () => {
    const { result, unmount } = renderHook(() => useHistoryStorage<string>('history'));

    expect(result.current.history).toEqual([]);
    expect(result.current.loading).toBe(true);
    unmount();
  });

  it('should handle history operations', async () => {
    // Pre-seed some data to avoid timing issues
    await AsyncStorage.setItem('history', JSON.stringify(['existing']));

    const { result, unmount } = renderHook(() => useHistoryStorage<string>('history'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    }, { timeout: 3000 });

    expect(result.current.history).toContain('existing');
    unmount();
  });
});
