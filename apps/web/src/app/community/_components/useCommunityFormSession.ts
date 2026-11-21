'use client';

import { useEffect, useRef, useState } from 'react';

export const COMMUNITY_FORM_WAIT_MS = 15_000;
export const COMMUNITY_FORM_PENDING_COPY =
  '仍在等待送出結果。你可以先關閉，再從本頁開啟查看進度。這次送出仍可能完成，請勿重複送出。';
export type CommunityFormCloseReason = 'cancel' | 'pending';
export type CommunityFormDisplay = 'closed' | 'open' | 'pending-hidden';

/** A retained form owns its write, even while its dialog is temporarily hidden. */
export function useCommunityFormSession(onClose: (reason: CommunityFormCloseReason) => void) {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mayHide = useRef(false);
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
    if (!mounted.current || (inFlight.current && !mayHide.current)) return;
    onClose(inFlight.current ? 'pending' : 'cancel');
  }

  async function submit(
    write: () => Promise<unknown>,
    onSaved: () => void,
    failureMessage: string,
  ) {
    if (inFlight.current || !mounted.current) return;
    inFlight.current = true;
    mayHide.current = false;
    setBusy(true);
    setSlow(false);
    setError('');
    // Firestore writes may remain queued while offline. This only releases the
    // dialog; it never cancels the write, unlocks submission, or starts a retry.
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      if (mounted.current && inFlight.current) {
        mayHide.current = true;
        setSlow(true);
      }
    }, COMMUNITY_FORM_WAIT_MS);
    let saved = false;
    try {
      await write();
      saved = true;
    } catch {
      if (mounted.current) setError(failureMessage);
    } finally {
      if (waitTimer.current !== null) clearTimeout(waitTimer.current);
      waitTimer.current = null;
      inFlight.current = false;
      mayHide.current = false;
      if (mounted.current) {
        setBusy(false);
        setSlow(false);
      }
    }
    // List refreshes belong to the parent. They must not turn a successful write
    // into a retry prompt, or let an old opening close a newly opened form.
    if (saved && mounted.current) onSaved();
  }

  return { busy, slow, canClose: !busy || slow, error, setError, requestClose, submit };
}
