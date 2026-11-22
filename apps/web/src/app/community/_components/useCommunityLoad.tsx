'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isReadAccessDeniedError } from '@campus/shared/src/signedInSocialReads';
import styles from '../community.module.css';

export function useCommunityLoad(
  load: (isCurrent: () => boolean) => Promise<void>,
  message: string,
  clearDeniedData?: () => void,
) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      await load(() => generation.current === current);
      if (generation.current === current) {
        setLoaded(true);
        setDenied(false);
      }
      return true;
    } catch (cause) {
      if (generation.current === current) {
        if (clearDeniedData && isReadAccessDeniedError(cause)) {
          clearDeniedData();
          setLoaded(false);
          setDenied(true);
        }
        setError(message);
      }
      return false;
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [load, message, clearDeniedData]);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) void refresh();
    });
    return () => {
      mounted = false;
      generation.current += 1;
    };
  }, [refresh]);
  return { loading, loaded, error: denied ? message : error, denied, refresh };
}

export function CommunityLoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => Promise<unknown>;
}) {
  return (
    <section className={styles.status} role="alert">
      <p>{message}</p>
      <button className="btn" type="button" onClick={() => void retry()}>
        重新讀取
      </button>
    </section>
  );
}
