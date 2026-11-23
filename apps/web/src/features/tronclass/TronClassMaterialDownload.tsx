'use client';

import { useEffect, useRef, useState } from 'react';
import { tronClassErrorMessage, TronClassRequestError, type TronClassClient } from '@/lib/tronClassIntegrationClient';
import styles from './tronclass.module.css';

export function TronClassMaterialDownload({
  client,
  revision,
  courseId,
  activityId,
  uploadKey,
  name,
  onConnectionChanged,
}: {
  client: TronClassClient;
  revision: string;
  courseId: number;
  activityId: number;
  uploadKey: string;
  name: string;
  onConnectionChanged?: (reason?: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const connectionChanged = useRef(onConnectionChanged);
  useEffect(() => { connectionChanged.current = onConnectionChanged; }, [onConnectionChanged]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await client.downloadMaterial({ courseId, activityId, uploadKey, revision });
      // The caller keys this component by account, revision, course, activity and file.
      if (!alive.current) return;
      const objectUrls = URL;
      const href = objectUrls.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = result.filename;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => objectUrls.revokeObjectURL(href), 1000);
      }
      setMessage('已開始下載。');
    } catch (reason) {
      if (!alive.current) return;
      if (connectionChanged.current && reason instanceof TronClassRequestError &&
        ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED'].includes(reason.code)) {
        connectionChanged.current(reason);
        return;
      }
      setError(tronClassErrorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div>
      <button
        className={`${styles.textButton} ${styles.sourceLink}`}
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? '正在下載' : '下載'} {name}
      </button>
      {message && (
        <span className={styles.muted} role="status">
          {' '}
          {message}
        </span>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
