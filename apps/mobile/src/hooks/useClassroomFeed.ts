import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { collection, limit, onSnapshot, orderBy, query, type Firestore } from 'firebase/firestore';

export function useClassroomFeed<T>(
  db: Firestore,
  identity: { groupId?: string; sessionId?: string; userId?: string; schoolId?: string },
  authSession: object | null,
  enabled: boolean,
  kind: 'questions' | 'polls',
) {
  const { groupId, sessionId, userId, schoolId } = identity;
  const key = JSON.stringify([groupId, sessionId, userId, schoolId, enabled, kind]);
  const identityRef = useRef({ key, authSession });
  identityRef.current = { key, authSession };
  const [state, setState] = useState({
    key,
    authSession,
    items: [] as T[],
    error: null as string | null,
  });
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let stop: (() => void) | undefined;
    const current = () =>
      !disposed &&
      identityRef.current.key === key &&
      identityRef.current.authSession === authSession;
    const restart = (foreground: boolean) => {
      generation += 1;
      stop?.();
      stop = undefined;
      if (!current()) return;
      setState({ key, authSession, items: [], error: null });
      if (!foreground || !enabled || !authSession || !userId || !groupId || !sessionId) return;
      const request = generation;
      let failed = false;
      const valid = () => current() && request === generation && !failed;
      const ref = collection(db, 'groups', groupId, 'liveSessions', sessionId, kind);
      const source =
        kind === 'questions'
          ? query(ref, orderBy('upvotes', 'desc'), limit(30))
          : query(ref, orderBy('createdAt', 'desc'));
      stop = onSnapshot(
        source,
        (snapshot) => {
          if (!valid()) return;
          setState({
            key,
            authSession,
            items: snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as T),
            error: null,
          });
        },
        () => {
          if (!valid()) return;
          failed = true;
          setState({
            key,
            authSession,
            items: [],
            error:
              kind === 'questions'
                ? '無法載入問答，請重新進入課堂。'
                : '無法載入投票，請重新進入課堂。',
          });
        },
      );
    };
    const listener = AppState.addEventListener('change', (state) => restart(state === 'active'));
    restart(AppState.currentState === 'active');
    return () => {
      disposed = true;
      generation += 1;
      stop?.();
      listener.remove();
    };
  }, [db, key, authSession, enabled, groupId, sessionId, userId, kind]);
  return state.key === key && state.authSession === authSession
    ? state
    : { items: [] as T[], error: null };
}
