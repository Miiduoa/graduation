'use client';

import { useEffect, useRef, useState } from 'react';

/** One opening owns its write and callbacks, including during account or route changes. */
export function useCommunityFormSession(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function requestClose() {
    if (inFlight.current || !mounted.current) return;
    onClose();
  }

  async function submit(
    write: () => Promise<unknown>,
    onSaved: () => void,
    failureMessage: string,
  ) {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    let saved = false;
    try {
      await write();
      saved = true;
    } catch {
      if (mounted.current) setError(failureMessage);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
    // List refreshes belong to the parent. They must not turn a successful write
    // into a retry prompt, or let an old opening close a newly opened form.
    if (saved && mounted.current) onSaved();
  }

  return { busy, error, setError, requestClose, submit };
}
