import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  loadEventRegistrationStates,
  subscribeEventRegistrations,
  type EventRegistrationState,
} from '../services/eventRegistration';
export function useEventRegistrations(eventIds: string[]) {
  const { user } = useAuth();
  const { school } = useSchool();
  const key = JSON.stringify([user?.uid, school.id, eventIds]);
  const active = useRef({ key });
  if (active.current.key !== key) active.current = { key };
  const [state, setState] = useState<{
    key: string;
    states: EventRegistrationState[];
    loading: boolean;
    error: boolean;
  }>({ key, states: [], loading: false, error: false });
  const request = useRef(0);
  const reload = useCallback(async () => {
    const generation = ++request.current;
    const scope = active.current;
    const current = () => scope === active.current && request.current === generation;
    if (!user?.uid || !eventIds.length) {
      setState({ key, states: [], loading: false, error: false });
      return;
    }
    setState({ key, states: [], loading: true, error: false });
    try {
      const states = await loadEventRegistrationStates(
        { uid: user.uid, schoolId: school.id },
        eventIds,
        current,
      );
      if (current()) setState({ key, states, loading: false, error: false });
    } catch {
      if (current()) setState({ key, states: [], loading: false, error: true });
    }
    // IDs are serialized in key so array allocation does not cause repeated requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void reload();
    return () => {
      request.current += 1;
    };
  }, [reload]);
  useEffect(
    () =>
      subscribeEventRegistrations((scope) => {
        if (scope.uid === user?.uid && scope.schoolId === school.id) void reload();
      }),
    [user?.uid, school.id, reload],
  );
  return {
    ...(state.key === key ? state : { states: [], loading: true, error: false }),
    reload,
    uid: user?.uid ?? '',
    schoolId: school.id,
  };
}
