'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isStudentCardToken,
  isStudentCardVerification,
  STUDENT_CARD_TTL_MS,
  type StudentCardVerification,
} from '@campus/shared/src/studentCard';
import styles from './check.module.css';

type Check = 'initial' | 'ready' | 'checking' | 'unavailable' | 'retry' | StudentCardVerification;

export function StudentCardCheck() {
  const token = useRef('');
  const verificationId = useRef('');
  const pending = useRef<AbortController | null>(null);
  const [check, setCheck] = useState<Check>('initial');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const clear = useCallback(() => {
    token.current = '';
    verificationId.current = '';
    pending.current?.abort();
    pending.current = null;
    setExpiresAt(null);
    setCheck('unavailable');
  }, []);

  useEffect(() => {
    function readCode(event?: Event) {
      const value = window.location.hash.slice(1);
      if (!value && !event && token.current) return;
      clear();
      if (!value) return;
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (!isStudentCardToken(value)) return;
      token.current = value;
      setExpiresAt(Date.now() + STUDENT_CARD_TTL_MS);
      setCheck('ready');
    }
    function onVisibility() {
      if (document.hidden) clear();
    }
    readCode();
    window.addEventListener('hashchange', readCode);
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener('hashchange', readCode);
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clear]);

  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(clear, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [clear, expiresAt]);

  async function verify() {
    if (!token.current || pending.current || expiresAt === null) return;
    if (Date.now() >= expiresAt) {
      clear();
      return;
    }
    const request = new AbortController();
    pending.current = request;
    setCheck('checking');
    const timeout = window.setTimeout(() => {
      if (!request.signal.aborted && pending.current === request) {
        request.abort();
        pending.current = null;
        setCheck('retry');
      }
    }, 15_000);
    try {
      if (!verificationId.current) verificationId.current = crypto.randomUUID();
      const response = await fetch('/api/student-card/verify', {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current, verificationId: verificationId.current }),
      });
      if (request.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) setCheck('retry');
        else clear();
        return;
      }
      const body = await response.text();
      if (request.signal.aborted) return;
      let receipt: unknown;
      try {
        receipt = body.length <= 2_048 ? JSON.parse(body) : null;
      } catch {
        clear();
        return;
      }
      if (!isStudentCardVerification(receipt)) {
        clear();
        return;
      }
      token.current = '';
      verificationId.current = '';
      setExpiresAt(Math.min(receipt.verifiedAt, Date.now()) + STUDENT_CARD_TTL_MS);
      setCheck(receipt);
    } catch {
      if (!request.signal.aborted) setCheck('retry');
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === request) pending.current = null;
    }
  }

  const valid = typeof check !== 'string';
  return (
    <main className={styles.page}>
      <section
        className={styles.panel}
        aria-labelledby="card-check-title"
        aria-busy={check === 'checking'}
      >
        <div className={styles.mast}>
          <strong>nuni</strong>
          <span>學生證核對</span>
        </div>
        <div role="status" aria-live="polite">
          <h1 id="card-check-title">
            {valid ? '學號已核對' : check === 'unavailable' ? '需要新的驗證碼' : '核對校園學號'}
          </h1>
          {valid ? (
            <>
              <p>請與出示者卡面上的學校及學號末四碼比對。</p>
              <dl className={styles.receipt}>
                <dt>學校</dt>
                <dd>{check.schoolName}</dd>
                <dt>學號</dt>
                <dd>{check.maskedId}</dd>
                <dt>核對時間</dt>
                <dd>
                  <time dateTime={new Date(check.verifiedAt).toISOString()}>
                    {new Date(check.verifiedAt).toLocaleTimeString('zh-TW', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </dd>
              </dl>
              <p>這組驗證碼已使用。</p>
            </>
          ) : check === 'unavailable' ? (
            <p>請出示者重新取得驗證碼，再用相機掃描。</p>
          ) : (
            <p>
              {check === 'retry'
                ? '暫時無法連線核對，請稍候再試。'
                : '向 nuni 核對校園登入提供的學號。每組驗證碼限用一次。'}
            </p>
          )}
        </div>
        {(check === 'ready' || check === 'retry' || check === 'checking') && (
          <button className={styles.button} disabled={check === 'checking'} onClick={verify}>
            {check === 'checking' ? '核對中…' : check === 'retry' ? '再試一次' : '核對這張卡'}
          </button>
        )}
        <footer>門禁、借書與在學證明請依校方規定辦理。</footer>
      </section>
    </main>
  );
}
