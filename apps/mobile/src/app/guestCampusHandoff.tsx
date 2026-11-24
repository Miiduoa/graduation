import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { GuestCampusService } from '../screens/guestCampusServices';

type Destination = { route: GuestCampusService; schoolId: string };

function createHandoff(isCurrent: () => boolean) {
  let pending: Destination | null = null;
  return {
    remember(destination: Destination) {
      if (isCurrent()) pending = destination;
    },
    clear() {
      pending = null;
    },
    consume(schoolId: string | null, currentRoute: string | undefined) {
      const destination = pending;
      pending = null;
      return isCurrent() &&
        destination &&
        destination.schoolId === schoolId &&
        currentRoute === 'LoginLanding'
        ? destination.route
        : undefined;
    },
  };
}

const Context = createContext<ReturnType<typeof createHandoff> | null>(null);

/** App-local and one-shot. The school-scoped schedule provider remounts its children on selection. */
export function GuestCampusHandoffProvider({
  identity,
  enabled,
  children,
}: {
  identity: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const currentIdentity = useRef<string | null>(null);
  const handoff = useMemo(
    () => (enabled ? createHandoff(() => currentIdentity.current === identity) : null),
    [identity, enabled],
  );
  useLayoutEffect(() => {
    currentIdentity.current = enabled ? identity : null;
    return () => {
      currentIdentity.current = null;
      handoff?.clear();
    };
  }, [identity, enabled, handoff]);
  return <Context.Provider value={handoff}>{children}</Context.Provider>;
}

export function useGuestCampusHandoff() {
  return useContext(Context);
}
