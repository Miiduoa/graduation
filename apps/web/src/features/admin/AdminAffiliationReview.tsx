'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { adminLoginHref, currentPageReturnPath, OPS_PATH } from '@/features/platform/constants';
import { adminFetch } from '@/features/platform/platformFetch';
import { useActiveRequest } from '@/features/platform/useActiveRequest';
import { ReviewControls, type ReviewDecision } from '@/features/platform/ReviewControls';
import { parseSchools } from './api';
import { useAdminResource } from './hooks';
import {
  adminReviewStateLabels,
  parseAffiliationApplication,
  parseAffiliationApplications,
  type AdminAffiliationApplication,
} from './reviewApi';
import styles from '@/features/platform/Platform.module.css';

export type AdminAffiliationReviewProps = {
  context: string;
  suspended: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onDraftChange?: (dirty: boolean) => void;
};

export function AdminAffiliationReview(props: AdminAffiliationReviewProps) {
  if (props.suspended) return <p role="status">正在確認管理權限…</p>;
  return (
    <AffiliationReviewContent key={props.context + ':' + (props.selectedId ?? '')} {...props} />
  );
}

function AffiliationReviewContent({
  context,
  selectedId,
  onSelect,
  onDraftChange,
}: AdminAffiliationReviewProps) {
  const schools = useAdminResource('schools', context, parseSchools);
  const [rows, setRows] = useState<AdminAffiliationApplication[]>([]);
  const [receipt, setReceipt] = useState<AdminAffiliationApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const selectedArticle = useRef<HTMLElement>(null);
  const drafts = useRef(new Set<string>());
  const reportDraft = useCallback(
    (id: string, dirty: boolean) => {
      if (dirty) drafts.current.add(id);
      else drafts.current.delete(id);
      onDraftChange?.(drafts.current.size > 0 || mutationPending.current);
    },
    [onDraftChange],
  );
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);
  useEffect(() => {
    if (selectedId && !loading) selectedArticle.current?.focus();
  }, [selectedId, rows, receipt, loading]);

  const schoolNames = new Map(
    (!schools.loading && !schools.error ? (schools.value ?? []) : [])
      .filter((school) => school.kind === 'tenant' && school.tenantId)
      .map((school) => [school.tenantId!, school.displayName]),
  );
  const visibleRows = selectedId
    ? receipt?.id === selectedId
      ? [receipt]
      : rows.filter((row) => row.id === selectedId)
    : rows.filter((row) => row.state === 'pending');

  const load = useCallback(
    async (isCurrent: () => boolean) => {
      setLoading(true);
      setLoadError('');
      try {
        const result = await adminFetch(
          'class-workspace-affiliation-applications',
          'GET',
          undefined,
          context,
        );
        if (!isCurrent()) return;
        if (result.status === 401) {
          setRows([]);
          setReceipt(null);
          window.location.replace(
            adminLoginHref(currentPageReturnPath(OPS_PATH + '?tab=affiliation')),
          );
          return;
        }
        if (result.status === 403) {
          setLoadError('目前帳號無法處理課班掛靠。');
          setRows([]);
          setReceipt(null);
          return;
        }
        if (!result.ok) throw new Error('目前讀不到掛靠申請。請稍後重試。');
        try {
          setRows(parseAffiliationApplications(result.body));
        } catch {
          throw new Error('目前無法確認掛靠申請資料，請更新清單再試。');
        }
      } catch (failure) {
        if (isCurrent())
          setLoadError(
            failure instanceof Error ? failure.message : '目前讀不到掛靠申請。請稍後重試。',
          );
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [context],
  );

  useEffect(() => {
    void load(captureRequest());
  }, [captureRequest, load]);

  function refresh() {
    if (loading || mutationPending.current) return;
    if (
      drafts.current.size > 0 &&
      !window.confirm('更新清單可能移除狀態已變更的申請及其尚未送出的理由，確定要更新嗎？')
    )
      return;
    schools.reload();
    void load(captureRequest());
  }

  async function decide(id: string, decision: ReviewDecision, reason: string): Promise<boolean> {
    const isCurrent = captureRequest();
    const original = rows.find((row) => row.id === id);
    if (
      !isCurrent() ||
      mutationPending.current ||
      loading ||
      loadError ||
      !original ||
      original.state !== 'pending' ||
      reason.trim().length < 5 ||
      reason.trim().length > 500
    )
      return false;
    mutationPending.current = true;
    onDraftChange?.(true);
    setBusyId(id);
    setError('');
    setNotice('');
    const signature = JSON.stringify([id, decision, reason.trim()]);
    const key = retryKeys.current.get(signature) ?? 'web-affiliate-decide-' + crypto.randomUUID();
    retryKeys.current.set(signature, key);
    try {
      const result = await adminFetch(
        'class-workspace-affiliation-applications/' + encodeURIComponent(id) + '/decision',
        'POST',
        { decision, reason: reason.trim(), idempotencyKey: key },
        context,
      );
      if (!isCurrent()) return false;
      if (result.status === 401) {
        window.location.replace(
          adminLoginHref(currentPageReturnPath(OPS_PATH + '?tab=affiliation')),
        );
        return false;
      }
      if (result.status === 409) {
        retryKeys.current.delete(signature);
        await load(isCurrent);
        throw new Error('這筆掛靠申請已變更，請確認最新資料後再審核。');
      }
      if (!result.ok) throw new Error('掛靠審核沒有完成，請稍後再試。');
      let confirmed: AdminAffiliationApplication;
      try {
        confirmed = parseAffiliationApplication(result.body);
        if (
          confirmed.id !== original.id ||
          confirmed.tenantId !== original.tenantId ||
          confirmed.workspaceId !== original.workspaceId ||
          confirmed.sectionId !== original.sectionId ||
          confirmed.state !== (decision === 'approve' ? 'approved' : 'rejected') ||
          confirmed.decisionReason !== reason.trim()
        )
          throw new Error();
      } catch {
        throw new Error('伺服器回應與這筆掛靠申請不符，無法確認審核結果。請更新清單確認實際狀態。');
      }
      retryKeys.current.delete(signature);
      setReceipt(confirmed);
      setRows((previous) => previous.filter((row) => row.id !== id));
      setNotice(decision === 'approve' ? '已核准掛靠申請。' : '已拒絕掛靠申請。');
      await load(isCurrent);
      return true;
    } catch (failure) {
      if (isCurrent())
        setError(failure instanceof Error ? failure.message : '掛靠審核沒有完成，請稍後再試。');
      return false;
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        onDraftChange?.(drafts.current.size > 0);
        setBusyId(null);
      }
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="affiliation-review-heading">
      <div className={styles.stack}>
        <div className={styles.reviewHeading}>
          <div>
            <h2 id="affiliation-review-heading">課班掛靠</h2>
            <p className={styles.muted}>
              核准只會建立課班與學校的掛靠關係，不會更改正式選課或學籍。
            </p>
          </div>
          <div className={styles.actions}>
            {selectedId && onSelect ? (
              <Button disabled={busyId !== null} onClick={() => onSelect(null)}>
                查看全部申請
              </Button>
            ) : null}
            <Button type="button" disabled={loading || busyId !== null} onClick={refresh}>
              更新清單
            </Button>
          </div>
        </div>
        {loading ? <p role="status">正在讀取掛靠申請…</p> : null}
        {loadError ? (
          <p role="alert" className={styles.alert}>
            {loadError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        {!loading && !loadError && visibleRows.length === 0 ? (
          <p role="status" className={styles.emptyState}>
            {selectedId
              ? '本次載入找不到這筆掛靠申請。請更新清單或查看全部申請。'
              : '目前沒有待處理的掛靠申請。'}
          </p>
        ) : null}
        {visibleRows.map((row) => {
          const tenant = schoolNames.get(row.tenantId) || '學校代號：' + row.tenantId;
          const finalized = row.state !== 'pending';
          return (
            <article
              key={row.id}
              ref={selectedId === row.id ? selectedArticle : undefined}
              tabIndex={selectedId === row.id ? -1 : undefined}
              aria-label={row.workspaceTitle + '／' + tenant + '掛靠申請'}
              className={styles.item}
            >
              <div className={styles.reviewIdentity}>
                <strong>{row.workspaceTitle}</strong>
                <span className={styles.reviewType}>{adminReviewStateLabels[row.state]}</span>
              </div>
              <p className={styles.muted}>
                目標學校：{tenant}
                {row.sectionId ? ' · 班次 ' + row.sectionId : ''}
              </p>
              <p>{row.justification}</p>
              {finalized ? (
                <>
                  <p className={styles.muted}>本次審核已完成，這筆申請無須再次審核。</p>
                  {row.decisionReason ? <p>審核理由：{row.decisionReason}</p> : null}
                </>
              ) : (
                <ReviewControls
                  subject={row.workspaceTitle + '／' + tenant}
                  approveLabel="核准掛靠"
                  disabled={busyId !== null || loading || !!loadError}
                  busy={busyId === row.id}
                  onDecide={(decision, reason) => decide(row.id, decision, reason)}
                  onDraftChange={(dirty) => reportDraft(row.id, dirty)}
                />
              )}
              {!selectedId && onSelect ? (
                <Button disabled={busyId !== null || loading} onClick={() => onSelect(row.id)}>
                  開啟申請詳情
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
