'use client';

import { useEffect, useRef, useState } from 'react';
import { isStudentCardToken, STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import styles from './check.module.css';

type Check =
  | 'initial'
  | 'ready'
  | 'checking'
  | 'unavailable'
  | 'retry'
  | { schoolName: string; maskedId: string };

export function StudentCardCheck() {
  const token = useRef('');
  const pending = useRef<AbortController | null>(null);
  const [check, setCheck] = useState<Check>('initial');

  useEffect(() => {
    function readCode() {
      const value = window.location.hash.slice(1);
      if (value) {
        window.history.replaceState(window.history.state, '', window.location.pathname);
        pending.current?.abort();
        token.current = isStudentCardToken(value) ? value : '';
      }
      setCheck(token.current ? 'ready' : 'unavailable');
    }
    function clear() {
      token.current = '';
      pending.current?.abort();
      setCheck('unavailable');
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
      window.removeEventListener('hashchange', readCode);
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (typeof check === 'string') return;
    const timer = window.setTimeout(() => setCheck('unavailable'), STUDENT_CARD_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [check]);

  async function verify() {
    if (!token.current || pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setCheck('checking');
    const timeout = window.setTimeout(() => {
      if (!request.signal.aborted && pending.current === request) {
        request.abort();
        setCheck('retry');
      }
    }, 15_000);
    try {
      const response = await fetch('/api/student-card/verify', {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: request.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current }),
      });
      if (!response.ok) {
        if (!request.signal.aborted)
          setCheck(response.status === 429 || response.status >= 500 ? 'retry' : 'unavailable');
        return;
      }
      const { schoolName, maskedId } = await response.json();
      if (request.signal.aborted) return;
      token.current = '';
      setCheck(
        typeof schoolName === 'string' && typeof maskedId === 'string'
          ? { schoolName, maskedId }
          : 'unavailable',
      );
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
      <section className={styles.panel} aria-labelledby="card-check-title">
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
