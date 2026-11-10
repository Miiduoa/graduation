'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NuniError } from '@campus/shared/src/nuni';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { adminError, parseSchools } from '@/features/admin/api';
import { parseOversightPeople } from '@/features/admin/oversightApi';
import {
  parseSchoolApplication,
  parseSchoolApplications,
  type AdminSchoolApplication,
} from '@/features/admin/reviewApi';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import {
  adminLoginHref,
  currentPageReturnPath,
  OPEN_SCHOOL_REASON,
  OPS_PATH,
  SCHOOL_APPLY_PATH,
  SCHOOL_REVIEW_PATH,
} from './constants';
import { adminFetch } from './platformFetch';
import { useActiveRequest } from './useActiveRequest';
import styles from './Platform.module.css';

type ProvisionedSchool = {
  tenantId: string;
  displayName: string;
};

function parseProvisioned(value: unknown): ProvisionedSchool[] {
  return parseSchools({ schools: value })
    .filter(
      (row) => row.lifecycle === 'provisioned' && typeof row.tenantId === 'string' && row.tenantId,
    )
    .map((row) => ({
      tenantId: String(row.tenantId),
      displayName: String(row.displayName || row.tenantId),
    }));
}

export function SchoolReview() {
  const auth = useNuniSession();
  const operator = !!auth.session?.isPlatformOperator;
  return (
    <SiteShell
      header={<AdminHeader />}
      title={auth.session?.isPlatformOperator ? undefined : '接入審核'}
    >
      {auth.loading || auth.pendingLogout ? (
        <p role="status" className={common.loading}>
          正在確認管理權限…
        </p>
      ) : !operator ? (
        <section className={`${common.stateCard} ${admin.gateCard}`}>
          <p className={admin.eyebrow}>平台營運</p>
          <h2>{auth.session ? '沒有管理權限' : '請先登入管理員帳號'}</h2>
          <p>
            {auth.error ||
              (auth.session
                ? '這台帳號不是平台營運人員，不能審核學校接入。若你是校方代表人，請改走學校接入。'
                : '登入後會確認你的平台管理權限，才能審核學校接入。')}
          </p>
          <div className={common.actions}>
            {auth.session ? (
              <Link className={admin.link} href={SCHOOL_APPLY_PATH}>
                學校接入
              </Link>
            ) : (
              <Link
                className={admin.link}
                href={adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH))}
              >
                前往管理員登入
              </Link>
            )}
            {auth.error ? <Button onClick={() => void auth.refresh()}>重新確認</Button> : null}
          </div>
        </section>
      ) : (
        <SchoolReviewContent
          key={`${auth.session!.platformAccountId}:${auth.session!.context}`}
          context={auth.session!.context}
        />
      )}
    </SiteShell>
  );
}

export type SchoolReviewContentProps = {
  context: string;
  embedded?: boolean;
  suspended?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onManagePeople?: (tenantId: string) => void;
  onManageSchool?: (tenantId: string) => void;
  onDraftChange?: (dirty: boolean) => void;
};

export function SchoolReviewContent(props: SchoolReviewContentProps) {
  if (props.suspended) return <p role="status">正在確認管理權限…</p>;
  return <SchoolReviewBody key={`${props.context}:${props.selectedId ?? ''}`} {...props} />;
}

function SchoolReviewBody({
  context,
  embedded = false,
  selectedId = null,
  onSelect,
  onManagePeople,
  onManageSchool,
  onDraftChange,
}: SchoolReviewContentProps) {
  const [applications, setApplications] = useState<AdminSchoolApplication[]>([]);
  const [schools, setSchools] = useState<ProvisionedSchool[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nextSchool, setNextSchool] = useState<ProvisionedSchool | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<{
    id: string;
    decision: 'approve' | 'reject';
    reason: string;
    key: string;
  } | null>(null);
  const [openCheck, setOpenCheck] = useState<{
    tenantId: string;
    hasRoleAdmin: boolean;
    roleAdminNames: string[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hasData, setHasData] = useState(false);
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);
  const loadSequence = useRef(0);
  const visibleApplications = selectedId
    ? applications.filter((application) => application.id === selectedId)
    : applications;
  const hasDraft = decisionDraft !== null || openCheck !== null;
  useEffect(() => {
    onDraftChange?.(hasDraft);
    return () => onDraftChange?.(false);
  }, [hasDraft, onDraftChange]);

  const load = useCallback(
    async (isCurrent: () => boolean) => {
      const sequence = ++loadSequence.current;
      const current = () => isCurrent() && sequence === loadSequence.current;
      if (!current()) return;
      setLoaded(false);
      setHasData(false);
      const clearPrivilegedData = () => {
        setApplications([]);
        setSchools([]);
        setDecisionDraft(null);
        setOpenCheck(null);
        setNotice('');
        setNextSchool(null);
      };
      try {
        const pending = await adminFetch(
          'school-applications?scope=pending',
          'GET',
          undefined,
          context,
        );
        if (!current()) return;
        if (pending.status === 401) {
          clearPrivilegedData();
          window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
          return;
        }
        if (pending.status === 403) {
          setForbidden(true);
          clearPrivilegedData();
          return;
        }
        if (!pending.ok) throw new Error('目前讀不到待審申請。');
        const pendingApplications = parseSchoolApplications(pending.body).filter(
          (application) => application.state === 'pending',
        );
        const ops = await adminFetch('schools', 'GET', undefined, context);
        if (!current()) return;
        if (ops.status === 401) {
          clearPrivilegedData();
          window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
          return;
        }
        if (ops.status === 403) {
          setForbidden(true);
          clearPrivilegedData();
        } else if (!ops.ok) {
          throw new Error('目前讀不到待開放學校。');
        } else {
          setSchools(parseProvisioned(ops.body.schools));
          setApplications(pendingApplications);
          setDecisionDraft((draft) =>
            draft && pendingApplications.some((application) => application.id === draft.id)
              ? draft
              : null,
          );
          setForbidden(false);
          setHasData(true);
        }
      } finally {
        if (current()) setLoaded(true);
      }
    },
    [context],
  );

  useEffect(() => {
    const isCurrent = captureRequest();
    void load(isCurrent).catch((failure: Error) => {
      if (isCurrent()) {
        setError(
          failure instanceof NuniError
            ? adminError(failure)
            : failure.message || '目前讀不到待審申請。',
        );
        setLoaded(true);
      }
    });
  }, [captureRequest, load]);

  async function reload() {
    if (!loaded || mutationPending.current) return;
    const isCurrent = captureRequest();
    if (!isCurrent()) return;
    setLoaded(false);
    setError('');
    setOpenCheck(null);
    try {
      await load(isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        setError(
          failure instanceof NuniError ? adminError(failure) : '目前讀不到審核資料，請重新讀取。',
        );
        setLoaded(true);
      }
    }
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    const reason =
      decisionDraft?.id === id && decisionDraft.decision === decision
        ? decisionDraft.reason.trim()
        : '';
    if (
      reason.length < 5 ||
      reason.length > 1000 ||
      !visibleApplications.some((application) => application.id === id)
    )
      return;
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    mutationPending.current = true;
    setBusyId(id);
    setError('');
    setNotice('');
    setNextSchool(null);
    try {
      const result = await adminFetch(
        `school-applications/${encodeURIComponent(id)}/decision`,
        'POST',
        {
          decision,
          reason,
          idempotencyKey: decisionDraft!.key,
        },
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
        return;
      }
      if (!result.ok) throw new Error('審核沒有完成，請稍後再試。');
      const confirmed = parseSchoolApplication(result.body);
      if (
        confirmed.id !== id ||
        confirmed.state !== (decision === 'approve' ? 'approved' : 'rejected')
      )
        throw new Error('審核回應與這筆申請不一致，請更新清單確認結果。');
      if (decision === 'approve' && confirmed.tenantId) {
        setNextSchool({ tenantId: confirmed.tenantId, displayName: confirmed.displayName });
        setNotice(`已核准${confirmed.displayName}的接入申請。接著確認校方管理員與服務設定。`);
      } else {
        setNotice(`已拒絕${confirmed.displayName}的接入申請。`);
      }
      setDecisionDraft(null);
      setApplications((current) => current.filter((application) => application.id !== id));
      await load(isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        setError(
          failure instanceof NuniError
            ? adminError(failure)
            : failure instanceof Error
              ? failure.message
              : '審核沒有完成，請稍後再試。',
        );
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }

  async function checkOpening(tenantId: string) {
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    mutationPending.current = true;
    setBusyId(tenantId);
    setError('');
    setOpenCheck(null);
    try {
      const response = await adminFetch(
        `people?tenantId=${encodeURIComponent(tenantId)}`,
        'GET',
        undefined,
        context,
      );
      if (!isCurrent()) return;
      if (response.status === 401) {
        window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
        return;
      }
      if (!response.ok) throw new Error('目前無法確認校方管理員。');
      const reviewed = parseOversightPeople(response.body);
      if (reviewed.tenantId !== tenantId) throw new Error('校方授權與選定學校不一致。');
      setOpenCheck({
        tenantId,
        hasRoleAdmin: reviewed.hasRoleAdmin,
        roleAdminNames: reviewed.roleAdmins.map((row) => row.displayName),
      });
    } catch {
      if (isCurrent()) setError('無法查核校方管理員，尚未開通。請稍後重新檢查。');
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }

  async function openSchool(tenantId: string) {
    if (!openCheck?.hasRoleAdmin || openCheck.tenantId !== tenantId) return;
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    mutationPending.current = true;
    setBusyId(tenantId);
    setError('');
    try {
      // Recheck at confirmation time; the earlier preview is not an authorization token.
      const check = await adminFetch(
        `people?tenantId=${encodeURIComponent(tenantId)}`,
        'GET',
        undefined,
        context,
      );
      if (!isCurrent()) return;
      if (check.status === 401) {
        window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
        return;
      }
      if (!check.ok) throw new Error('校方管理員資料無法重新確認，尚未開通。');
      const confirmed = parseOversightPeople(check.body);
      if (confirmed.tenantId !== tenantId || !confirmed.hasRoleAdmin) {
        setOpenCheck({ tenantId, hasRoleAdmin: false, roleAdminNames: [] });
        throw new Error('目前沒有有效的校方管理員，請先完成指派。');
      }
      const result = await adminFetch(
        `schools/${encodeURIComponent(tenantId)}/open`,
        'POST',
        {
          reason: OPEN_SCHOOL_REASON,
          idempotencyKey: `web-school-open-${crypto.randomUUID()}`,
        },
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(adminLoginHref(currentPageReturnPath(SCHOOL_REVIEW_PATH)));
        return;
      }
      if (!result.ok) throw new Error('開放沒有完成，請稍後再試。');
      if (result.body.tenantId !== tenantId || result.body.tenantState !== 'open')
        throw new Error('開通回應無法確認，請更新學校狀態後再繼續。');
      const schoolName = schools.find((school) => school.tenantId === tenantId)?.displayName;
      setNotice(`${schoolName || tenantId}已開通。`);
      setOpenCheck(null);
      const ops = await adminFetch('schools', 'GET', undefined, context);
      if (!isCurrent()) return;
      if (ops.ok) {
        setSchools(parseProvisioned(ops.body.schools));
      } else throw new Error('開通已完成，但學校清單尚未更新，請重新讀取。');
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : '開放沒有完成，請稍後再試。');
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }

  return (
    <div className={embedded ? styles.stack : styles.page}>
      {!embedded && (
        <header className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>平台營運</p>
            <h1>接入審核</h1>
            <p className={styles.muted}>
              核准申請只代表建立學校資料，不會自動授予校方身分。正式開通前請先指派校方管理員，確認校方有人可以管理服務。
            </p>
          </div>
          <nav className={styles.links} aria-label="營運作業">
            <Link href={SCHOOL_REVIEW_PATH} aria-current="page">
              審核
            </Link>
            <Link href={OPS_PATH}>開通</Link>
            <Link href={`${OPS_PATH}?tab=affiliation`}>掛靠</Link>
          </nav>
        </header>
      )}
      {error ? (
        <div className={styles.stack}>
          <p role="alert" className={styles.alert}>
            {error}
          </p>
          <Button disabled={!loaded || busyId !== null} onClick={() => void reload()}>
            重新讀取審核資料
          </Button>
        </div>
      ) : null}
      {notice && (
        <section className={styles.notice} aria-label="學校審核結果">
          <p role="status">{notice}</p>
          {nextSchool && (
            <div className={styles.actions}>
              {onManagePeople ? (
                <Button
                  onClick={() => onManagePeople(nextSchool.tenantId)}
                  disabled={busyId !== null}
                >
                  設定{nextSchool.displayName}的管理員
                </Button>
              ) : (
                <Link
                  href={`${OPS_PATH}?tab=people&tenantId=${encodeURIComponent(nextSchool.tenantId)}`}
                >
                  設定{nextSchool.displayName}的管理員
                </Link>
              )}
              {onManageSchool ? (
                <Button
                  onClick={() => onManageSchool(nextSchool.tenantId)}
                  disabled={busyId !== null}
                >
                  查看學校設定
                </Button>
              ) : (
                <Link
                  href={`${OPS_PATH}?tab=schools&tenantId=${encodeURIComponent(nextSchool.tenantId)}`}
                >
                  查看學校設定
                </Link>
              )}
            </div>
          )}
        </section>
      )}
      <section className={styles.panel} aria-labelledby="school-review-queue-heading">
        <div className={styles.reviewHeading}>
          <div>
            <h2 id="school-review-queue-heading">{selectedId ? '申請詳情' : '待審申請'}</h2>
            <p className={styles.muted}>核對申請後建立學校資料，再指派管理員、確認服務並開通。</p>
          </div>
          <div className={styles.actions}>
            {selectedId &&
              (onSelect ? (
                <Button disabled={busyId !== null} onClick={() => onSelect(null)}>
                  返回申請清單
                </Button>
              ) : (
                <Link href={SCHOOL_REVIEW_PATH}>返回申請清單</Link>
              ))}
            <Button disabled={!loaded || busyId !== null} onClick={() => void reload()}>
              更新申請清單
            </Button>
          </div>
        </div>
        {forbidden ? (
          <p className={styles.notice}>
            這台帳號不是平台營運人員，不能審核學校接入。若你是校方代表人，請改走{' '}
            <Link href={SCHOOL_APPLY_PATH}>學校接入</Link>。
          </p>
        ) : null}
        {!loaded ? <p role="status">正在讀取待審申請…</p> : null}
        {loaded && hasData && !forbidden && visibleApplications.length === 0 ? (
          <p>
            {selectedId
              ? '這筆申請已處理或不在目前清單中。可以更新清單確認，或返回查看其他申請。'
              : '目前沒有待審申請。'}
          </p>
        ) : null}
        {!forbidden &&
          hasData &&
          loaded &&
          visibleApplications.map((item) => (
            <article key={item.id} className={styles.item}>
              <div>
                <strong>{item.displayName}</strong>
                {item.proposedTenantId ? (
                  <p className={styles.muted}>{item.proposedTenantId}</p>
                ) : null}
              </div>
              <p className={styles.muted}>
                網域 {item.proposedEmailDomain} · 聯絡 {item.contactName}（{item.contactEmail}）
              </p>
              {item.justification ? <p>{item.justification}</p> : null}
              <div className={styles.actions}>
                <Button
                  disabled={busyId !== null}
                  onClick={() =>
                    setDecisionDraft({
                      id: item.id,
                      decision: 'approve',
                      reason: '',
                      key: crypto.randomUUID(),
                    })
                  }
                >
                  核准申請
                </Button>
                <Button
                  disabled={busyId !== null}
                  onClick={() =>
                    setDecisionDraft({
                      id: item.id,
                      decision: 'reject',
                      reason: '',
                      key: crypto.randomUUID(),
                    })
                  }
                >
                  拒絕
                </Button>
              </div>
              {decisionDraft?.id === item.id && (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void decide(item.id, decisionDraft.decision);
                  }}
                >
                  <h3>{decisionDraft.decision === 'approve' ? '確認核准申請' : '確認拒絕申請'}</h3>
                  <p className={styles.notice}>
                    {decisionDraft.decision === 'approve'
                      ? '核准只代表建立學校資料，不會立即開通或授予校方人員權限。'
                      : '拒絕前請說明需要補齊的資料或不符條件的具體原因。'}
                  </p>
                  <Textarea
                    label="審核理由"
                    required
                    minLength={5}
                    maxLength={1000}
                    hint="至少 5 字，請依實際審核結果說明。"
                    value={decisionDraft.reason}
                    disabled={busyId !== null}
                    onChange={(event) =>
                      setDecisionDraft((current) =>
                        current?.id === item.id
                          ? { ...current, reason: event.target.value, key: crypto.randomUUID() }
                          : current,
                      )
                    }
                  />
                  <div className={styles.actions}>
                    <Button
                      type="submit"
                      variant={decisionDraft.decision === 'reject' ? 'danger' : 'primary'}
                      disabled={busyId !== null || decisionDraft.reason.trim().length < 5}
                    >
                      {decisionDraft.decision === 'approve' ? '確定核准申請' : '確定拒絕申請'}
                    </Button>
                    <Button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => setDecisionDraft(null)}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              )}
            </article>
          ))}
      </section>
      {!forbidden && !selectedId ? (
        <section className={styles.panel}>
          <h2>待開放</h2>
          <p className={styles.notice}>
            學校建檔後仍不會立即出現在正式服務中。先查核校方管理員，再明確確認開通。
          </p>
          {!loaded ? <p role="status">正在讀取待開放學校…</p> : null}
          {loaded && hasData && schools.length === 0 ? (
            <p>目前沒有已建檔、尚未開放的學校。</p>
          ) : null}
          {loaded &&
            hasData &&
            schools.map((school) => (
              <article key={school.tenantId} className={styles.item}>
                <div>
                  <strong>{school.displayName}</strong>
                  <p className={styles.muted}>{school.tenantId}</p>
                </div>
                <div className={styles.actions}>
                  <Button
                    disabled={busyId !== null}
                    onClick={() => void checkOpening(school.tenantId)}
                  >
                    檢查開通條件
                  </Button>
                  {onManagePeople ? (
                    <Button
                      disabled={busyId !== null}
                      onClick={() => onManagePeople(school.tenantId)}
                    >
                      管理校方人員
                    </Button>
                  ) : (
                    <Link
                      href={`${OPS_PATH}?tab=people&tenantId=${encodeURIComponent(school.tenantId)}`}
                    >
                      管理校方人員
                    </Link>
                  )}
                  {onManageSchool && (
                    <Button
                      disabled={busyId !== null}
                      onClick={() => onManageSchool(school.tenantId)}
                    >
                      查看學校設定
                    </Button>
                  )}
                </div>
                {openCheck?.tenantId === school.tenantId && (
                  <div className={styles.stack} aria-live="polite">
                    {openCheck.hasRoleAdmin ? (
                      <div className={styles.notice}>
                        <strong>授權查核通過</strong>
                        <p>
                          已指派的校方管理員：{openCheck.roleAdminNames.join('、')}。
                          請確認學校名稱與服務設定，再正式開通。
                        </p>
                        <div className={styles.actions}>
                          <Button
                            variant="primary"
                            disabled={busyId !== null}
                            onClick={() => void openSchool(school.tenantId)}
                          >
                            確認開通 {school.displayName}
                          </Button>
                          <Button disabled={busyId !== null} onClick={() => setOpenCheck(null)}>
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.stack}>
                        <p role="alert" className={styles.alert}>
                          尚未指定有效的校方管理員。請先到「管理校方人員」完成指派，
                          再重新檢查開通條件。
                        </p>
                        <Button disabled={busyId !== null} onClick={() => setOpenCheck(null)}>
                          收起查核結果
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
        </section>
      ) : null}
    </div>
  );
}
