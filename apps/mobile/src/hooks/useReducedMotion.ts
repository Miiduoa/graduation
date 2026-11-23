import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useOptionalAccessibility } from '../state/accessibility';
import { useOptionalPreferences } from '../state/preferences';

// All app chrome shares one native observer. Newly mounted controls can use an
// already-known preference without first skipping their entrance animation.
let systemReduced = true;
let generation = 0;
let subscription: { remove: () => void } | undefined;
const listeners = new Set<() => void>();
const snapshot = () => systemReduced;
const serverSnapshot = () => true;

function publish(enabled: boolean) {
  if (systemReduced === enabled) return;
  systemReduced = enabled;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    const current = ++generation;
    let changed = false;
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (current !== generation) return;
      changed = true;
      publish(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (current === generation && !changed) publish(enabled);
      },
      () => {
        // Keep motion reduced when the system cannot report its preference.
      },
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    ++generation;
    subscription?.remove();
    subscription = undefined;
    // A system change while nobody is observing must be read again safely.
    systemReduced = true;
  };
}

/** Either app preference or the system setting can request less motion. */
export function useReducedMotion(): boolean {
  const accessibility = useOptionalAccessibility();
  const preferences = useOptionalPreferences();
  const reduced = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  return (
    reduced ||
    accessibility?.settings.reduceMotion === true ||
    preferences?.preferences.reduceMotion === true
  );
}
