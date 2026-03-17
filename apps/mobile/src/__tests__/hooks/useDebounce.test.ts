import { renderHook, act } from '@testing-library/react-native';
import {
  useDebounce,
  useDebounceWithPending,
  useSearchDebounce,
} from '../../hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('should debounce value updates', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'initial' } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current).toBe('initial');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe('updated');
  });

  it('should reset timer on rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    rerender({ value: 'c' });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    rerender({ value: 'd' });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe('d');
  });

  it('should use custom delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'initial' } }
    );

    rerender({ value: 'updated' });

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(result.current).toBe('initial');

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe('updated');
  });
});

describe('useDebounceWithPending', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return initial value with isPending false', () => {
    const { result } = renderHook(() => useDebounceWithPending('initial', 300));
    expect(result.current.debouncedValue).toBe('initial');
    expect(result.current.isPending).toBe(false);
  });

  it('should set isPending true during debounce', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounceWithPending(value, 300),
      { initialProps: { value: 'initial' } }
    );

    rerender({ value: 'updated' });
    expect(result.current.isPending).toBe(true);
    expect(result.current.debouncedValue).toBe('initial');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.debouncedValue).toBe('updated');
  });
});

describe('useSearchDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return initial state', () => {
    const { result } = renderHook(() => useSearchDebounce('', 300));
    expect(result.current.debouncedValue).toBe('');
    expect(result.current.isSearching).toBe(false);
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.shouldSearch).toBe(true);
  });

  it('should handle search input', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useSearchDebounce(value, 300, 2),
      { initialProps: { value: '' } }
    );

    rerender({ value: 'te' });
    expect(result.current.isSearching).toBe(true);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.debouncedValue).toBe('te');
    expect(result.current.isSearching).toBe(false);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.shouldSearch).toBe(true);
  });

  it('should trim whitespace', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useSearchDebounce(value, 300),
      { initialProps: { value: '' } }
    );

    rerender({ value: '  test  ' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.debouncedValue).toBe('test');
  });

  it('should respect minLength', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useSearchDebounce(value, 300, 3),
      { initialProps: { value: '' } }
    );

    rerender({ value: 'ab' });
    expect(result.current.shouldSearch).toBe(false);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.shouldSearch).toBe(false);

    rerender({ value: 'abc' });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.shouldSearch).toBe(true);
  });
});
