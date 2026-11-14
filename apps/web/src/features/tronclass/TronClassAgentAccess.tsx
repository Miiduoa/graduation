'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { TronClassAgentGrant, TronClassAgentPermissions, TronClassAgentScope } from '@campus/shared/src/tronClassAgentPermissions';
import { emptyTronClassAgentPermissions } from '@campus/shared/src/tronClassAgentPermissions';
import { isTronClassAuthorityError, type TronClassAgentClient } from '@/lib/tronClassAgentClient';
import { tronClassErrorMessage, TronClassRequestError } from '@/lib/tronClassIntegrationClient';
import { tronClassTime } from './TronClassSource';
import styles from './tronclass.module.css';

const OPTIONS: { scope: TronClassAgentScope; label: string; detail: string }[] = [
  { scope: 'readCourseData', label: '讀取課程、作業、公告與教材清單', detail: '讓助理依你的問題，查詢目前連接帳號的資料。' },
  { scope: 'downloadMaterials', label: '代為下載教材附件', detail: '在對話中指定檔案後，下載到你的裝置。' },
  { scope: 'prepareHomework', label: '代為整理作業要求與準備繳交預覽', detail: '可在對話中整理內容與附件；正式繳交尚未開放。' },
];

export function TronClassAgentAccess({ client, revision, expectedVersion, compact = false, onSaved, onConnectionChanged }: {
  client: TronClassAgentClient;
  revision?: string;
  expectedVersion?: string | null;
  compact?: boolean;
  onSaved?: (grant: TronClassAgentGrant) => void;
  onConnectionChanged?: () => void;
}) {
  const headingId = useId();
  const [grant, setGrant] = useState<TronClassAgentGrant | null>(null);
  const [draft, setDraft] = useState<TronClassAgentPermissions>(emptyTronClassAgentPermissions);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [unconnected, setUnconnected] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const connectionChanged = useRef(onConnectionChanged);
  useEffect(() => { connectionChanged.current = onConnectionChanged; }, [onConnectionChanged]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void client.grant(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (revision && value.revision !== revision) {
        setError('TronClass 連接已變更，請重新確認帳號。');
        setGrant(null);
        connectionChanged.current?.();
      } else {
        setGrant(value);
        setDraft(value.permissions);
        setUnconnected(false);
        if (expectedVersion !== undefined && value.version !== expectedVersion) connectionChanged.current?.();
      }
      setLoading(false);
    }, reason => {
      if (controller.signal.aborted) return;
      setError(tronClassErrorMessage(reason));
      setUnconnected(reason instanceof TronClassRequestError && [401, 409].includes(reason.status));
      if (isTronClassAuthorityError(reason)) connectionChanged.current?.();
      setLoading(false);
    });
    return () => controller.abort();
  }, [client, revision, expectedVersion, epoch]);

  function change(scope: TronClassAgentScope, checked: boolean) {
    setDraft(value => scope === 'readCourseData' && !checked
      ? emptyTronClassAgentPermissions() : { ...value, [scope]: checked });
    setNotice('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal = lifetime.current?.signal;
    if (lock.current || !grant || !signal || signal.aborted) return;
    lock.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const value = await client.setGrant({ revision: grant.revision, expectedVersion: grant.version, permissions: draft }, signal);
      if (signal.aborted) return;
      setGrant(value);
      setDraft(value.permissions);
      setNotice(value.permissions.readCourseData ? '已更新助理權限。現在可以在對話中請它處理 TronClass。' : '已關閉助理的 TronClass 存取權限。');
      onSaved?.(value);
    } catch (reason) {
      if (signal.aborted) return;
      setError(tronClassErrorMessage(reason));
      if (isTronClassAuthorityError(reason)) connectionChanged.current?.();
      // Reload the current revision/version after any failed save; never overwrite
      // another device's choice with a stale compare-and-set version.
      setGrant(null);
      setLoading(true);
      setEpoch(value => value + 1);
    } finally {
      lock.current = false;
      if (!signal.aborted) setSaving(false);
    }
  }

  const changed = !!grant && OPTIONS.some(option => draft[option.scope] !== grant.permissions[option.scope]);
  return (
    <section className={compact ? styles.notice : styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId}>TronClass 助理權限</h2>
      <p className={styles.muted}>選擇助理可以代你完成的事。權限只適用於目前連接的學校帳號，重新連接後需重新設定。</p>
      {loading && <p role="status">正在確認助理權限…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {unconnected && <Link className="btn" href="/tronclass">連接 TronClass</Link>}
      {!loading && !grant && !unconnected && <button className="btn" onClick={() => {
        setLoading(true); setError(''); setEpoch(value => value + 1);
      }}>重新確認權限</button>}
      {grant && <form className={styles.form} onSubmit={event => void save(event)}>
        <fieldset disabled={saving || loading}>
          <legend className={styles.permissionLegend}>允許助理執行</legend>
          {OPTIONS.map(option => <label key={option.scope} className={styles.permissionOption}>
            <input type="checkbox" checked={draft[option.scope]}
              disabled={option.scope !== 'readCourseData' && !draft.readCourseData}
              onChange={event => change(option.scope, event.target.checked)} />
            <span><strong>{option.label}</strong><span className={styles.muted}>{option.detail}</span></span>
          </label>)}
          <div className={styles.actions}>
            <button className="btn primary" type="submit" disabled={!changed}>{saving ? '儲存中…' : '儲存助理權限'}</button>
            {changed && <button className={styles.textButton} type="button" onClick={() => setDraft(grant.permissions)}>取消變更</button>}
            {!compact && grant.permissions.readCourseData && <Link className="btn" href="/ai-assistant?q=TronClass%E6%9C%89%E5%93%AA%E4%BA%9B%E6%9C%AA%E4%BA%A4%E4%BD%9C%E6%A5%AD">請助理查詢作業</Link>}
          </div>
        </fieldset>
        <p className={styles.muted}>這些查詢與檔案只用於你發起的操作，不會加入雲端模型的對話紀錄。</p>
        {grant.updatedAt && <p className={styles.muted}>權限更新：{tronClassTime(grant.updatedAt)}</p>}
      </form>}
      {notice && <p role="status" className={styles.muted}>{notice}</p>}
    </section>
  );
}
