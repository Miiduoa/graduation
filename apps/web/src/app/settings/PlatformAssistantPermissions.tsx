'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NuniError } from '@campus/shared/src/nuni';
import {
  PLATFORM_ASSISTANT_PERMISSION_DEFINITIONS,
  createDefaultPlatformAssistantPermissions,
  parsePlatformAssistantPermissionState,
  type PlatformAssistantPermissionState,
  type PlatformAssistantPermissions,
} from '@campus/shared/src/platformAssistantPermissions';
import { browserRequest, useNuniSession } from '@/features/nuni/Session';
import styles from './settings.module.css';

const CHANGE_KEY = 'nuni.platform.assistant-permissions-changed';

function samePermissions(a: PlatformAssistantPermissions, b: PlatformAssistantPermissions) {
  return (
    a.createPersonalEvent === b.createPersonalEvent && a.prepareFoodOrder === b.prepareFoodOrder
  );
}

export function PlatformAssistantPermissions() {
  const auth = useNuniSession();
  const ready = !auth.loading && !auth.pendingLogout && !auth.error;
  const scope =
    ready && auth.session ? `${auth.session.platformAccountId}:${auth.session.context}` : '';
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  const isCurrent = useCallback(() => currentScope.current === scope, [scope]);
  if (auth.loading) return <p role="status">正在確認 Google 帳號…</p>;
  if (auth.pendingLogout || auth.error) {
    return (
      <div className={styles.notice} role="alert">
        <p>
          {auth.pendingLogout
            ? 'Google 帳號登出尚未完成，暫時無法變更權限。'
            : '目前無法確認 Google 帳號，請重新連線後再試。'}
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => void (auth.pendingLogout ? auth.logout() : auth.refresh())}
        >
          {auth.pendingLogout ? '重試登出 Google 帳號' : '重新確認 Google 帳號'}
        </button>
      </div>
    );
  }
  if (!auth.session) {
    return (
      <div className={styles.notice}>
        <h3>登入後設定 AI 代辦權限</h3>
        <p>使用 Google 帳號登入後，即可選擇允許助理代辦的項目。</p>
        <Link className="btn primary" href="/login">
          前往登入
        </Link>
      </div>
    );
  }
  return (
    <PlatformAssistantPermissionsEditor
      key={scope}
      accountId={auth.session.platformAccountId}
      context={auth.session.context}
      isCurrent={isCurrent}
    />
  );
}

function PlatformAssistantPermissionsEditor({
  accountId,
  context,
  isCurrent,
}: {
  accountId: string;
  context: string;
  isCurrent: () => boolean;
}) {
  const [snapshot, setSnapshot] = useState<PlatformAssistantPermissionState | null>(null);
  const [draft, setDraft] = useState(createDefaultPlatformAssistantPermissions);
  const [busy, setBusy] = useState<'load' | 'save' | null>('load');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const mounted = useRef(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const current = useCallback(() => mounted.current && isCurrent(), [isCurrent]);
  const invalidateRequests = useCallback(() => {
    ++generation.current;
    lock.current = false;
  }, []);
  const checked = useCallback(
    (raw: unknown) => {
      const state = parsePlatformAssistantPermissionState(raw);
      if (state.accountId !== accountId) throw new Error('Permission account changed');
      return state;
    },
    [accountId],
  );

  const load = useCallback(async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    const run = ++generation.current;
    try {
      const next = checked(await browserRequest('assistant-permissions', context));
      if (!current() || run !== generation.current) return;
      setSnapshot(next);
      setDraft(next.permissions);
      setNeedsReload(false);
    } catch {
      if (current() && run === generation.current) {
        setSnapshot(null);
        setDraft(createDefaultPlatformAssistantPermissions());
        setNeedsReload(true);
        setMessage('暫時無法讀取 AI 代辦權限。請重新讀取後再調整。');
      }
    } finally {
      if (run === generation.current) {
        lock.current = false;
        if (current()) setBusy(null);
      }
    }
  }, [checked, context, current]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(load);
    const changed = (event: StorageEvent) => {
      if (event.key !== CHANGE_KEY || !current()) return;
      invalidateRequests();
      setBusy(null);
      setNeedsReload(true);
      setSaved(false);
      setMessage('權限已在另一個分頁更新。請重新讀取最新設定後再調整。');
    };
    window.addEventListener('storage', changed);
    return () => {
      mounted.current = false;
      invalidateRequests();
      window.removeEventListener('storage', changed);
    };
  }, [load, current, invalidateRequests]);

  const reload = () => {
    if (lock.current || !current()) return;
    setBusy('load');
    setMessage('');
    setSaved(false);
    void load();
  };

  const dirty = snapshot !== null && !samePermissions(draft, snapshot.permissions);
  const save = async () => {
    if (!snapshot || !dirty || needsReload || lock.current || !current()) return;
    lock.current = true;
    const run = ++generation.current;
    const expected = { ...draft };
    setBusy('save');
    setMessage('');
    setSaved(false);
    try {
      const next = checked(
        await browserRequest('assistant-permissions', context, {
          expectedRevision: snapshot.revision,
          permissions: expected,
        }),
      );
      if (!current() || run !== generation.current) return;
      if (next.revision !== snapshot.revision + 1 || !samePermissions(next.permissions, expected))
        throw new Error('Permission save was not confirmed');
      setSnapshot(next);
      setDraft(next.permissions);
      setSaved(true);
      try {
        localStorage.setItem(CHANGE_KEY, crypto.randomUUID());
      } catch {
        /* The server receipt is authoritative. */
      }
    } catch (error) {
      if (!current() || run !== generation.current) return;
      setNeedsReload(true);
      setMessage(
        error instanceof NuniError && error.status === 409
          ? '帳號或權限已變更，這次設定尚未確認。請重新讀取後再調整。'
          : '尚未確認權限已儲存。請重新讀取最新設定後再試。',
      );
    } finally {
      if (run === generation.current) {
        lock.current = false;
        if (current()) setBusy(null);
      }
    }
  };

  const disabled = busy !== null || !snapshot || needsReload;
  return (
    <section className={styles.stack} aria-label="Google 帳號 AI 代辦權限">
      <div className={styles.sectionHeading}>
        <h3 className={styles.groupHeading}>Google 帳號的代辦動作</h3>
        <p>選擇允許助理代辦的項目。預設開啟，每次執行仍需確認。</p>
      </div>
      <div className={styles.group}>
        {PLATFORM_ASSISTANT_PERMISSION_DEFINITIONS.map((row) => (
          <div className={styles.row} key={row.key}>
            <div className={styles.rowText}>
              <h3>{row.label}</h3>
              <p id={`platform-permission-${row.key}`}>{row.description}</p>
            </div>
            <button
              type="button"
              className={styles.toggle}
              role="switch"
              aria-label={row.label}
              aria-describedby={`platform-permission-${row.key}`}
              aria-checked={draft[row.key]}
              disabled={disabled}
              onClick={() => {
                setDraft((previous) => ({ ...previous, [row.key]: !previous[row.key] }));
                setSaved(false);
              }}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
      {busy === 'load' && <p role="status">正在讀取 AI 代辦權限…</p>}
      {message && (
        <div className={styles.notice} role="alert">
          <p>{message}</p>
          <button type="button" className="btn" disabled={busy !== null} onClick={reload}>
            重新讀取權限
          </button>
        </div>
      )}
      {saved && <p role="status">AI 代辦權限已儲存。</p>}
      <div className={styles.actions}>
        <p>{dirty ? '有尚未儲存的變更。' : '設定會儲存至目前登入的 Google 帳號。'}</p>
        <button
          type="button"
          className="btn primary"
          disabled={disabled || !dirty}
          onClick={() => void save()}
        >
          {busy === 'save' ? '儲存中…' : '儲存 AI 代辦權限'}
        </button>
      </div>
      <p className={styles.description}>
        關閉只影響助理代辦，不會關閉 AI 對話或一般服務。學校帳號的校內權限另行設定。
      </p>
    </section>
  );
}
