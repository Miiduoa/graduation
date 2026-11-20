'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from '../../servicePages.module.css';
import {
  COOKIE_ABSENT_COPY,
  INVALID_TOKEN_COPY,
  NOT_FOUND_COPY,
  PUBLIC_PAGE_INTRO,
  QUERY_UNAVAILABLE_COPY,
  REVOKE_CONFIRM_BODY,
  REVOKED_COPY,
  formatCounts,
  formatUpdatedAt,
  parseCapabilityToken,
  queryCookieStatus,
  queryPublicStatus,
  revokeCookieStatus,
  revokePublicStatus,
  stageLabel,
  type DeletionProjection,
} from './deletionStatus';

type Busy = 'query' | 'query-cookie' | 'revoke' | null;
type Result = { projection: DeletionProjection; source: 'manual' | 'cookie' };

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : QUERY_UNAVAILABLE_COPY;
}

export function DeletionStatus() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function queryManual() {
    const capabilityToken = parseCapabilityToken(token);
    if (!capabilityToken) {
      setError(INVALID_TOKEN_COPY);
      return;
    }
    setBusy('query');
    setError(null);
    try {
      const projection = await queryPublicStatus(capabilityToken);
      setResult({ projection, source: 'manual' });
    } catch (failure) {
      setResult(null);
      setError(failureMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function queryCookie() {
    setBusy('query-cookie');
    setError(null);
    try {
      const lookup = await queryCookieStatus();
      if (lookup.kind === 'ok') setResult({ projection: lookup.projection, source: 'cookie' });
      else if (lookup.kind === 'absent') setError(COOKIE_ABSENT_COPY);
      else setError(lookup.message);
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!result || !window.confirm(REVOKE_CONFIRM_BODY)) return;
    setBusy('revoke');
    setError(null);
    try {
      if (result.source === 'cookie') {
        const revoked = await revokeCookieStatus();
        setError(revoked ? REVOKED_COPY : NOT_FOUND_COPY);
        if (revoked) setResult(null);
      } else {
        const capabilityToken = parseCapabilityToken(token);
        if (!capabilityToken) return;
        await revokePublicStatus(capabilityToken);
        setError(REVOKED_COPY);
        setResult(null);
      }
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SiteShell title="刪除進度" subtitle={PUBLIC_PAGE_INTRO}>
      {error ? (
        <p role="alert" className={styles.errorNotice}>
          {error}
        </p>
      ) : null}
      <article className={styles.document}>
        <section>
          <Input
            label="查詢碼"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="pd1_ 開頭的查詢碼"
            autoComplete="off"
            spellCheck={false}
          />
          <div className={styles.actions}>
            <Button type="button" variant="primary" disabled={!!busy || !token.trim()} onClick={() => void queryManual()}>
              查詢進度
            </Button>
            <Button type="button" disabled={!!busy} onClick={() => void queryCookie()}>
              用這個瀏覽器保存的查詢碼
            </Button>
          </div>
        </section>
        {result ? (
          <section data-testid="deletion-status-result">
            <h2>{stageLabel(result.projection.stage)}</h2>
            <p>各類資料：{formatCounts(result.projection.counts)}。</p>
            <p>最後更新：{formatUpdatedAt(result.projection.updatedAt)}</p>
            {result.projection.terminalReceipt ? (
              <p>
                完成收據代碼：<code>{result.projection.terminalReceipt.sha256}</code>
                {result.projection.terminalReceipt.code === 'completed-with-retention'
                  ? '（部分資料依法保留，保留的類別數見上）'
                  : null}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button type="button" variant="danger" disabled={!!busy} onClick={() => void revoke()}>
                撤銷查詢碼
              </Button>
            </div>
            <p>
              <small>{REVOKE_CONFIRM_BODY}</small>
            </p>
          </section>
        ) : null}
        <p>
          <Link href="/privacy">隱私資訊</Link>
          {' · '}
          <Link href="/account-deletion">帳號刪除說明</Link>
        </p>
      </article>
    </SiteShell>
  );
}
