'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PersonalImportSyncChoices } from '@campus/shared/src/imports/sync';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { PERSONAL_IMPORT_CHANGE, readPersonalImportSyncState, type PersonalImportScope } from '@/lib/personalImports';
import { getPersonalImportSyncStatus, setPersonalImportSyncEnabled, subscribePersonalImportSync, syncPersonalImports } from '@/lib/personalImportSync';

export function PersonalImportSyncBridge() {
  const { scope, loading } = usePersonalImportScope();
  const nuni = useOptionalNuniSession();
  const identity = nuni?.session;
  useEffect(() => {
    if (loading || !identity || nuni?.error || nuni?.pendingLogout || scope.owner !== `platform:${identity.platformAccountId}` || scope.schoolId === 'personal') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!alive || document.visibilityState === 'hidden') return;
      try { if (readPersonalImportSyncState(scope).enabled && getPersonalImportSyncStatus(scope)?.phase !== 'conflict') void syncPersonalImports(scope, identity, () => alive); }
      catch { /* The import screen presents storage corruption without replacing the ledger. */ }
    };
    const changed = () => { clearTimeout(timer); timer = setTimeout(run, 1000); };
    run();
    const interval = setInterval(run, 30_000);
    window.addEventListener('online', run); window.addEventListener('focus', run);
    window.addEventListener('storage', changed); window.addEventListener(PERSONAL_IMPORT_CHANGE, changed);
    document.addEventListener('visibilitychange', run);
    return () => {
      alive = false; clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('online', run); window.removeEventListener('focus', run);
      window.removeEventListener('storage', changed); window.removeEventListener(PERSONAL_IMPORT_CHANGE, changed);
      document.removeEventListener('visibilitychange', run);
    };
  }, [loading, identity, nuni?.error, nuni?.pendingLogout, scope.owner, scope.schoolId]);
  return null;
}

export function PersonalImportSyncPanel({ scope, available = true }: { scope: PersonalImportScope; available?: boolean }) {
  const nuni = useOptionalNuniSession();
  const identity = nuni?.session;
  const activeRef = useRef(false);
  const permitted = available && !nuni?.loading && !nuni?.error && !nuni?.pendingLogout && !!identity && scope.owner === `platform:${identity.platformAccountId}`;
  const generation = useRef(0);
  useLayoutEffect(() => { activeRef.current = permitted; generation.current++; return () => { generation.current++; activeRef.current = false; }; }, [permitted, scope.owner, scope.schoolId, identity?.context]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [choices, setChoices] = useState<PersonalImportSyncChoices>({});
  const status = useSyncExternalStore(subscribePersonalImportSync, () => getPersonalImportSyncStatus(scope), () => null);
  useEffect(() => {
    const refresh = () => { try { setEnabled(readPersonalImportSyncState(scope).enabled); } catch (e) { setError(e instanceof Error ? e.message : '無法讀取同步設定。'); } };
    refresh(); window.addEventListener(PERSONAL_IMPORT_CHANGE, refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(PERSONAL_IMPORT_CHANGE, refresh); window.removeEventListener('storage', refresh); };
  }, [scope.owner, scope.schoolId]);
  useEffect(() => { setChoices({}); }, [status?.result?.review]);
  if (!identity || scope.owner !== `platform:${identity.platformAccountId}` || scope.schoolId === 'personal') return (
    <section className="card" aria-label="跨裝置同步"><h2>跨裝置同步</h2><p>登入平台帳號並選擇校園後，可把個人紀錄同步到其他裝置。訪客資料不會自動搬到帳號，可先下載完整備份再登入還原。</p></section>
  );
  const active = () => { const run = generation.current; return () => activeRef.current && run === generation.current; };
  const busy = status?.phase === 'syncing';
  const conflicts = status?.result?.conflicts || [];
  return <section className="card" aria-label="跨裝置同步">
    <h2>跨裝置同步</h2>
    <p>{enabled ? '已開啟這個帳號與校園的同步。離線時先存到裝置，重新連線後再同步；兩邊同時改同一筆時會請你核對。' : '開啟後，此校園的課表、成績、活動、教師／課班欄位與來源文字會存到你的帳號。原始圖片不會上傳。其他裝置需登入同一帳號並開啟同步。'}</p>
    {!enabled && <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />我已確認，要將這個校園的個人紀錄同步到帳號</label>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 12 }}>
      <button type="button" disabled={!available || busy || (!enabled && !consent)} onClick={async () => {
        const check = active(); setError('');
        try { await setPersonalImportSyncEnabled(scope, !enabled, check); if (!enabled && check()) await syncPersonalImports(scope, identity, check); }
        catch (e) { if (check()) setError(e instanceof Error ? e.message : '同步設定未完成。'); }
      }}>{enabled ? '暫停這台裝置同步' : '開啟帳號同步'}</button>
      {enabled && <button type="button" disabled={!available || busy} onClick={() => void syncPersonalImports(scope, identity, active())}>{busy ? '正在同步…' : '立即同步'}</button>}
    </div>
    {enabled && <p><small>暫停不會刪除帳號資料。開啟同步時，刪除紀錄也會同步到其他裝置；修改前可先下載完整備份。</small></p>}
    {status && enabled && <p role={status.phase === 'error' ? 'alert' : 'status'}>{status.message}</p>}
    {error && <p role="alert">{error}</p>}
    {conflicts.map((conflict) => <fieldset key={conflict.key}><legend>{conflict.title}</legend>
      <p>這台裝置：{conflict.local.length ? conflict.local.map((r) => `${r.title} · ${r.grade || r.date || r.location || r.teacher || '已修改'}`).join('、') : '已刪除'}</p>
      <p>帳號上的版本：{conflict.remote.length ? conflict.remote.map((r) => `${r.title} · ${r.grade || r.date || r.location || r.teacher || '已修改'}`).join('、') : '已刪除'}</p>
      <label>保留哪一份<select value={choices[conflict.key] || ''} onChange={(e) => setChoices({ ...choices, [conflict.key]: e.target.value as 'local' | 'remote' })}>
        <option value="" disabled>請選擇</option><option value="local">這台裝置的內容</option><option value="remote">帳號上的版本</option>
      </select></label>
    </fieldset>)}
    {!!conflicts.length && status?.result?.review && <button type="button" disabled={busy || !available || conflicts.some((c) => !choices[c.key])} onClick={() => {
      void syncPersonalImports(scope, identity, active(), { ...status.result!.review!, choices });
    }}>確認選擇並同步</button>}
  </section>;
}
