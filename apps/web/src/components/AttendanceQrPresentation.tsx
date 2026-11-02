'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { attendanceCountdown, attendanceProjectionCount, canPresentAttendanceQr } from '@/lib/attendanceProjection';
import styles from './attendance-qr-presentation.module.css';

type Props = {
  image: string;
  courseName: string;
  expiresAt: string | null;
  remainingSeconds: number | null;
  attendeeCount: number;
  onHideCode: () => void;
};

/** A local modal, not a public sharing URL. No roster, token text or write actions. */
export function AttendanceQrPresentation({
  image, courseName, expiresAt, remainingSeconds, attendeeCount, onHideCode,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const hintId = useId();
  const dismiss = useCallback(() => {
    if (dialog.current?.open) dialog.current.close();
    setShowing(false);
  }, []);

  useEffect(() => {
    if (!showing) return;
    const hide = () => { dismiss(); onHideCode(); };
    const visibility = () => { if (document.visibilityState !== 'visible') hide(); };
    if (!canPresentAttendanceQr(image, expiresAt, Date.now()) ||
        document.visibilityState !== 'visible' || navigator.onLine === false) {
      hide();
      return;
    }
    closeButton.current?.focus();
    const timer = window.setTimeout(hide, Math.max(0, Date.parse(expiresAt ?? '') - Date.now()));
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('offline', hide);
    const node = dialog.current;
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('offline', hide);
      // Also release top-layer modality when the session or permission unmounts us.
      if (node?.open) node.close();
    };
  }, [showing, image, expiresAt, dismiss, onHideCode]);

  function present() {
    setError('');
    if (!canPresentAttendanceQr(image, expiresAt, Date.now()) ||
        document.visibilityState !== 'visible' || navigator.onLine === false) {
      setError('目前無法投影，請重新核對連線與簽到期限。');
      onHideCode();
      return;
    }
    if (!dialog.current || typeof dialog.current.showModal !== 'function') {
      setError('此瀏覽器無法開啟投影視窗，請使用頁面上的 QR Code。');
      return;
    }
    try {
      dialog.current.showModal();
      setShowing(true);
      closeButton.current?.focus();
    } catch {
      setError('無法開啟投影視窗，請使用頁面上的 QR Code。');
    }
  }

  return <>
    <button ref={trigger} type="button" className={styles.launch} onClick={present}>
      放大投影 QR Code
    </button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={hintId}
      onClose={() => {
        setShowing(false);
        if (document.visibilityState === 'visible' && trigger.current?.isConnected) trigger.current.focus();
      }}>
      {showing && <div className={styles.frame}>
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>CAMPUS ONE · 課堂簽到</p>
            <h2 id={titleId}>{courseName.trim() || '課堂簽到'}</h2></div>
          <button ref={closeButton} type="button" className={styles.close} onClick={dismiss}>
            結束投影
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.qrFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} width={768} height={768} alt="本次課堂投影簽到 QR Code" />
          </div>
          <div className={styles.instructions}>
            <span className={styles.badge}>點名進行中</span>
            <p id={hintId} className={styles.hint}>在 Campus One 課堂頁開啟相機，掃描後按「確認簽到」。</p>
            <div className={styles.metrics}>
              <div><span>剩餘簽到時間</span><strong aria-label={`剩餘 ${attendanceCountdown(remainingSeconds)}`}>
                {attendanceCountdown(remainingSeconds)}
              </strong></div>
              <div><span>已確認出席</span><strong>{attendanceProjectionCount(attendeeCount)}<small> 人</small></strong></div>
            </div>
            <p className={styles.note}>以伺服器保存的出席紀錄為準。掃到代碼不代表已完成簽到。</p>
            <p className={styles.privacy}>此視窗不顯示學生姓名、學號或更正原因。切換背景、離線或期限結束時會收起代碼。</p>
          </div>
        </div>
        <footer className={styles.footer}>
          <span>按 Esc 或「結束投影」返回；不會結束這次點名。</span>
          <span>僅向本堂課學生出示</span>
        </footer>
      </div>}
    </dialog>
  </>;
}
