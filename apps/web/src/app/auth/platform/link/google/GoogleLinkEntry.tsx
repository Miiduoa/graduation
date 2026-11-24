'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import styles from '@/app/servicePages.module.css';

const notices: Record<string, string> = {
  acknowledged: '已返回綁定流程。請先確認帳號狀態；此訊息本身不代表 Google 已連結。',
  cancelled: '已返回取消流程。若先前曾完成綁定，取消不會解除已連結的帳號。',
  unknown: '目前無法確認綁定結果。請先確認帳號狀態，不要直接重複送出。',
  reauth: '需要重新確認目前的帳號。請使用原本的登入方式重新驗證後再試。',
  conflict: '這個登入方式無法連結。請保留原本帳號，必要時使用帳號復原。',
  unavailable: '目前無法使用這個登入方式。',
  invalid: '這次綁定流程無效或已過期。請返回帳號設定。',
};

export function GoogleLinkEntry({ result }: { result: string }) {
  const { session, loading, pendingLogout, error, refresh } = useNuniSession();
  const context = session?.context;
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const restore = () => { submitting.current = false; setBusy(false); setConfirmed(null); };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  const notice = Object.hasOwn(notices, result) ? notices[result] : null;
  const ready = !!session && !loading && !pendingLogout && !error && !session.isPlatformOperator;
  const retryBlocked = !!notice && result !== 'cancelled';
  const canSubmit = ready && !!context && confirmed === context && !busy && !retryBlocked;
  function submit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit || submitting.current) { event.preventDefault(); return; }
    submitting.current = true;
    setBusy(true);
  }
  return (
    <section className={styles.stateCard} aria-label="Google 登入方式">
      {notice && <p role="status">{notice}</p>}
      {loading ? <p role="status">正在確認目前帳號…</p> : pendingLogout || error || !session ? (
        <>
          <p>目前無法確認登入身分。請先回到原本的帳號，不會自動建立新帳號。</p>
          <button type="button" className="btn" onClick={() => void refresh()}>重新確認</button>
        </>
      ) : session.isPlatformOperator ? <p>此帳號目前不支援新增登入方式。</p> : !retryBlocked ? (
        <form className={styles.loginForm} action="/auth/platform/link/google/start" method="post" onSubmit={submit} aria-busy={busy}>
          <h2>連結 Google 帳號</h2>
          <p>請在 Google 選擇要用來登入此 nuni 帳號的身分。這不會授予學校資格，也不會合併另一個 nuni 帳號。</p>
          <input type="hidden" name="context" value={context ?? ''} />
          <input type="hidden" name="confirm" value="link-google" />
          <label>
            <input type="checkbox" checked={confirmed === context && !!context} disabled={!ready || busy}
              onChange={event => setConfirmed(event.target.checked && context ? context : null)} required />
            我確認要將接下來選擇的 Google 帳號連結到目前的 nuni 帳號。
          </label>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {busy ? '正在前往 Google…' : '前往 Google 授權'}
          </button>
        </form>
      ) : null}
      <div className={styles.actions}>
        <Link href="/classroom/account" className="btn">返回帳號設定</Link>
      </div>
    </section>
  );
}
