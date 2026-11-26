import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AccessibilityProvider, useAccessibility } from '../../state/accessibility';
import { PreferencesProvider, usePreferences } from '../../state/preferences';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let change: (enabled: boolean) => void;
let remove: jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'reduceMotionChanged') change = listener as (enabled: boolean) => void;
    return { remove };
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

test('waits for the system preference and works without either optional provider', async () => {
  const initial = deferred<boolean>();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial.promise);
  const view = renderHook(useReducedMotion);
  expect(view.result.current).toBe(true);
  await act(async () => initial.resolve(false));
  expect(view.result.current).toBe(false);
  act(() => change(true));
  expect(view.result.current).toBe(true);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a live system change wins over a stale initial reading', async () => {
  const initial = deferred<boolean>();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial.promise);
  const view = renderHook(useReducedMotion);
  act(() => change(true));
  await act(async () => initial.resolve(false));
  expect(view.result.current).toBe(true);
  act(() => change(false));
  expect(view.result.current).toBe(false);
});

test('an unavailable system preference keeps motion reduced and later changes still work', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockRejectedValue(new Error('unavailable'));
  const view = renderHook(useReducedMotion);
  await act(async () => {});
  expect(view.result.current).toBe(true);
  act(() => change(false));
  expect(view.result.current).toBe(false);
});

test('both saved app preferences can independently reduce motion while the system stays off', async () => {
  const view = renderHook(
    () => ({
      reduced: useReducedMotion(),
      accessibility: useAccessibility(),
      preferences: usePreferences(),
    }),
    {
      wrapper: ({ children }) => (
        <AccessibilityProvider>
          <PreferencesProvider>{children}</PreferencesProvider>
        </AccessibilityProvider>
      ),
    },
  );
  await act(async () => {});
  expect(view.result.current.reduced).toBe(false);
  act(() => view.result.current.accessibility.updateSetting('reduceMotion', true));
  expect(view.result.current.reduced).toBe(true);
  await act(async () => view.result.current.preferences.setReduceMotion(true));
  act(() => view.result.current.accessibility.updateSetting('reduceMotion', false));
  expect(view.result.current.reduced).toBe(true);
  await act(async () => view.result.current.preferences.setReduceMotion(false));
  expect(view.result.current.reduced).toBe(false);
  act(() => change(true));
  await act(async () => view.result.current.preferences.setReduceMotion(false));
  expect(view.result.current.reduced).toBe(true);
});

test('the preferences-only provider composition retains the saved reduce-motion choice', async () => {
  await AsyncStorage.setItem('@user_preferences', JSON.stringify({ reduceMotion: true }));
  const view = renderHook(useReducedMotion, { wrapper: PreferencesProvider });
  await act(async () => {});
  expect(view.result.current).toBe(true);
});

test('unmount removes the listener and ignores an outstanding system reading', async () => {
  const initial = deferred<boolean>();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(initial.promise);
  const view = renderHook(useReducedMotion);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => initial.resolve(false));
  expect(view.result.current).toBe(true);
});

test('multiple controls share one native observer and new controls read an already-known false synchronously', async () => {
  const first = renderHook(useReducedMotion);
  await act(async () => {});
  expect(first.result.current).toBe(false);
  const second = renderHook(useReducedMotion);
  expect(second.result.current).toBe(false);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  act(() => change(true));
  expect(first.result.current).toBe(true);
  expect(second.result.current).toBe(true);
  first.unmount();
  expect(remove).not.toHaveBeenCalled();
  second.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a later subscription rereads the system and rejects the previous subscription’s delayed result', async () => {
  const previous = deferred<boolean>();
  const next = deferred<boolean>();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(next.promise);
  const first = renderHook(useReducedMotion);
  const oldChange = change;
  first.unmount();
  const second = renderHook(useReducedMotion);
  expect(second.result.current).toBe(true);
  await act(async () => next.resolve(true));
  await act(async () => previous.resolve(false));
  act(() => oldChange(false));
  expect(second.result.current).toBe(true);
  act(() => change(false));
  expect(second.result.current).toBe(false);
});
