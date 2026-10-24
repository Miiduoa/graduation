import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';

/** Separate from rootNavigationRef — PublicNavigation mounts its own container. */
export const publicNavigationRef = createNavigationContainerRef<PreAuthStackParamList>();

type PublicReadyListener = () => void;
const readyListeners = new Set<PublicReadyListener>();
let publicReady = false;

export function markPublicNavigationReady() {
  publicReady = true;
  for (const listener of [...readyListeners]) {
    try {
      listener();
    } catch {
      /* readiness adapters must not throw into NavigationContainer */
    }
  }
}

export function markPublicNavigationUnready() {
  publicReady = false;
}

export function subscribePublicNavigationReady(listener: PublicReadyListener) {
  readyListeners.add(listener);
  if (publicReady && publicNavigationRef.isReady()) listener();
  return () => {
    readyListeners.delete(listener);
  };
}

export function isPublicNavigationReady() {
  return publicReady && publicNavigationRef.isReady();
}

export function publicNavigatePersonalCalendar(params?: { eventId?: string }) {
  if (!isPublicNavigationReady()) return false;
  publicNavigationRef.dispatch(
    CommonActions.navigate({
      name: 'PersonalCalendar',
      params: params?.eventId ? { eventId: params.eventId } : undefined,
    }),
  );
  return true;
}
