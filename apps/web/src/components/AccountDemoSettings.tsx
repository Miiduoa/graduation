'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_DEMO_FEATURE_LABELS, ACCOUNT_DEMO_FEATURES, createAccountDemoPermissions,
} from '@campus/shared/src/accountDemo';
import { AccountDemoScope, type AccountDemoController } from './AccountDemoState';
import { ConfirmModal } from './ui/Modal';
import { getPersonalImportSyncStatus, setPersonalImportSyncEnabled, syncPersonalImports } from '@/lib/personalImportSync';
import { readPersonalImports } from '@/lib/personalImports';
import styles from './AccountDemo.module.css';

export function AccountDemoImportControl({ controller }: { controller: AccountDemoController }) {
  const { demo, context, blocked } = controller;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);
  const lock = useRef(false);
  const latest = useRef(controller);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { latest.current = controller; }, [controller]);
  async function synchronize() {
    if (blocked || busy || lock.current || !demo.permissions.timetable || Date.parse(demo.expiresAt) <= Date.now()) return;
    lock.current = true;
    setBusy(true); setError(''); setNotice('');
    const scope = { owner: `platform:${demo.accountId}`, schoolId: demo.profile.schoolId };
    const isCurrent = () => active.current && latest.current.context === context &&
      latest.current.demo.accountId === demo.accountId && latest.current.demo.profile.schoolId === demo.profile.schoolId &&
      latest.current.demo.permissions.timetable && !latest.current.blocked &&
      Date.parse(latest.current.demo.expiresAt) > Date.now();
    try {
      await setPersonalImportSyncEnabled(scope, true, isCurrent);
      if (!isCurrent()) return;
      await syncPersonalImports(scope, { platformAccountId: demo.accountId, context }, isCurrent);
      if (!isCurrent()) return;
      const result = getPersonalImportSyncStatus(scope);
      if (result?.phase !== 'synced') { setError(result?.message || '同步尚未完成，請稍後再試。'); return; }
      setNotice(`已同步 ${readPersonalImports(scope).length} 筆課表、行程與成績資料。`);
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : '暫時無法同步，請稍後再試。');
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return <div className={styles.links}>
    <button type="button" disabled={blocked || busy || !demo.permissions.timetable} onClick={() => void synchronize()}>
      {busy ? '同步中…' : '同步我的課表與行程'}
    </button>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

function Controls({ controller }: { controller: AccountDemoController }) {
  const { demo, blocked, busy, mutate } = controller;
  const [reset, setReset] = useState(false);
  const search = `?campus=${encodeURIComponent(demo.profile.schoolId)}`;
  return <section id="account-demo-permissions" className={`${styles.workspace} ${styles.panel}`} aria-labelledby="demo-permissions-title">
    <div className={styles.sectionHeader}>
      <div><h2 id="demo-permissions-title">展示資料權限</h2><p>這些資料會出現在原本的功能頁面，操作進度跟隨目前帳號儲存。</p></div>
      <button type="button" disabled={blocked || ACCOUNT_DEMO_FEATURES.every(feature => demo.permissions[feature])}
        onClick={() => void mutate({ permissions: createAccountDemoPermissions(true) })}>全部開啟</button>
    </div>
    <p>每個開關控制本人的合成展示資料；學校與正式店家的授權仍依已驗證的身分。</p>
    <div className={styles.permissions}>
      {ACCOUNT_DEMO_FEATURES.map(feature => <label className={styles.permission} key={feature}>
        <span>{ACCOUNT_DEMO_FEATURE_LABELS[feature]}</span>
        <button type="button" role="switch" className={styles.switch}
          aria-label={`${ACCOUNT_DEMO_FEATURE_LABELS[feature]}展示權限`} aria-checked={demo.permissions[feature]} disabled={blocked}
          onClick={() => void mutate({ permissions: { ...demo.permissions, [feature]: !demo.permissions[feature] } })}><span /></button>
      </label>)}
    </div>
    <AccountDemoImportControl controller={controller} />
    <nav className={styles.links} aria-label="功能頁面">
      <Link href={`/student-card${search}`}>學生證</Link>
      <Link href={`/classroom${search}`}>課程與作業</Link>
      <Link href={`/timetable${search}`}>課表</Link>
      <Link href={`/food${search}`}>點餐</Link>
      <Link href={`/merchant/workspace${search}`}>店家工作台</Link>
      <Link href={`/ai-assistant${search}`}>助理</Link>
    </nav>
    <div className={styles.footer}>
      <p>重設只清除合成情境進度；課程、個人匯入資料與權限保留。</p>
      <button type="button" disabled={blocked} onClick={() => setReset(true)}>重設展示進度</button>
    </div>
    <ConfirmModal isOpen={reset} onClose={() => setReset(false)} title="重設展示進度"
      message="清除本帳號的合成情境進度，保留已設定的權限、課程及個人匯入資料。" loading={busy} confirmText="確認並儲存"
      onConfirm={async () => { if (await mutate({ action: 'reset' })) setReset(false); }} />
  </section>;
}

export function AccountDemoSettings() {
  return <AccountDemoScope campusScoped={false}>{controller => <Controls controller={controller} />}</AccountDemoScope>;
}
