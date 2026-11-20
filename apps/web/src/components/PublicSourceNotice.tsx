'use client';

import { useEffect, useRef, useState } from 'react';
import { publicSourceStatus, publicSourceUrl } from '@/lib/publicSourceStatus';
import styles from './PublicSourceNotice.module.css';

type Props = {
  sourceLabel?: string | undefined;
  confirmedAt?: string | undefined;
  timeLabel?: string;
  expired?: boolean;
  officialUrl?: string | null | undefined;
  officialLabel?: string;
  children?: React.ReactNode;
};

export function PublicSourceNotice({
  sourceLabel,
  confirmedAt,
  timeLabel = '最後確認',
  expired,
  officialUrl,
  officialLabel = '官方入口',
  children,
}: Props) {
  const status = publicSourceStatus(confirmedAt, expired);
  const url = publicSourceUrl(officialUrl);
  const [message, setMessage] = useState('');
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const copyRevision = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyRevision.current += 1;
      copyingRef.current = false;
    };
  }, []);

  async function copyUrl() {
    if (copyingRef.current || !mounted.current) return;
    const run = ++copyRevision.current;
    copyingRef.current = true;
    setCopying(true);
    setMessage('');
    try {
      if (!url || !navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(url);
      if (mounted.current && run === copyRevision.current) {
        setMessage('已複製網址，可貼到瀏覽器開啟。');
      }
    } catch {
      if (mounted.current && run === copyRevision.current) {
        setMessage('無法自動複製，請選取下方網址後複製，再貼到瀏覽器開啟。');
      }
    } finally {
      if (mounted.current && run === copyRevision.current) {
        copyingRef.current = false;
        setCopying(false);
      }
    }
  }

  return (
    <section className={styles.notice} aria-label="資料來源與新鮮度">
      <dl>
        <div>
          <dt>資料來源</dt>
          <dd>{sourceLabel?.trim() || '未提供，尚無法確認資料出處'}</dd>
        </div>
        <div>
          <dt>{timeLabel}</dt>
          <dd>{status.date}</dd>
        </div>
      </dl>
      <p>{status.message}</p>
      {children}
      {url ? (
        <>
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
            {officialLabel} ↗
          </a>
          <p>在新分頁開啟。</p>
          <details>
            <summary>官方網站開不了？</summary>
            <p>若新分頁未開啟或網站暫時無法連線，可複製網址到瀏覽器重試，或稍後再查。</p>
            <button
              className="btn"
              type="button"
              disabled={copying}
              aria-busy={copying}
              onClick={() => void copyUrl()}
            >
              複製官方網址
            </button>
            <p className={styles.url}>{url}</p>
            <p role="status">{copying ? '正在複製網址…' : message}</p>
          </details>
        </>
      ) : (
        <p>尚無可用的官方入口，請從學校官網查找聯絡方式，向承辦單位或店家確認。</p>
      )}
    </section>
  );
}
