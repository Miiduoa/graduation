import { useSyncExternalStore } from 'react';

const operatorSession = {
  platformAccountId: 'pa_00000000-0000-4000-8000-000000000001',
  context: 'a'.repeat(43),
  isPlatformOperator: true,
};

let snapshot = {
  session: operatorSession as typeof operatorSession | null,
  loading: false,
  pendingLogout: false,
  error: '',
};
const listeners = new Set<() => void>();

function update(change: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeFixtureSession(role: string) {
  snapshot = {
    session: role === 'guest' ? null : { ...operatorSession, isPlatformOperator: role === 'operator' },
    loading: false,
    pendingLogout: false,
    error: '',
  };
  Object.assign(window, {
    __adminFixtureSession: (change: Partial<typeof snapshot>) => update(change),
    __adminFixtureOperator: operatorSession,
  });
}

export function useNuniSession() {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return {
    ...value,
    refresh: async () => update({ loading: false, error: '' }),
    logout: async () => update({ session: null, loading: false, pendingLogout: false }),
  };
}
