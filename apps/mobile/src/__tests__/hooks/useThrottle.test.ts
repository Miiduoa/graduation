import { renderHook, act } from '@testing-library/react-native';
import {
  useThrottle,
  useThrottledCallback,
  usePreventDoubleClick,
} from '../../hooks/useThrottle';

describe('useThrottle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useThrottle('initial', 300));
    expect(result.current).toBe('initial');
  });

  it('should update value after interval', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 300),
      { initialProps: { value: 'initial' } }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    
    // 值不會立即更新（因為在節流間隔內）
    expect(result.current).toBe('initial');

    // 等待節流間隔過後
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // 現在值應該更新了
    expect(result.current).toBe('updated');
  });

  it('should throttle rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 300),
      { initialProps: { value: 'a' } }
    );

    expect(result.current).toBe('a');

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    rerender({ value: 'c' });
    expect(result.current).toBe('a');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe('c');
  });

  it('should use custom interval', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 500),
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

  it('should work with number values', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 300),
      { initialProps: { value: 0 } }
    );

    expect(result.current).toBe(0);

    rerender({ value: 10 });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe(10);
  });

  it('should work with object values', () => {
    const obj1 = { name: 'test' };
    const obj2 = { name: 'updated' };

    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 300),
      { initialProps: { value: obj1 } }
    );

    expect(result.current).toBe(obj1);

    rerender({ value: obj2 });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current).toBe(obj2);
  });
});

describe('useThrottledCallback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should execute callback immediately on first call', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current('arg1');
    });

    expect(callback).toHaveBeenCalledWith('arg1');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should throttle rapid callback calls', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current('first');
      result.current('second');
      result.current('third');
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('first');

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith('third');
  });

  it('should allow execution after interval', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current('first');
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current('second');
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith('second');
  });

  it('should cleanup timeout on unmount', () => {
    const callback = jest.fn();
    const { result, unmount } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current('first');
      result.current('second');
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple arguments', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(callback, 300));

    act(() => {
      result.current('arg1', 'arg2', 123);
    });

    expect(callback).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });
});

describe('usePreventDoubleClick', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should execute callback on first click', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => usePreventDoubleClick(callback, 1000));

    act(() => {
      result.current.execute();
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should block subsequent clicks within delay', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => usePreventDoubleClick(callback, 1000));

    act(() => {
      result.current.execute();
    });

    expect(result.current.isBlocked).toBe(true);

    act(() => {
      result.current.execute();
      result.current.execute();
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should unblock after delay', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => usePreventDoubleClick(callback, 1000));

    act(() => {
      result.current.execute();
    });

    expect(result.current.isBlocked).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.isBlocked).toBe(false);

    act(() => {
      result.current.execute();
    });

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should pass arguments to callback', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => usePreventDoubleClick(callback, 1000));

    act(() => {
      result.current.execute('test', 123);
    });

    expect(callback).toHaveBeenCalledWith('test', 123);
  });

  it('should cleanup timeout on unmount', () => {
    const callback = jest.fn();
    const { result, unmount } = renderHook(() => usePreventDoubleClick(callback, 1000));

    act(() => {
      result.current.execute();
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
  });

  it('should use default delay of 1000ms', () => {
    const callback = jest.fn();
    const { result } = renderHook(() => usePreventDoubleClick(callback));

    act(() => {
      result.current.execute();
    });

    expect(result.current.isBlocked).toBe(true);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.isBlocked).toBe(true);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.isBlocked).toBe(false);
  });
});
