'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { platformFetch } from './platformFetch';
import { accountReturnHref, workspacePath } from './constants';
import styles from './Platform.module.css';
import { useActiveRequest } from './useActiveRequest';
import { CLASSROOM_ACCESS_ERROR, classroomAccessDenied } from './classroomAccess';

export function WorkspaceMembers({
  members,
}: {
  members: Array<{
    platformAccountId?: string;
    displayName?: string;
    role?: string;
    memberRole?: string;
  }>;
}) {
  return (
    <section className={styles.panel} aria-labelledby="workspace-members-heading">
      <h2 id="workspace-members-heading">課程名冊</h2>
      {members.length === 0 ? (
        <p className={styles.muted}>這門課目前沒有成員。</p>
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

type AffiliationProps = {
  workspaceId: string;
  canApply: boolean;
  affiliation: Record<string, unknown> | null;
  applications: Record<string, unknown>[];
  context: string;
  onChanged: () => void;
  beginRequest?: () => () => void;
};

export function WorkspaceAffiliation(props: AffiliationProps) {
  return (
    <WorkspaceAffiliationContent
      key={`${props.context}:${props.workspaceId}:${props.canApply}`}
      {...props}
    />
  );
}

function WorkspaceAffiliationContent({
  workspaceId,
  canApply,
  affiliation,
  applications,
  context,
  onChanged,
  beginRequest,
}: AffiliationProps) {
  const [tenantId, setTenantId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const mutationPending = useRef(false);
  const captureRequest = useActiveRequest();
  return (
    <section className={styles.panel} aria-labelledby="workspace-affiliation-heading">
      <h2 id="workspace-affiliation-heading">掛靠班次</h2>
      <p className={styles.muted}>
        把課班掛到學校班次後，學生才看得到校方課表對應。核准由平台營運處理。
      </p>
      {denied ? (
        <p role="alert" className={styles.alert}>
          {CLASSROOM_ACCESS_ERROR}
        </p>
      ) : null}
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
      {canApply && !denied ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const isCurrent = captureRequest();
            if (!isCurrent() || mutationPending.current || denied) return;
            const onDenied = beginRequest?.();
            mutationPending.current = true;
            setBusy(true);
            setError('');
            void platformFetch(
              `class-workspaces/${workspaceId}/affiliation-applications`,
              'POST',
              {
                tenantId: tenantId.trim(),
                sectionId: sectionId.trim() || null,
                justification: justification.trim(),
                idempotencyKey: `web-affiliate-${crypto.randomUUID()}`,
              },
              context,
            )
              .then((result) => {
                if (!isCurrent()) return;
                if (classroomAccessDenied(result)) {
                  setDenied(true);
                  setError(CLASSROOM_ACCESS_ERROR);
                  onDenied?.();
                }
                if (result.status === 401) {
                  window.location.replace(accountReturnHref(workspacePath(workspaceId)));
                  return;
                }
                if (classroomAccessDenied(result)) return;
                if (!result.ok) throw new Error('掛靠申請沒有送出，請稍後再試。');
                setTenantId('');
                setSectionId('');
                setJustification('');
                onChanged();
              })
              .catch((failure: Error) => {
                if (isCurrent()) setError(failure.message);
              })
              .finally(() => {
                if (isCurrent()) {
                  mutationPending.current = false;
                  setBusy(false);
                }
              });
          }}
        >
          <Input
            label="學校代號"
            minLength={2}
            maxLength={64}
            value={tenantId}
            onChange={(event) => setTenantId(event.target.value)}
            required
            disabled={busy}
            placeholder="例如 pu"
          />
          <Input
            label="班次代號（選填）"
            maxLength={120}
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
            disabled={busy}
            placeholder="例如 section-ai"
          />
          <Textarea
            label="說明"
            minLength={8}
            maxLength={1000}
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
          <Button
            type="submit"
            disabled={busy || tenantId.trim().length < 2 || justification.trim().length < 8}
          >
            {busy ? '送出中…' : '送出掛靠申請'}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
