import React from 'react';
import { Platform, Text } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';
import {
  performance,
  usePerformanceTrace,
  withScreenPerformance,
  type PerformanceTrace,
} from '../../services/performance';

describe('React performance lifecycle', () => {
  const traces: jest.Mocked<PerformanceTrace>[] = [];

  beforeEach(() => {
    traces.length = 0;
    jest.useFakeTimers();
    jest.spyOn(performance, 'startTrace').mockImplementation(() => {
      const trace: jest.Mocked<PerformanceTrace> = {
        start: jest.fn(),
        stop: jest.fn(),
        putAttribute: jest.fn(),
        putMetric: jest.fn(),
        getAttribute: jest.fn(),
        getMetric: jest.fn<number, [string]>().mockReturnValue(0),
        incrementMetric: jest.fn(),
      };
      traces.push(trace);
      return trace;
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('usePerformanceTrace', () => {
    it('retains one trace and its controls across unrelated committed renders', () => {
      const { result, rerender, unmount } = renderHook(
        ({ requestId }) => usePerformanceTrace('load_events', [requestId]),
        { initialProps: { requestId: 'request-a' } },
      );
      const controls = result.current;
      expect(controls.trace).toBe(traces[0]);

      rerender({ requestId: 'request-a' });
      expect(performance.startTrace).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(controls);
      controls.addAttribute('source', 'cache');
      controls.addMetric('rows', 5);
      expect(traces[0].putAttribute).toHaveBeenCalledWith('source', 'cache');
      expect(traces[0].putMetric).toHaveBeenCalledWith('rows', 5);

      unmount();
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(controls.trace).toBeNull();
    });

    it('stops the previous trace before a dependency or trace name changes', () => {
      const { result, rerender, unmount } = renderHook(
        ({ name, requestId }) => usePerformanceTrace(name, [requestId]),
        { initialProps: { name: 'load_events', requestId: 'request-a' } },
      );
      const controls = result.current;

      rerender({ name: 'load_events', requestId: 'request-b' });
      expect(traces).toHaveLength(2);
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(traces[0].stop.mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(performance.startTrace).mock.invocationCallOrder[1],
      );
      expect(controls.trace).toBeNull();
      expect(result.current.trace).toBe(traces[1]);
      controls.stopTrace();
      controls.addAttribute('late', 'ignored');
      controls.addMetric('late', 1);
      expect(traces[1].stop).not.toHaveBeenCalled();
      expect(traces[1].putAttribute).not.toHaveBeenCalled();
      expect(traces[1].putMetric).not.toHaveBeenCalled();

      rerender({ name: 'load_courses', requestId: 'request-b' });
      expect(performance.startTrace).toHaveBeenLastCalledWith('load_courses');
      expect(traces[1].stop).toHaveBeenCalledTimes(1);
      result.current.addMetric('rows', 7);
      expect(traces[2].putMetric).toHaveBeenCalledWith('rows', 7);
      expect(traces[1].putMetric).not.toHaveBeenCalled();

      unmount();
      expect(traces.every((trace) => trace.stop.mock.calls.length === 1)).toBe(true);
    });

    it('keeps a manually stopped trace stopped until its dependencies change', () => {
      const { result, rerender, unmount } = renderHook(
        ({ requestId }) => usePerformanceTrace('load_events', [requestId]),
        { initialProps: { requestId: 'request-a' } },
      );
      act(() => {
        result.current.stopTrace();
        result.current.stopTrace();
        result.current.addAttribute('late', 'ignored');
        result.current.addMetric('late', 1);
      });
      expect(result.current.trace).toBeNull();
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(traces[0].putAttribute).not.toHaveBeenCalled();
      expect(traces[0].putMetric).not.toHaveBeenCalled();

      rerender({ requestId: 'request-a' });
      expect(performance.startTrace).toHaveBeenCalledTimes(1);
      rerender({ requestId: 'request-b' });
      expect(traces).toHaveLength(2);
      expect(traces[0].stop).toHaveBeenCalledTimes(1);

      unmount();
      expect(traces[1].stop).toHaveBeenCalledTimes(1);
    });

    it('balances StrictMode effect replay and stops each trace exactly once', () => {
      const { result, unmount } = renderHook(() => usePerformanceTrace('load_events'), {
        wrapper: React.StrictMode,
      });
      expect(traces).toHaveLength(2);
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(result.current.trace).toBe(traces[1]);
      act(() => result.current.stopTrace());
      unmount();
      expect(traces.every((trace) => trace.stop.mock.calls.length === 1)).toBe(true);
    });
  });

  describe('withScreenPerformance', () => {
    const TrackedScreen = withScreenPerformance(
      ({ label }: { label: string }) => <Text>{label}</Text>,
      'events',
    );

    it('tracks committed renders and clears the preceding render timer', () => {
      const view = render(<TrackedScreen label="First" />);
      expect(performance.startTrace).toHaveBeenCalledWith('screen_render_events');
      expect(traces[0].putAttribute).toHaveBeenCalledWith('platform', Platform.OS);
      expect(traces[0].stop).not.toHaveBeenCalled();

      view.rerender(<TrackedScreen label="Second" />);
      expect(traces).toHaveLength(2);
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
      act(() => jest.runOnlyPendingTimers());
      expect(traces[1].stop).toHaveBeenCalledTimes(1);

      view.unmount();
      expect(traces.every((trace) => trace.stop.mock.calls.length === 1)).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('cancels an outstanding timer and finishes the trace on unmount', () => {
      const view = render(<TrackedScreen label="First" />);
      expect(jest.getTimerCount()).toBe(1);
      view.unmount();
      expect(jest.getTimerCount()).toBe(0);
      act(() => jest.runOnlyPendingTimers());
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
    });

    it('keeps only the committed StrictMode timer and never double-stops', () => {
      const view = render(
        <React.StrictMode>
          <TrackedScreen label="First" />
        </React.StrictMode>,
      );
      expect(traces).toHaveLength(2);
      expect(traces[0].stop).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(1);
      act(() => jest.runOnlyPendingTimers());
      view.unmount();
      expect(traces.every((trace) => trace.stop.mock.calls.length === 1)).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it.each(['hook', 'screen'] as const)(
    'does not start %s telemetry for an uncommitted Suspense render',
    (kind) => {
      const pending = new Promise<void>(() => {});
      function SuspendedHook(): React.JSX.Element {
        usePerformanceTrace('uncommitted');
        throw pending;
      }
      function SuspendedScreen(): React.JSX.Element {
        throw pending;
      }
      const Component =
        kind === 'hook' ? SuspendedHook : withScreenPerformance(SuspendedScreen, 'uncommitted');
      const view = render(
        <React.Suspense fallback={<Text>Loading</Text>}>
          <Component />
        </React.Suspense>,
      );
      expect(view.getByText('Loading')).toBeTruthy();
      expect(performance.startTrace).not.toHaveBeenCalled();
      view.unmount();
    },
  );
});
