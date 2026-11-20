'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { adminLoginHref, currentPageReturnPath, OPS_PATH } from '@/features/platform/constants';
import { adminFetch } from '@/features/platform/platformFetch';
import { useActiveRequest } from '@/features/platform/useActiveRequest';
import { ReviewControls, type ReviewDecision } from '@/features/platform/ReviewControls';
import { AdminMerchants } from './AdminMerchants';
import { useAdminResource } from './hooks';
import {
  applicationStateLabel,
  interestStateLabel,
  isMerchantApplicationReviewable,
  parseMerchantApplicationDecision,
  parseOversightMerchantInterest,
  parseOversightMerchants,
  type OversightMerchants,
} from './oversightApi';
import styles from '@/features/platform/Platform.module.css';

export type AdminMerchantReviewProps = {
  context: string;
  suspended: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onDraftChange?: (dirty: boolean) => void;
};

export function AdminMerchantReview(props: AdminMerchantReviewProps) {
  if (props.suspended) return <p role="status">正在確認管理權限…</p>;
  return <MerchantReviewContent key={props.context + ':' + (props.selectedId ?? '')} {...props} />;
}

function MerchantReviewContent({
  context,
  selectedId,
  onSelect,
  onDraftChange,
}: AdminMerchantReviewProps) {
  const resource = useAdminResource('merchants', context, parseOversightMerchants);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
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

  function refresh() {
    if (mutationPending.current || resource.loading) return;
    if (
      drafts.current.size > 0 &&
      !window.confirm('更新清單可能移除狀態已變更的申請及其尚未送出的理由，確定要更新嗎？')
    )
      return;
    resource.reload();
  }

  async function decide(
    path: string,
    id: string,
    decision: ReviewDecision,
    reason: string,
    expectedVersion?: number,
  ): Promise<boolean> {
    const isCurrent = captureRequest();
    const interest = resource.value?.interest.find((row) => id === 'interest:' + row.id);
    const application = resource.value?.applications.find(
      (row) => id === 'application:' + row.tenantId + ':' + row.applicationId,
    );
    if (
      !isCurrent() ||
      mutationPending.current ||
      resource.loading ||
      resource.error ||
      !id ||
      reason.trim().length < 5 ||
      reason.trim().length > 500
    )
      return false;
    if (expectedVersion === undefined) {
      if (!interest || interest.state !== 'submitted') return false;
    } else if (
      !application ||
      application.version !== expectedVersion ||
      !isMerchantApplicationReviewable(application.state)
    )
      return false;
    mutationPending.current = true;
    onDraftChange?.(true);
    setBusyId(id);
    setError('');
    setNotice('');
    const signature = JSON.stringify([path, decision, reason.trim()]);
    const key = retryKeys.current.get(signature) ?? 'web-merchant-decide-' + crypto.randomUUID();
    if (expectedVersion === undefined) retryKeys.current.set(signature, key);
    try {
      const result = await adminFetch(
        path,
        'POST',
        {
          decision,
          reason: reason.trim(),
          ...(expectedVersion === undefined ? { idempotencyKey: key } : { expectedVersion }),
        },
        context,
      );
      if (!isCurrent()) return false;
      if (result.status === 401) {
        window.location.replace(adminLoginHref(currentPageReturnPath(OPS_PATH + '?tab=merchants')));
        return false;
      }
      if (result.status === 409) {
        retryKeys.current.delete(signature);
        resource.reload();
        throw new Error('這筆申請已更新，請確認最新資料後再審核。');
      }
      if (!result.ok) throw new Error('店家審核沒有完成，請稍後再試。');
      try {
        const expectedState = decision === 'approve' ? 'approved' : 'rejected';
        if (expectedVersion === undefined) {
          const confirmed = parseOversightMerchantInterest(result.body);
          if (
            confirmed.id !== interest?.id ||
            confirmed.state !== expectedState ||
            !confirmed.decidedAt
          )
            throw new Error();
        } else {
          const confirmed = parseMerchantApplicationDecision(result.body);
          if (
            !application ||
            confirmed.tenantId !== application.tenantId ||
            confirmed.applicationId !== application.applicationId ||
            confirmed.state !== expectedState ||
            confirmed.version !== expectedVersion + 1
          )
            throw new Error();
        }
      } catch {
        throw new Error('伺服器回應與這筆申請不符，無法確認審核結果。請更新清單確認實際狀態。');
      }
      retryKeys.current.delete(signature);
      setNotice(decision === 'approve' ? '已核准這筆店家申請。' : '已拒絕這筆店家申請。');
      resource.reload();
      return true;
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : '店家審核沒有完成，請稍後再試。');
      }
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
    <div className={styles.stack}>
      <section className={styles.panel} aria-labelledby="merchant-review-heading">
        <div className={styles.reviewHeading}>
          <div>
            <h2 id="merchant-review-heading">{selectedId ? '店家申請詳情' : '待審店家'}</h2>
            <p className={styles.muted}>核對申請對象、學校與聯絡資料，再填寫審核理由。</p>
          </div>
          <div className={styles.actions}>
            {selectedId && onSelect ? (
              <Button disabled={busyId !== null} onClick={() => onSelect(null)}>
                查看全部申請
              </Button>
            ) : null}
            <Button disabled={resource.loading || busyId !== null} onClick={refresh}>
              更新清單
            </Button>
          </div>
        </div>
        <p className={styles.notice}>
          合作意向與正式進件分別審核。核准後仍須完成店家設定，才會開放點餐或公開營業。
        </p>
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
        {resource.loading ? <p role="status">正在讀取待審店家…</p> : null}
        {resource.error ? (
          <div className={styles.stack}>
            <p role="alert" className={styles.alert}>
              目前讀不到待審店家。
            </p>
            <Button onClick={refresh}>重試讀取</Button>
          </div>
        ) : null}
        {resource.value ? (
          <MerchantDecisions
            data={resource.value}
            selectedId={selectedId}
            onSelect={onSelect}
            busyId={busyId}
            suspended={resource.loading || !!resource.error}
            onDecide={decide}
            onDraftChange={reportDraft}
          />
        ) : null}
      </section>
      {resource.value && !resource.error && !selectedId ? (
        <AdminMerchants
          context={context}
          suspended={false}
          data={resource.value}
          embedded
          hidePending
          onRefresh={refresh}
          refreshDisabled={resource.loading || busyId !== null}
        />
      ) : null}
    </div>
  );
}

function MerchantDecisions({
  data,
  selectedId,
  onSelect,
  busyId,
  suspended,
  onDecide,
  onDraftChange,
}: {
  data: OversightMerchants;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  busyId: string | null;
  suspended: boolean;
  onDecide: (
    path: string,
    id: string,
    decision: ReviewDecision,
    reason: string,
    expectedVersion?: number,
  ) => Promise<boolean>;
  onDraftChange: (id: string, dirty: boolean) => void;
}) {
  const selectedArticle = useRef<HTMLElement>(null);
  const interest = data.interest.filter((row) =>
    selectedId ? selectedId === 'interest:' + row.id : row.state === 'submitted',
  );
  const applications = data.applications.filter((row) =>
    selectedId
      ? selectedId === 'application:' + row.tenantId + ':' + row.applicationId
      : isMerchantApplicationReviewable(row.state),
  );
  useEffect(() => {
    if (selectedId) selectedArticle.current?.focus();
  }, [selectedId, data]);
  if (!interest.length && !applications.length) {
    return selectedId ? (
      <p role="status" className={styles.emptyState}>
        本次載入找不到這筆店家申請。請更新清單或查看全部申請。
      </p>
    ) : (
      <p className={styles.emptyState}>目前沒有待審店家申請。</p>
    );
  }
  return (
    <div className={styles.stack}>
      {interest.map((row) => {
        const id = 'interest:' + row.id;
        return (
          <article
            key={id}
            ref={selectedId === id ? selectedArticle : undefined}
            tabIndex={selectedId === id ? -1 : undefined}
            aria-label={row.brandName + '／' + row.schoolName + '合作意向'}
            className={styles.item}
          >
            <div className={styles.reviewIdentity}>
              <strong>
                {row.brandName} · {row.schoolName}
              </strong>
              <span className={styles.reviewType}>合作意向 · {interestStateLabel(row.state)}</span>
            </div>
            <p className={styles.muted}>
              聯絡：{row.contactName} · {row.contactEmail}
            </p>
            {row.note ? <p className={styles.muted}>補充：{row.note}</p> : null}
            {row.state === 'submitted' ? (
              <ReviewControls
                subject={row.brandName + '／' + row.schoolName}
                approveLabel="核准意向"
                disabled={suspended || busyId !== null || !row.id}
                busy={busyId === id}
                onDraftChange={(dirty) => onDraftChange(id, dirty)}
                onDecide={(decision, reason) =>
                  onDecide(
                    'merchants/interest/' + encodeURIComponent(row.id) + '/decision',
                    id,
                    decision,
                    reason,
                  )
                }
              />
            ) : (
              <p className={styles.muted}>這筆合作意向已完成審核。</p>
            )}
            {!selectedId && onSelect ? (
              <Button disabled={suspended || busyId !== null} onClick={() => onSelect(id)}>
                開啟申請詳情
              </Button>
            ) : null}
          </article>
        );
      })}
      {applications.map((row) => {
        const id = 'application:' + row.tenantId + ':' + row.applicationId;
        return (
          <article
            key={id}
            ref={selectedId === id ? selectedArticle : undefined}
            tabIndex={selectedId === id ? -1 : undefined}
            aria-label={row.brandName + '／' + row.locationName + '店家進件'}
            className={styles.item}
          >
            <div className={styles.reviewIdentity}>
              <strong>
                {row.brandName}／{row.locationName}
              </strong>
              <span className={styles.reviewType}>
                店家進件 · {applicationStateLabel(row.state).label}
              </span>
            </div>
            <p className={styles.muted}>
              {row.tenantName} · 聯絡：{row.contactName} · {row.contactEmail}
            </p>
            <p className={styles.muted}>申請版本：{row.version}</p>
            {isMerchantApplicationReviewable(row.state) ? (
              <ReviewControls
                key={id + ':' + row.version}
                subject={row.brandName + '／' + row.locationName + '（' + row.tenantName + '）'}
                approveLabel="核准進件"
                disabled={suspended || busyId !== null || !row.applicationId}
                busy={busyId === id}
                onDraftChange={(dirty) => onDraftChange(id, dirty)}
                onDecide={(decision, reason) =>
                  onDecide(
                    'merchants/applications/' +
                      encodeURIComponent(row.tenantId) +
                      '/' +
                      encodeURIComponent(row.applicationId) +
                      '/decision',
                    id,
                    decision,
                    reason,
                    row.version,
                  )
                }
              />
            ) : (
              <p className={styles.muted}>目前狀態不需要核准或拒絕，請依申請進度追蹤。</p>
            )}
            {!selectedId && onSelect ? (
              <Button disabled={suspended || busyId !== null} onClick={() => onSelect(id)}>
                開啟申請詳情
              </Button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
