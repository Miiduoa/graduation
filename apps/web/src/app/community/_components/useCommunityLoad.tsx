'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../community.module.css';

export function useCommunityLoad(
  load: (isCurrent: () => boolean) => Promise<void>,
  message: string,
  active = true,
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      await load(() => generation.current === current);
      return true;
    } catch {
      if (generation.current === current) setError(message);
      return false;
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [load, message]);
  useEffect(() => {
    let mounted = true;
    if (active) {
      void Promise.resolve().then(() => {
        if (mounted) void refresh();
      });
    }
    return () => {
      mounted = false;
      generation.current += 1;
    };
  }, [active, refresh]);
  return { loading, error, refresh };
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
