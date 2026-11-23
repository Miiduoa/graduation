'use client';

import { useEffect, useRef, useState } from 'react';
import { tronClassErrorMessage, TronClassRequestError, type TronClassClient } from '@/lib/tronClassIntegrationClient';
import styles from './tronclass.module.css';

export function TronClassSubmissionAttachmentDownload({
  download, revision, courseId, homeworkId, submissionId, uploadId, name, onConnectionChanged,
}: {
  download: TronClassClient['downloadSubmissionAttachment'];
  revision: string;
  courseId: number;
  homeworkId: number;
  submissionId: string;
  uploadId: number;
  name: string;
  onConnectionChanged?: (reason?: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const connectionChanged = useRef(onConnectionChanged);
  useEffect(() => { connectionChanged.current = onConnectionChanged; }, [onConnectionChanged]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; pending.current?.abort(); };
  }, []);

  async function save() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await download({ courseId, homeworkId, submissionId, uploadId, revision }, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      const objectUrls = URL;
      const href = objectUrls.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = href; link.download = result.filename;
      document.body.appendChild(link);
      try { link.click(); }
      finally {
        link.remove();
        setTimeout(() => objectUrls.revokeObjectURL(href), 1000);
      }
      setMessage('已開始下載。');
    } catch (reason) {
      if (!alive.current || controller.signal.aborted) return;
      if (reason instanceof TronClassRequestError &&
        ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED', 'SESSION_CHANGED', 'SIGN_IN_REQUIRED'].includes(reason.code) &&
        connectionChanged.current) {
        connectionChanged.current(reason);
      } else setError(tronClassErrorMessage(reason));
    } finally {
      pending.current = null;
      if (alive.current) setBusy(false);
    }
  }

  return <div>
    <button type="button" className={`${styles.textButton} ${styles.sourceLink}`} disabled={busy} onClick={() => void save()}>
      {busy ? '正在下載' : '下載'} {name}
    </button>
    {message && <span className={styles.muted} role="status"> {message}</span>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
