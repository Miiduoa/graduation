'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { parseAccountLoginMethods, type AccountLoginMethods } from '@/lib/nuni/accountLoginMethods';
import styles from '@/app/servicePages.module.css';
import linkStyles from './GoogleLinkEntry.module.css';

type LoginMethods = AccountLoginMethods & { context: string };
type InventoryState =
  | { revision: number; status: 'ready'; value: LoginMethods }
  | { revision: number; status: 'error' };

const methodNames: Record<AccountLoginMethods['currentMethod'], string> = {
  google: 'Google',
  apple: 'Apple',
};
const notices: Record<string, string> = {
  acknowledged: '已從 Google 返回，請查看下方核對後的登入方式。',
  cancelled: '已返回帳號設定。取消授權不會解除先前已連結的登入方式。',
  unknown: '上次操作的回應尚未確認。請先核對目前狀態，再決定是否重新開始。',
  reauth: '請先核對目前帳號；需要重新驗證時，請使用原本的登入方式。',
  conflict: '請先核對目前帳號；另一個 nuni 帳號不會在此自動合併。',
  unavailable: '請先核對目前登入方式，再確認是否可以繼續綁定。',
  invalid: '請先核對目前登入方式。過期的授權流程需要重新開始。',
};
function readInventory(raw: unknown, platformAccountId: string, context: string): LoginMethods {
  const value = parseAccountLoginMethods(raw);
  if (
    value.platformAccountId !== platformAccountId ||
    (raw as Record<string, unknown>).context !== context
  )
    throw new Error('Invalid response');
  return { ...value, context };
}

function VerifiedGoogleLinkEntry({
  platformAccountId,
  context,
  result,
  isPlatformOperator,
}: {
  platformAccountId: string;
  context: string;
  result: string;
  isPlatformOperator: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [inventory, setInventory] = useState<InventoryState | null>(null);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const activeRead = useRef<AbortController | null>(null);

  useEffect(() => {
    const invalidate = () => {
      ++generation.current;
      activeRead.current?.abort();
      submitting.current = false;
      setBusy(false);
      setConfirmedRevision(null);
      setInventory(null);
    };
    const restore = () => {
      invalidate();
      setRevision((previous) => previous + 1);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') restore();
      else invalidate();
    };
    window.addEventListener('pagehide', invalidate);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      window.removeEventListener('pagehide', invalidate);
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    const run = ++generation.current;
    let active = true;
    const controller = new AbortController();
    activeRead.current = controller;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (active && generation.current === run) setInventory({ revision, status: 'error' });
    }, 30_000);
    const current = () => active && generation.current === run && !controller.signal.aborted;
    void (async () => {
      try {
        const response = await fetch('/api/nuni/account/login-methods', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'X-Campus-Session': context, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to read login methods');
        const value = readInventory(await response.json(), platformAccountId, context);
        if (current()) setInventory({ revision, status: 'ready', value });
      } catch {
        if (active && generation.current === run) setInventory({ revision, status: 'error' });
      } finally {
        window.clearTimeout(timeout);
        if (activeRead.current === controller) activeRead.current = null;
      }
    })();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [platformAccountId, context, revision]);

  const currentInventory = inventory?.revision === revision ? inventory : null;
  const verified = currentInventory?.status === 'ready' ? currentInventory.value : null;
  const checking = !currentInventory;
  const canLink = verified?.googleLink === 'available' && !isPlatformOperator;
  const canSubmit = canLink && confirmedRevision === revision && !busy;
  const notice = Object.hasOwn(notices, result) ? notices[result] : null;

  function recheck() {
    ++generation.current;
    activeRead.current?.abort();
    submitting.current = false;
    setBusy(false);
    setConfirmedRevision(null);
    setRevision((previous) => previous + 1);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (!canSubmit || submitting.current) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    setBusy(true);
  }

  return (
    <>
      {notice && <p>{notice}</p>}
      {checking ? (
        <p role="status">正在核對登入方式…</p>
      ) : currentInventory?.status === 'error' ? (
        <p role="alert">目前無法確認登入方式。請重新確認後再繼續，這次不會重送綁定。</p>
      ) : verified ? (
        <>
          <h2>目前的登入方式</h2>
          <p>目前使用 {methodNames[verified.currentMethod]} 登入。</p>
          <ul className={linkStyles.methods} aria-label="已連結的登入方式">
            {verified.methods.map((method) => (
              <li key={method}>
                <span>{methodNames[method]} 已連結</span>
                {method === verified.currentMethod && (
                  <span className={linkStyles.currentMethod}>目前使用</span>
                )}
              </li>
            ))}
          </ul>
          {verified.googleLink === 'linked' ? (
            <p role="status">已確認此 nuni 帳號連結了 Google，可以保留目前的登入方式繼續使用。</p>
          ) : isPlatformOperator || verified.googleLink === 'restricted' ? (
            <p role="status">此帳號目前不支援新增 Google 登入方式。</p>
          ) : verified.googleLink === 'reauth-required' ? (
            <p role="status">請使用目前的登入方式重新驗證，再回來連結 Google。</p>
          ) : verified.googleLink === 'unavailable' ? (
            <p role="status">目前無法新增 Google 登入方式。你仍可使用原本的登入方式。</p>
          ) : (
            <form
              className={`${styles.loginForm} ${linkStyles.linkForm}`}
              action="/auth/platform/link/google/start"
              method="post"
              onSubmit={submit}
              aria-busy={busy}
            >
              <h2>連結 Google 帳號</h2>
              <p>目前尚未連結 Google。開始新流程會取代此帳號尚未完成的 Google 綁定。</p>
              <p>
                請在 Google 選擇要用來登入此 nuni 帳號的身分。這不會授予學校資格，也不會合併另一個
                nuni 帳號。
              </p>
              <input type="hidden" name="context" value={context} />
              <input type="hidden" name="confirm" value="link-google" />
              <label className={linkStyles.consent}>
                <input
                  type="checkbox"
                  checked={confirmedRevision === revision}
                  disabled={busy}
                  onChange={(event) => setConfirmedRevision(event.target.checked ? revision : null)}
                  required
                />
                <span>我確認要將接下來選擇的 Google 帳號連結到目前的 nuni 帳號。</span>
              </label>
              <button type="submit" className="btn primary" disabled={!canSubmit}>
                {busy ? '正在前往 Google…' : '前往 Google 授權'}
              </button>
            </form>
          )}
        </>
      ) : null}
      <button
        type="button"
        className={`btn ${linkStyles.recheck}`}
        onClick={recheck}
        disabled={checking || busy}
      >
        重新確認登入方式
      </button>
    </>
  );
}

export function GoogleLinkEntry({ result }: { result: string }) {
  const { session, loading, pendingLogout, error, refresh } = useNuniSession();
  return (
    <section
      className={`${styles.stateCard} ${linkStyles.accountCard}`}
      aria-label="Google 登入方式"
    >
      {loading ? (
        <p role="status">正在確認目前帳號…</p>
      ) : pendingLogout || error || !session ? (
        <>
          <p>目前無法確認登入身分。請先回到原本的帳號，不會自動建立新帳號。</p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            重新確認帳號
          </button>
        </>
      ) : (
        <VerifiedGoogleLinkEntry
          key={JSON.stringify([
            session.platformAccountId,
            session.context,
            result,
            session.isPlatformOperator,
          ])}
          platformAccountId={session.platformAccountId}
          context={session.context}
          result={result}
          isPlatformOperator={session.isPlatformOperator}
        />
      )}
      <div className={`${styles.actions} ${linkStyles.actions}`}>
        <Link href="/classroom/account" className="btn">
          返回帳號設定
        </Link>
      </div>
    </section>
  );
}
