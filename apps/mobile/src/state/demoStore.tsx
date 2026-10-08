import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  hydrateDemoStore,
  getDemoStore,
  subscribeDemoStore,
  type DemoStore,
} from '../services/demoStore';
import { useAuth } from './auth';
import { isDevelopmentDemoSession } from '../services/release';

const EMPTY: DemoStore = {
  dynamicMessages: [],
  leaveRequests: [],
  dormRepairs: [],
  orders: [],
  helpRequests: [],
  clubMemberships: [],
  submissions: [],
  borrowingOverrides: {},
  libraryReservations: [],
  readMessageIds: [],
};
const DemoStoreContext = createContext<DemoStore | null>(null);

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const enabled = isDevelopmentDemoSession(uid);
  const [snapshot, setSnapshot] = useState<{ uid: string; store: DemoStore } | null>(null);
  useEffect(() => {
    if (!enabled || !uid) return;
    let active = true;
    const update = () => {
      if (active) setSnapshot({ uid, store: getDemoStore() });
    };
    update();
    void hydrateDemoStore().then(update);
    const unsubscribe = subscribeDemoStore(update);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, uid]);
  return (
    <DemoStoreContext.Provider value={enabled && snapshot?.uid === uid ? snapshot.store : EMPTY}>
      {children}
    </DemoStoreContext.Provider>
  );
}

export function useDemoStore(): DemoStore {
  const { user } = useAuth();
  const context = useContext(DemoStoreContext);
  if (!isDevelopmentDemoSession(user?.uid)) return EMPTY;
  return context ?? EMPTY;
}
