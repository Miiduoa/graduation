'use client';

import { useEffect, useState } from 'react';
import { isFirebaseConfigured } from './firebase';

export type SchoolCollectionSource = 'firebase' | 'unavailable';
type SubscribeLiveCollection<T> = (
  schoolId: string,
  onData: (data: T[]) => void,
  onError: (error: unknown) => void,
) => () => void;

type CollectionState<T> = {
  scope: string;
  attempt: number;
  data: T[];
  loading: boolean;
  error: unknown | null;
};

export function useSchoolCollectionData<T>(
  schoolId: string,
  loadLive: ((schoolId: string) => Promise<T[]>) | undefined,
  options?: { subscribeLive?: SubscribeLiveCollection<T>; scopeKey?: string },
) {
  const scope = JSON.stringify([schoolId, options?.scopeKey ?? 'public']);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CollectionState<T> | null>(null);
  const subscribeLive = options?.subscribeLive;
  const configured = isFirebaseConfigured();

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (error: unknown) => {
      if (active) setState({ scope, attempt, data: [], loading: false, error });
    };
    const receive = (data: T[]) => {
      if (!Array.isArray(data)) {
        fail(new Error('Invalid collection response'));
      } else if (active) {
        setState({ scope, attempt, data, loading: false, error: null });
      }
    };
    setState({ scope, attempt, data: [], loading: true, error: null });
    if (!configured || !schoolId) {
      fail(new Error('School data is not configured'));
    } else if (subscribeLive) {
      try {
        unsubscribe = subscribeLive(schoolId, receive, fail);
      } catch (error) {
        fail(error);
      }
    } else if (loadLive) {
      try {
        void loadLive(schoolId).then(receive, fail);
      } catch (error) {
        fail(error);
      }
    } else {
      fail(new Error('School data source is unavailable'));
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [attempt, configured, loadLive, schoolId, scope, subscribeLive]);

  const current = state?.scope === scope && state.attempt === attempt ? state : null;
  return {
    data: current?.data ?? [],
    loading: current?.loading ?? true,
    error: current?.error ?? null,
    sourceMode: (current && !current.loading && !current.error
      ? 'firebase'
      : 'unavailable') as SchoolCollectionSource,
    firebaseEnabled: configured,
    retry: () => setAttempt((value) => value + 1),
  };
}
