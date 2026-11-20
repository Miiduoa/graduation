export function assignmentLifecycle() {
  let hidden = false;
  return {
    active: () => !hidden && document.visibilityState !== 'hidden',
    online: () => navigator.onLine !== false,
    subscribe(changed: () => void) {
      const hide = () => { hidden = true; changed(); };
      const show = () => { hidden = false; changed(); };
      window.addEventListener('pagehide', hide);
      window.addEventListener('pageshow', show);
      document.addEventListener('visibilitychange', changed);
      window.addEventListener('online', changed);
      window.addEventListener('offline', changed);
      return () => {
        window.removeEventListener('pagehide', hide);
        window.removeEventListener('pageshow', show);
        document.removeEventListener('visibilitychange', changed);
        window.removeEventListener('online', changed);
        window.removeEventListener('offline', changed);
      };
    },
  };
}
