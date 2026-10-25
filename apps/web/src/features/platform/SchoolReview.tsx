'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { parseSchools } from '@/features/admin/api';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import {
  accountReturnHref,
  adminLoginHref,
  APPROVE_SCHOOL_REASON,
  currentPageReturnPath,
  OPEN_SCHOOL_REASON,
  OPS_PATH,
  REJECT_SCHOOL_REASON,
  SCHOOL_APPLY_PATH,
  SCHOOL_REVIEW_PATH,
} from './constants';
import { adminFetch, asRecords } from './platformFetch';
import { useActiveRequest } from './useActiveRequest';
import styles from './Platform.module.css';

type Application = {
  id: string;
  displayName: string;
  proposedTenantId?: string;
  proposedEmailDomain?: string;
  contactName?: string;
  contactEmail?: string;
  justification?: string;
};

type ProvisionedSchool = {
  tenantId: string;
  displayName: string;
};

function parseApplications(value: unknown): Application[] {
  return asRecords(value)
    .map((row) => ({
      id: String(row.id || ''),
      displayName: String(row.displayName || '學校申請'),
      proposedTenantId: typeof row.proposedTenantId === 'string' ? row.proposedTenantId : undefined,
      proposedEmailDomain:
        typeof row.proposedEmailDomain === 'string' ? row.proposedEmailDomain : undefined,
      contactName: typeof row.contactName === 'string' ? row.contactName : undefined,
      contactEmail: typeof row.contactEmail === 'string' ? row.contactEmail : undefined,
      justification: typeof row.justification === 'string' ? row.justification : undefined,
    }))
    .filter((row) => row.id);
}

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

function SchoolReviewContent({ context }: { context: string }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [schools, setSchools] = useState<ProvisionedSchool[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const captureRequest = useActiveRequest();
  const mutationPending = useRef(false);

  const load = useCallback(
    async (isCurrent: () => boolean) => {
      const pending = await adminFetch(
        'school-applications?scope=pending',
        'GET',
        undefined,
        context,
      );
      if (!isCurrent()) return;
      if (pending.status === 401) {
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (pending.status === 403) {
        setForbidden(true);
        setApplications([]);
        setSchools([]);
        setLoaded(true);
        return;
      }
      if (!pending.ok) throw new Error('目前讀不到待審申請。');
      setForbidden(false);
      setApplications(parseApplications(pending.body.applications));
      const ops = await adminFetch('schools', 'GET', undefined, context);
      if (!isCurrent()) return;
      if (ops.status === 401) {
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (ops.status === 403) {
        setForbidden(true);
        setApplications([]);
        setSchools([]);
      } else if (!ops.ok) {
        throw new Error('目前讀不到待開放學校。');
      } else {
        setSchools(parseProvisioned(ops.body.schools));
      }
      setLoaded(true);
    },
    [context],
  );

  useEffect(() => {
    const isCurrent = captureRequest();
    setError('');
    void load(isCurrent).catch((failure: Error) => {
      if (isCurrent()) {
        setError(failure.message || '目前讀不到待審申請。');
        setLoaded(true);
      }
    });
  }, [captureRequest, load]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    mutationPending.current = true;
    setBusyId(id);
    setError('');
    try {
      const result = await adminFetch(
        `school-applications/${encodeURIComponent(id)}/decision`,
        'POST',
        {
          decision,
          reason: decision === 'approve' ? APPROVE_SCHOOL_REASON : REJECT_SCHOOL_REASON,
          idempotencyKey: `web-school-decide-${crypto.randomUUID()}`,
        },
        context,
      );
      if (!isCurrent()) return;
      if (result.status === 401) {
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (!result.ok) throw new Error('審核沒有完成，請稍後再試。');
      await load(isCurrent);
    } catch (failure) {
      if (isCurrent()) {
        setError(failure instanceof Error ? failure.message : '審核沒有完成，請稍後再試。');
      }
    } finally {
      if (isCurrent()) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  }

  async function openSchool(tenantId: string) {
    const isCurrent = captureRequest();
    if (!isCurrent() || mutationPending.current) return;
    mutationPending.current = true;
    setBusyId(tenantId);
    setError('');
    try {
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
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (!result.ok) throw new Error('開放沒有完成，請稍後再試。');
      const ops = await adminFetch('schools', 'GET', undefined, context);
      if (!isCurrent()) return;
      if (ops.ok) setSchools(parseProvisioned(ops.body.schools));
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
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>平台營運</p>
          <h1>接入審核</h1>
          <p className={styles.muted}>
            核准會建立或確認學校租戶為已建檔。不會自動開放註冊，也不會把申請人設成校內角色管理員。
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
      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}
      <section className={styles.panel}>
        <h2>待審申請</h2>
        {forbidden ? (
          <p className={styles.notice}>
            這台帳號不是平台營運人員，不能審核學校接入。若你是校方代表人，請改走{' '}
            <Link href={SCHOOL_APPLY_PATH}>學校接入</Link>。
          </p>
        ) : null}
        {!loaded ? <p role="status">正在讀取待審申請…</p> : null}
        {loaded && !forbidden && applications.length === 0 ? <p>目前沒有待審申請。</p> : null}
        {applications.map((item) => (
          <article key={item.id} className={styles.item}>
            <div>
              <strong>{item.displayName}</strong>
              {item.proposedTenantId ? (
                <p className={styles.muted}>{item.proposedTenantId}</p>
              ) : null}
            </div>
            <p className={styles.muted}>
              網域 {item.proposedEmailDomain || '—'} · 聯絡 {item.contactName || '—'}
              {item.contactEmail ? `（${item.contactEmail}）` : ''}
            </p>
            {item.justification ? <p>{item.justification}</p> : null}
            <div className={styles.actions}>
              <Button disabled={busyId !== null} onClick={() => void decide(item.id, 'approve')}>
                核准申請
              </Button>
              <Button disabled={busyId !== null} onClick={() => void decide(item.id, 'reject')}>
                拒絕
              </Button>
            </div>
          </article>
        ))}
      </section>
      {!forbidden ? (
        <section className={styles.panel}>
          <h2>待開放</h2>
          <p className={styles.notice}>建檔未開放，找校尚不可見——一鍵開通後學生才看得到已開通</p>
          {schools.length === 0 ? <p>目前沒有已建檔、尚未開放的學校。</p> : null}
          {schools.map((school) => (
            <article key={school.tenantId} className={styles.item}>
              <div>
                <strong>{school.displayName}</strong>
                <p className={styles.muted}>{school.tenantId}</p>
              </div>
              <div className={styles.actions}>
                <Button disabled={busyId !== null} onClick={() => void openSchool(school.tenantId)}>
                  一鍵開通
                </Button>
                <Link href={OPS_PATH}>去平台管理綁老師</Link>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
