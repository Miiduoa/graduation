'use client';

import { useEffect, useRef, useState } from 'react';

export const COMMUNITY_FORM_WAIT_MS = 15_000;
export const COMMUNITY_FORM_PENDING_COPY =
  '仍在等待送出結果。你可以先關閉，再從本頁開啟查看進度。這次送出仍可能完成，請勿重複送出。';
export type CommunityFormCloseReason = 'cancel' | 'retain';
export type CommunityFormDisplay = 'closed' | 'open' | 'retained-hidden';

/** A retained form owns its write, even while its dialog is temporarily hidden. */
export function useCommunityFormSession(onClose: (reason: CommunityFormCloseReason) => void) {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const writeFailed = useRef(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waitTimer.current !== null) clearTimeout(waitTimer.current);
    };
  }, []);

  function requestClose() {
    if (!mounted.current) return;
    onClose(inFlight.current || writeFailed.current ? 'retain' : 'cancel');
  }

  async function submit(
    write: () => Promise<unknown>,
    onSaved: () => void,
    failureMessage: string,
  ) {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    setBusy(true);
    setSlow(false);
    setError('');
    // Firestore writes may remain queued while offline. The timer only updates
    // the status message while the write continues.
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      if (mounted.current && inFlight.current) {
        setSlow(true);
      }
    }, COMMUNITY_FORM_WAIT_MS);
    let saved = false;
    try {
      await write();
      writeFailed.current = false;
      saved = true;
    } catch {
      writeFailed.current = true;
      if (mounted.current) setError(failureMessage);
    } finally {
      if (waitTimer.current !== null) clearTimeout(waitTimer.current);
      waitTimer.current = null;
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        setSlow(false);
      }
    }
    // List refreshes belong to the parent. They must not turn a successful write
    // into a retry prompt, or let an old opening close a newly opened form.
    if (saved && mounted.current) onSaved();
  }

  return { busy, slow, error, setError, requestClose, submit };
}
