'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/components/AuthGuard';
import { getAuth, getDb, isFirebaseConfigured } from '@/lib/firebase';

type AccessStatus = 'loading' | 'allowed' | 'denied' | 'error';
type AccessState = { scope: string; status: AccessStatus; epoch: number };

export function useBoardCreationAccess(schoolId: string): {
  status: AccessStatus;
  authorizationEpoch: number;
  isAuthorized: () => boolean;
  retry: () => void;
} {
  const { user, loading, error } = useAuth();
  const uid = user?.uid ?? null;
  const authFailed = Boolean(error);
  const scope = JSON.stringify([uid, schoolId, loading, authFailed]);
  const validSchool = Boolean(schoolId && !schoolId.includes('/'));
  const [state, setState] = useState<AccessState>({ scope: '', status: 'loading', epoch: 0 });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const authorization = useRef({ scope: '', epoch: 0, allowed: false });

  // Invalidate before the new scope can handle an event, including an A → B → A switch.
  useLayoutEffect(() => {
    authorization.current = { scope, epoch: authorization.current.epoch + 1, allowed: false };
    return () => {
      authorization.current = { scope: '', epoch: authorization.current.epoch + 1, allowed: false };
    };
  }, [scope]);

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    const current = () => active && request === generation.current && authorization.current.scope === scope;
    const publish = (status: AccessStatus) => {
      if (!current()) return;
      const previous = authorization.current;
      const allowed = status === 'allowed';
      const epoch = previous.epoch + (previous.allowed !== allowed ? 1 : 0);
      authorization.current = { scope, epoch, allowed };
      setState({ scope, status, epoch });
    };
    let stop: (() => void) | undefined;

    if (authFailed) {
      publish('error');
    } else if (loading) {
      publish('loading');
    } else if (!uid || !validSchool) {
      publish('denied');
    } else {
      publish('loading');
      try {
        if (!isFirebaseConfigured() || getAuth()?.currentUser?.uid !== uid) {
          publish('error');
        } else {
          stop = onSnapshot(
            doc(getDb(), 'schools', schoolId, 'members', uid),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (!current()) return;
              if (getAuth()?.currentUser?.uid !== uid) {
                publish('denied');
                return;
              }
              if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
                publish('error');
                return;
              }
              const member = snapshot.exists() ? snapshot.data() : null;
              publish(
                member?.status === 'active' && (member.role === 'admin' || member.role === 'editor')
                  ? 'allowed'
                  : 'denied',
              );
            },
            () => {
              publish('error');
              active = false;
            },
          );
        }
      } catch {
        publish('error');
      }
    }

    return () => {
      active = false;
      stop?.();
    };
  }, [scope, uid, schoolId, validSchool, loading, authFailed, attempt]);

  const authorizationEpoch = state.scope === scope ? state.epoch : -1;
  const status = state.scope === scope
    ? state.status
    : authFailed ? 'error' : !loading && (!uid || !validSchool) ? 'denied' : 'loading';

  const isAuthorized = useCallback(() => {
    const current = authorization.current;
    return !loading && !authFailed && Boolean(uid) && current.scope === scope && current.allowed
      && current.epoch === authorizationEpoch && getAuth()?.currentUser?.uid === uid;
  }, [scope, uid, loading, authFailed, authorizationEpoch]);

  const retry = useCallback(() => {
    if (authorization.current.scope !== scope) return;
    generation.current += 1;
    const epoch = authorization.current.epoch + 1;
    authorization.current = { scope, epoch, allowed: false };
    setState({ scope, status: authFailed ? 'error' : !loading && (!uid || !validSchool) ? 'denied' : 'loading', epoch });
    setAttempt((value) => value + 1);
  }, [scope, uid, loading, validSchool, authFailed]);

  return { status, authorizationEpoch, isAuthorized, retry };
}
