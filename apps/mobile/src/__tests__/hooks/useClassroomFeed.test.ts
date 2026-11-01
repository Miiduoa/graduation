import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { onSnapshot, type Firestore } from 'firebase/firestore';
import { useClassroomFeed } from '../../hooks/useClassroomFeed';

const db = {} as Firestore;
const identity = { groupId: 'course', sessionId: 'session', userId: 'one' };
const user = { uid: 'one' };
let change: (state: AppStateStatus) => void;
let listeners: { next: (value: unknown) => void; error: () => void; stop: jest.Mock }[];
const snapshot = { docs: [{ id: 'sample', data: () => ({ text: '合成問答' }) }] };
beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = callback;
    return { remove: jest.fn() };
  });
  jest.mocked(onSnapshot).mockImplementation(((
    _source: unknown,
    next: (value: unknown) => void,
    error: () => void,
  ) => {
    const stop = jest.fn();
    listeners.push({ next, error, stop });
    return stop;
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

test.each(['questions', 'polls'] as const)(
  '%s stops on background, blur and account changes and ignores late events',
  (kind) => {
    const view = renderHook(
      ({ auth, enabled }) =>
        useClassroomFeed(db, { ...identity, userId: auth.uid }, auth, enabled, kind),
      {
        initialProps: { auth: user, enabled: true },
      },
    );
    act(() => listeners[0].next(snapshot));
    expect(view.result.current.items).toHaveLength(1);
    act(() => change('background'));
    expect(listeners[0].stop).toHaveBeenCalledTimes(1);
    act(() => listeners[0].next(snapshot));
    expect(view.result.current.items).toEqual([]);
    act(() => change('active'));
    act(() => listeners[1].next(snapshot));
    view.rerender({ auth: { uid: 'two' }, enabled: true });
    expect(listeners[1].stop).toHaveBeenCalledTimes(1);
    expect(view.result.current.items).toEqual([]);
    act(() => {
      listeners[1].next(snapshot);
      listeners[1].error();
    });
    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.error).toBeNull();
    act(() => listeners[2].next(snapshot));
    view.rerender({ auth: { uid: 'two' }, enabled: false });
    expect(listeners[2].stop).toHaveBeenCalledTimes(1);
    expect(view.result.current.items).toEqual([]);
    view.unmount();
  },
);

test.each(['questions', 'polls'] as const)('%s clears data on terminal read errors', (kind) => {
  const view = renderHook(() => useClassroomFeed(db, identity, user, true, kind));
  act(() => listeners[0].next(snapshot));
  act(() => listeners[0].error());
  expect(view.result.current.items).toEqual([]);
  expect(view.result.current.error).toContain('無法載入');
  act(() => listeners[0].next(snapshot));
  expect(view.result.current.items).toEqual([]);
});
