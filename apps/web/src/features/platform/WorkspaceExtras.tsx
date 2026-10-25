'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { asRecords, platformFetch } from './platformFetch';
import { accountReturnHref, workspacePath } from './constants';
import styles from './Platform.module.css';

export function WorkspaceMembers({
  members,
}: {
  members: Array<{ platformAccountId?: string; displayName?: string; role?: string; memberRole?: string }>;
}) {
  return (
    <section className={styles.panel} aria-labelledby="workspace-members-heading">
      <h2 id="workspace-members-heading">成員</h2>
      {members.length === 0 ? (
        <p className={styles.muted}>目前還看不到名單，稍後再試。</p>
      ) : (
        <ul className={styles.stack}>
          {members.map((member, index) => (
            <li key={String(member.platformAccountId || index)}>
              <strong>{member.displayName || '成員'}</strong>
              <p className={styles.muted}>
                {member.memberRole === 'owner-teacher' || member.role === 'owner-teacher'
                  ? '負責老師'
                  : member.memberRole === 'co-teacher' || member.role === 'co-teacher'
                    ? '共同授課'
                    : member.memberRole === 'student' || member.role === 'student'
                      ? '學生'
                      : member.role || member.memberRole || '成員'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function WorkspaceInvite({
  workspaceId,
  canInvite,
  initialCode,
}: {
  workspaceId: string;
  canInvite: boolean;
  initialCode: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setCode(initialCode);
  }, [initialCode]);
  if (!canInvite && !code) return null;
  return (
    <section className={styles.panel} aria-labelledby="workspace-invite-heading">
      <h2 id="workspace-invite-heading">邀請學生</h2>
      <p className={styles.muted}>把邀請碼交給學生。撤銷與到期之後再補。一組可供 100 人使用。</p>
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      {canInvite ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void platformFetch(
              `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/invites`,
              { maxUses: 100, idempotencyKey: `web-invite-${crypto.randomUUID()}` },
            )
              .then((result) => {
                if (result.status === 401) {
                  window.location.replace(accountReturnHref(workspacePath(workspaceId)));
                  return;
                }
                if (!result.ok) throw new Error('邀請碼沒有產生成功，請稍後再試。');
                setCode(typeof result.body.code === 'string' ? result.body.code : '');
              })
              .catch((failure: Error) => setError(failure.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '產生中…' : code ? '再產生一組邀請碼' : '產生邀請碼'}
        </Button>
      ) : null}
      {code ? (
        <p className={styles.code} role="status">
          {code}
        </p>
      ) : null}
    </section>
  );
}

export function WorkspaceAffiliation({
  workspaceId,
  canApply,
  affiliation,
  applications,
  onChanged,
}: {
  workspaceId: string;
  canApply: boolean;
  affiliation: Record<string, unknown> | null;
  applications: Record<string, unknown>[];
  onChanged: () => void;
}) {
  const [tenantId, setTenantId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className={styles.panel} aria-labelledby="workspace-affiliation-heading">
      <h2 id="workspace-affiliation-heading">掛靠班次</h2>
      <p className={styles.muted}>把課班掛到學校班次後，學生才看得到校方課表對應。核准由平台營運處理。</p>
      {affiliation ? (
        <p className={styles.notice}>
          目前掛靠：{String(affiliation.tenantName || affiliation.tenantId || '已送出')}
          {affiliation.sectionId ? ` · ${String(affiliation.sectionId)}` : ''}
          {affiliation.state ? ` · ${String(affiliation.state)}` : ''}
        </p>
      ) : (
        <p className={styles.muted}>目前沒有已核准的掛靠。</p>
      )}
      {applications.length ? (
        <ul className={styles.stack}>
          {applications.map((row, index) => (
            <li key={String(row.id || index)}>
              {String(row.tenantId || '')}
              {row.sectionId ? ` · ${String(row.sectionId)}` : ''}
              {row.state ? ` · ${String(row.state)}` : ' · 審核中'}
            </li>
          ))}
        </ul>
      ) : null}
      {canApply ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void platformFetch(
              `/auth/platform/class-workspaces/${encodeURIComponent(workspaceId)}/affiliation-applications`,
              {
                tenantId: tenantId.trim(),
                sectionId: sectionId.trim() || null,
                justification: justification.trim(),
                idempotencyKey: `web-affiliate-${crypto.randomUUID()}`,
              },
            )
              .then((result) => {
                if (result.status === 401) {
                  window.location.replace(accountReturnHref(workspacePath(workspaceId)));
                  return;
                }
                if (!result.ok) throw new Error('掛靠申請沒有送出，請稍後再試。');
                setTenantId('');
                setSectionId('');
                setJustification('');
                onChanged();
              })
              .catch((failure: Error) => setError(failure.message))
              .finally(() => setBusy(false));
          }}
        >
          <Input
            label="學校代號"
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            required
            disabled={busy}
            placeholder="例如 pu"
          />
          <Input
            label="班次代號（選填）"
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            disabled={busy}
            placeholder="例如 section-ai"
          />
          <Textarea
            label="說明"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            required
            disabled={busy}
          />
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || !tenantId.trim() || !justification.trim()}>
            {busy ? '送出中…' : '送出掛靠申請'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export function parseMembers(value: unknown) {
  return asRecords(value);
}
