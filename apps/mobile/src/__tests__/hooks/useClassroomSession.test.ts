import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { useClassroomSession } from '../../hooks/useClassroomSession';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));

type Listener = {
  path: string;
  next: (snapshot: unknown) => void;
  error: () => void;
  stop: jest.Mock;
};
const db = {} as Firestore;
const token = 'A'.repeat(43);
const expiresAt = Date.parse('2026-10-23T10:10:00Z');
const identity = { groupId: 'course', sessionId: 'live', userId: 'teacher', schoolId: 'school' };
const user = { uid: 'teacher' };
let listeners: Listener[];
let changeAppState: (state: AppStateStatus) => void;
const snapshot = (data?: Record<string, unknown>, fromCache = false) => ({
  exists: () => !!data,
  data: () => data,
  metadata: { fromCache, hasPendingWrites: false },
});
const session = {
  active: true,
  teacherId: 'teacher',
  qrExpiresAt: new Date(expiresAt),
  attendeeCount: 0,
  reactions: { understood: 0, partial: 0, confused: 0 },
};
const membership = { role: 'instructor', status: 'active' };
const secret = { qrToken: token, qrExpiresAt: new Date(expiresAt) };

function confirmTeacher(start = listeners.length - 1) {
  act(() => {
    listeners[start].next(snapshot(session));
    listeners[start + 1].next(snapshot(membership));
    listeners[start + 2].next(snapshot(secret));
  });
}

describe('classroom session lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    listeners = [];
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      changeAppState = callback;
      return { remove: jest.fn() };
    });
    jest
      .mocked(doc)
      .mockImplementation(((_db: unknown, ...parts: string[]) => parts.join('/')) as never);
    jest.mocked(onSnapshot).mockImplementation(((
      path: string,
      options: unknown,
      next: Listener['next'],
      error: Listener['error'],
    ) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      const stop = jest.fn();
      listeners.push({ path, next, error, stop });
      return stop;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('the classroom, membership and QR all need server confirmation before a token appears', () => {
    const { result } = renderHook(() => useClassroomSession(db, identity, user));
    act(() => listeners[0].next(snapshot(session, true)));
    expect(listeners).toHaveLength(1);
    expect(result.current.qrToken).toBeNull();
    act(() => listeners[0].next(snapshot(session)));
    act(() => listeners[1].next(snapshot(membership, true)));
    expect(listeners).toHaveLength(2);
    act(() => listeners[1].next(snapshot(membership)));
    act(() => listeners[2].next(snapshot(secret, true)));
    expect(result.current.qrToken).toBeNull();
    act(() => listeners[2].next(snapshot(secret)));
    expect(result.current.qrToken).toBe(token);
    expect(result.current.error).toBeNull();
  });

  test.each([true, false])(
    'teacher receipt cache recovers automatically with secret first: %s',
    (secretFirst) => {
      const { result } = renderHook(() => useClassroomSession(db, identity, user));
      act(() => {
        listeners[0].next(snapshot(session));
        listeners[1].next(snapshot(membership));
        if (secretFirst) listeners[2].next(snapshot(secret));
        listeners[3].next(snapshot(undefined, true));
        if (!secretFirst) listeners[2].next(snapshot(secret));
      });
      expect(result.current.qrToken).toBe(token);
      expect(result.current.error).toContain('尚待伺服器確認');
      act(() => listeners[3].next(snapshot()));
      expect(result.current.qrToken).toBe(token);
      expect(result.current.error).toBeNull();
      act(() => {
        listeners[3].next(snapshot(undefined, true));
        listeners[2].next(snapshot(secret, true));
      });
      expect(result.current.qrToken).toBeNull();
      act(() => {
        listeners[3].next(snapshot());
        listeners[2].next(snapshot(secret));
      });
      expect(result.current.qrToken).toBe(token);
      expect(result.current.error).toBeNull();
    },
  );

  test('terminal receipt errors remain separate from cache recovery', () => {
    const { result } = renderHook(() => useClassroomSession(db, identity, user));
    confirmTeacher();
    act(() => listeners[3].error());
    expect(result.current.qrToken).toBeNull();
    act(() => {
      listeners[3].next(snapshot());
      listeners[2].next(snapshot(secret));
    });
    expect(result.current.qrToken).toBeNull();
    expect(result.current.error).toContain('無法確認');
  });

  test('the timer removes a displayed QR at the exact expiry boundary', () => {
    const { result } = renderHook(() => useClassroomSession(db, identity, user));
    confirmTeacher();
    act(() => jest.advanceTimersByTime(10 * 60_000 - 1));
    expect(result.current.qrToken).toBe(token);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current.qrToken).toBeNull();
    expect(result.current.error).toContain('已到期');
  });

  test.each(['inactive', 'background'] as const)(
    '%s clears the QR and returning to foreground requires fresh server access',
    (state) => {
      const { result } = renderHook(() => useClassroomSession(db, identity, user));
      confirmTeacher();
      const oldListeners = [...listeners];
      act(() => changeAppState(state));
      expect(result.current.qrToken).toBeNull();
      expect(result.current.isTeacher).toBe(false);
      for (const listener of oldListeners) expect(listener.stop).toHaveBeenCalledTimes(1);
      act(() => {
        oldListeners[0].next(snapshot(session));
        oldListeners[1].next(snapshot(membership));
        oldListeners[2].next(snapshot(secret));
        changeAppState('active');
      });
      expect(result.current.qrToken).toBeNull();
      const start = listeners.length - 1;
      act(() => listeners[start].next(snapshot(session, true)));
      expect(listeners).toHaveLength(start + 1);
      expect(result.current.qrToken).toBeNull();
      confirmTeacher(start);
      expect(result.current.qrToken).toBe(token);
    },
  );

  test.each(['classroom', 'membership', 'secret'] as const)(
    'foreground %s read failure cannot restore the old QR',
    (failure) => {
      const { result } = renderHook(() => useClassroomSession(db, identity, user));
      confirmTeacher();
      act(() => {
        changeAppState('background');
        changeAppState('active');
      });
      const start = listeners.length - 1;
      act(() => {
        if (failure === 'classroom') listeners[start].error();
        else {
          listeners[start].next(snapshot(session));
          if (failure === 'membership') listeners[start + 1].error();
          else {
            listeners[start + 1].next(snapshot(membership));
            listeners[start + 2].error();
          }
        }
      });
      expect(result.current.qrToken).toBeNull();
      expect(result.current.error).toBeTruthy();
    },
  );

  test.each(['account', 'session', 'course', 'school', 'reauthentication'] as const)(
    '%s changes immediately hide old access and reject late callbacks',
    (change) => {
      const view = renderHook(({ scope, auth }) => useClassroomSession(db, scope, auth), {
        initialProps: { scope: identity, auth: user },
      });
      confirmTeacher();
      const previous = [...listeners];
      const scope = {
        ...identity,
        ...(change === 'account' ? { userId: 'another' } : {}),
        ...(change === 'session' ? { sessionId: 'another' } : {}),
        ...(change === 'course' ? { groupId: 'another' } : {}),
        ...(change === 'school' ? { schoolId: 'another' } : {}),
      };
      view.rerender({
        scope,
        auth: change === 'reauthentication' || change === 'account' ? { uid: scope.userId } : user,
      });
      expect(view.result.current.qrToken).toBeNull();
      act(() => {
        previous[0].next(snapshot(session));
        previous[1].next(snapshot(membership));
        previous[2].next(snapshot(secret));
        previous[3].next(snapshot({ status: 'present' }));
      });
      expect(view.result.current.qrToken).toBeNull();
      expect(view.result.current.joined).toBe(false);
      confirmTeacher();
      expect(view.result.current.qrToken).toBe(token);
    },
  );

  test('ending the session clears the QR and prevents late secret callbacks from restoring it', () => {
    const { result } = renderHook(() => useClassroomSession(db, identity, user));
    confirmTeacher();
    const oldSecret = listeners[2];
    act(() => listeners[0].next(snapshot({ ...session, active: false })));
    expect(result.current.qrToken).toBeNull();
    act(() => {
      listeners[4].next(snapshot(membership));
      oldSecret.next(snapshot(secret));
    });
    expect(result.current.isTeacher).toBe(true);
    expect(result.current.qrToken).toBeNull();
    expect(
      listeners.filter((listener) => listener.path.includes('liveSessionSecrets')),
    ).toHaveLength(1);
  });

  test('a live read failure clears the displayed token, and an explicit refresh validates again', () => {
    const { result } = renderHook(() => useClassroomSession(db, identity, user));
    confirmTeacher();
    act(() => listeners[0].error());
    expect(result.current.qrToken).toBeNull();
    expect(result.current.session).toBeNull();
    act(() => result.current.refresh());
    confirmTeacher();
    expect(result.current.qrToken).toBe(token);
    expect(result.current.error).toBeNull();
  });

  test('an expired authentication session clears access even when the account id is unchanged', () => {
    const view = renderHook(({ enabled }) => useClassroomSession(db, identity, user, enabled), {
      initialProps: { enabled: true },
    });
    confirmTeacher();
    view.rerender({ enabled: false });
    expect(view.result.current.qrToken).toBeNull();
    expect(view.result.current.canAttend).toBe(false);
    expect(listeners).toHaveLength(4);
  });
});
