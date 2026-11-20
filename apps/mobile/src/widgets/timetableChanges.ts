const listeners = new Set<() => void>();
export function subscribeTimetableChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyTimetableChanged() {
  for (const listener of listeners) listener();
}
