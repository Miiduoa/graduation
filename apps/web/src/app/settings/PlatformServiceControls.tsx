'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import styles from './settings.module.css';

type Access = { social: boolean; cloudAi: boolean };
type ReadState = { scope: string; status: 'loading' | 'ready' | 'error'; values: Access };
const none: Access = { social: false, cloudAi: false };

function parseAccess(value: unknown): Access {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  const record = value as Record<string, unknown>;
  if (
    record.scope !== 'web-session' ||
    typeof record.social !== 'boolean' ||
    typeof record.cloudAi !== 'boolean'
  )
    throw new Error('INVALID_RESPONSE');
  return { social: record.social, cloudAi: record.cloudAi };
}

function AccessRow({ name, description, enabled, onToggle, disabled }: {
  name: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <h3>{name}</h3>
        <p>{description}</p>
      </div>
      <div className={styles.control}>
        <button
          type="button"
          role="switch"
          aria-label={name}
          aria-checked={enabled}
          disabled={disabled}
          className={styles.toggle}
          onClick={onToggle}
        ><span /></button>
      </div>
    </div>
  );
}

export function PlatformServiceControls() {
  const account = useNuniSession();
  const session = account.loading || account.pendingLogout || account.error ? null : account.session;
  const context = session?.context ?? '';
  const owner = session?.platformAccountId ?? '';
  const scope = owner && context ? owner + ':' + context : '';
  const activeScope = useRef(scope);
  useLayoutEffect(() => { activeScope.current = scope; }, [scope]);
  const lock = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReadState>({ scope: '', status: 'loading', values: none });
  const [draft, setDraft] = useState<Access>(none);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!scope) return;
    let active = true;
    setState({ scope, status: 'loading', values: none });
    setMessage('');
    void browserRequest('service-access', context)
      .then((value) => {
        if (!active || activeScope.current !== scope) return;
        const parsed = parseAccess(value);
        setDraft(parsed);
        setState({ scope, status: 'ready', values: parsed });
      })
      .catch(() => {
        if (active && activeScope.current === scope)
          setState({ scope, status: 'error', values: none });
      });
    return () => { active = false; };
  }, [scope, context, attempt]);

  async function save() {
    if (lock.current || !scope || state.scope !== scope || state.status !== 'ready') return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const expected = { ...draft };
    try {
      parseAccess(await browserRequest('service-access', context, expected));
      if (activeScope.current !== scope) return;
      const confirmed = parseAccess(await browserRequest('service-access', context));
      if (activeScope.current !== scope) return;
      if (confirmed.social !== expected.social || confirmed.cloudAi !== expected.cloudAi)
        throw new Error('UNCONFIRMED');
      setDraft(confirmed);
      setState({ scope, status: 'ready', values: confirmed });
      setMessage('已套用到目前的網頁登入');
    } catch {
      if (activeScope.current === scope) {
        setState({ scope, status: 'error', values: none });
        setMessage('變更結果尚未確認。請重新讀取後檢查，不會自動重送。');
      }
    } finally {
      lock.current = false;
      if (activeScope.current === scope) setBusy(false);
    }
  }

  return (
    <section className={styles.stack} aria-label="Google 平台權限">
      <div className={styles.sectionHeading}>
        <h2>平台服務權限</h2>
        <p>決定這次 Google 登入能使用哪些網頁服務。限制由伺服器檢查，不只是隱藏畫面按鈕。</p>
      </div>
      <div className={styles.notice} role="note">
        <h3>套用範圍</h3>
        <p>只跟隨這次網頁登入，登出或換裝置不會同步；不會新增學校身分或管理員權限。手機 App、校內私訊與其他獨立服務不受這組設定控制。</p>
      </div>
      {account.loading ? (
        <p role="status">正在確認平台帳號…</p>
      ) : account.pendingLogout || account.error ? (
        <div className={styles.notice} role="alert">
          <p>目前無法確認登入狀態，權限設定已隱藏。</p>
          <button type="button" className="btn" onClick={() => void account.refresh()}>重新確認登入</button>
        </div>
      ) : !session ? (
        <div className={styles.notice}>
          <h3>登入後管理平台服務</h3>
          <p>Google 帳號可使用公開社群與平台 AI，不需要因此連結校方帳號。</p>
          <Link href="/login?returnUrl=%2Fsettings%3Fsection%3Dplatform" className="btn primary">使用 Google 登入</Link>
        </div>
      ) : state.scope !== scope || state.status === 'loading' ? (
        <p role="status">正在讀取本次登入的權限…</p>
      ) : state.status === 'error' ? (
        <div className={styles.notice} role="alert">
          <p>{message || '目前無法取得已套用的權限，暫停修改。'}</p>
          <button type="button" className="btn" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>重新讀取</button>
        </div>
      ) : (
        <>
          <div className={styles.group}>
            <AccessRow
              name="公開社群"
              description="控制網頁登入能否讀取、發布或操作平台社群。關閉不會刪除先前的貼文，也不會讓別人看不到既有公開內容。"
              enabled={draft.social}
              disabled={busy}
              onToggle={() => { setDraft((old) => ({ ...old, social: !old.social })); setMessage(''); }}
            />
            <AccessRow
              name="雲端 AI 助理"
              description="關閉後無法透過網頁送出新的雲端模型任務。已送出的任務仍可查證或撤銷；裝置端功能不受影響。"
              enabled={draft.cloudAi}
              disabled={busy}
              onToggle={() => { setDraft((old) => ({ ...old, cloudAi: !old.cloudAi })); setMessage(''); }}
            />
            <div className={styles.row}>
              <div className={styles.rowText}>
                <h3>私人訊息</h3>
                <p>目前校內私訊依學校帳號與校籍資格授權。Google 平台私訊尚未接通，兩種身分的訊息不會混用。</p>
              </div>
              <div className={styles.control}>
                <Link className="btn" href="/dms">查看校內私訊</Link>
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <p>AI 的模型資料分享與每項寫入動作仍需另外確認，開關不會一次開放所有權限。</p>
            <button
              type="button"
              className="btn primary"
              disabled={busy || (draft.social === state.values.social && draft.cloudAi === state.values.cloudAi)}
              onClick={() => void save()}
            >{busy ? '正在確認…' : '儲存本次登入權限'}</button>
            {message && <p role="status">{message}</p>}
          </div>
        </>
      )}
    </section>
  );
}
