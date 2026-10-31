import type { AttendanceReceipt } from '@campus/shared/src/attendanceReliability';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { subscribeClassroomAttendance } from '../services/liveAttendance';

export type LiveClassroomSession = {
  sessionId: string;
  teacherId: string;
  active: boolean;
  qrExpiresAt?: unknown;
  reactions: { understood: number; partial: number; confused: number };
  attendeeCount: number;
};

type ClassroomState = {
  session: LiveClassroomSession | null;
  loading: boolean;
  isTeacher: boolean;
  canAttend: boolean;
  qrToken: string | null;
  qrExpiresAt: number | null;
  joined: boolean;
  receipt: AttendanceReceipt | null;
  error: string | null;
  receiptStatus: string | null;
};
const emptyState: ClassroomState = {
  session: null,
  loading: false,
  isTeacher: false,
  canAttend: false,
  qrToken: null,
  qrExpiresAt: null,
  joined: false,
  receipt: null,
  error: null,
  receiptStatus: null,
};
const connectionMessage = '尚未取得即時課堂資料，請確認連線後重新整理。';

export function useClassroomSession(
  db: Firestore,
  identity: { groupId?: string; sessionId?: string; userId?: string; schoolId?: string },
  authSession: object | null,
  enabled = true,
) {
  const { groupId, sessionId, userId, schoolId } = identity;
  const key = JSON.stringify([groupId, sessionId, userId, schoolId, enabled]);
  const identityRef = useRef({ key, authSession });
  identityRef.current = { key, authSession };
  const [state, setState] = useState({ key, authSession, value: emptyState });
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let stopLive: (() => void) | undefined;
    let stopAttendance: (() => void) | undefined;
    let foreground = AppState.currentState === 'active';
    const current = () =>
      !disposed &&
      identityRef.current.key === key &&
      identityRef.current.authSession === authSession;
    const patch = (value: Partial<ClassroomState>) => {
      if (current())
        setState((previous) => ({
          key,
          authSession,
          value: { ...previous.value, ...value },
        }));
    };
    const stop = () => {
      generation += 1;
      stopLive?.();
      stopAttendance?.();
      stopLive = undefined;
      stopAttendance = undefined;
    };
    const restart = () => {
      stop();
      patch(emptyState);
      if (
        !current() ||
        !foreground ||
        !enabled ||
        !groupId ||
        !sessionId ||
        !userId ||
        !authSession
      )
        return;
      patch({ loading: true });
      const request = generation;
      const liveCurrent = () => current() && request === generation;
      let accessGeneration = 0;
      let liveActive: boolean | null = null;
      let liveFailed = false;
      const clearAccess = () => {
        accessGeneration += 1;
        stopAttendance?.();
        stopAttendance = undefined;
        liveActive = null;
        patch({
          isTeacher: false,
          canAttend: false,
          qrToken: null,
          qrExpiresAt: null,
          joined: false,
          receipt: null,
          receiptStatus: null,
        });
      };

      stopLive = onSnapshot(
        doc(db, 'groups', groupId, 'liveSessions', sessionId),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!liveCurrent() || liveFailed) return;
          const session = snapshot.exists()
            ? ({ ...snapshot.data(), sessionId } as LiveClassroomSession)
            : null;
          patch({ session, loading: false });
          const serverConfirmed =
            !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
          if (!session || !serverConfirmed) {
            clearAccess();
            patch({ error: serverConfirmed ? null : connectionMessage });
            return;
          }
          setState((previous) => ({
            ...previous,
            value: {
              ...previous.value,
              error: previous.value.error === connectionMessage ? null : previous.value.error,
            },
          }));
          const active = session.active === true;
          if (liveActive === active) return;
          clearAccess();
          liveActive = active;
          const access = accessGeneration;
          const accessCurrent = () => liveCurrent() && access === accessGeneration;
          let attendanceFailed = false;
          stopAttendance = subscribeClassroomAttendance(
            db,
            { groupId, sessionId, userId },
            {
              onTeacher: (isTeacher) => {
                if (accessCurrent()) patch({ isTeacher });
              },
              onActive: (canAttend) => {
                if (accessCurrent()) patch({ canAttend });
              },
              onToken: (qrToken) => {
                if (accessCurrent()) patch({ qrToken: attendanceFailed ? null : qrToken });
              },
              onQrExpiresAt: (qrExpiresAt) => {
                if (accessCurrent()) patch({ qrExpiresAt });
              },
              onReceipt: (receipt) => {
                if (accessCurrent()) patch({ receipt });
              },
              onJoined: (joined) => {
                if (accessCurrent()) patch({ joined });
              },
              onReceiptStatus: (receiptStatus) => {
                if (accessCurrent()) patch({ receiptStatus });
              },
              onError: (error) => {
                if (!accessCurrent()) return;
                attendanceFailed = true;
                patch({ qrToken: null, error });
              },
            },
            active,
          );
        },
        () => {
          if (!liveCurrent()) return;
          liveFailed = true;
          clearAccess();
          patch({
            session: null,
            loading: false,
            error: '無法讀取這場課堂，請確認課程權限並重新進入。',
          });
        },
      );
    };
    refreshRef.current = restart;
    const listener = AppState.addEventListener('change', (nextState) => {
      const nextForeground = nextState === 'active';
      if (foreground === nextForeground) return;
      foreground = nextForeground;
      restart();
    });
    restart();
    return () => {
      disposed = true;
      stop();
      listener.remove();
      if (refreshRef.current === restart) refreshRef.current = () => {};
    };
  }, [db, key, authSession, enabled, groupId, sessionId, userId]);

  const value = state.key === key && state.authSession === authSession ? state.value : emptyState;
  return {
    ...value,
    error: value.error ?? value.receiptStatus,
    qrToken: value.qrExpiresAt !== null && value.qrExpiresAt > Date.now() ? value.qrToken : null,
    refresh,
  };
}
