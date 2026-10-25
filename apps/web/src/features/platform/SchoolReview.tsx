'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import {
  accountReturnHref,
  APPROVE_SCHOOL_REASON,
  OPEN_SCHOOL_REASON,
  OPS_PATH,
  REJECT_SCHOOL_REASON,
  SCHOOL_APPLY_PATH,
  SCHOOL_REVIEW_PATH,
} from './constants';
import { asRecords, platformFetch } from './platformFetch';
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
  return asRecords(value)
    .filter((row) => row.lifecycle === 'provisioned' && typeof row.tenantId === 'string' && row.tenantId)
    .map((row) => ({
      tenantId: String(row.tenantId),
      displayName: String(row.displayName || row.tenantId),
    }));
}

export function SchoolReview() {
  const auth = useNuniSession();
  const [applications, setApplications] = useState<Application[]>([]);
  const [schools, setSchools] = useState<ProvisionedSchool[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const pending = await platformFetch('/auth/platform/school-applications?scope=pending');
    if (pending.status === 401) {
      window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
      return;
    }
    if (pending.status === 403) {
      setForbidden(true);
      setApplications([]);
      setLoaded(true);
      return;
    }
    if (!pending.ok) throw new Error('目前讀不到待審申請。');
    setForbidden(false);
    setApplications(parseApplications(pending.body.applications));
    const ops = await platformFetch('/auth/platform/ops-api/schools');
    if (ops.status === 401 || ops.status === 403) {
      setSchools([]);
    } else if (!ops.ok) {
      throw new Error('目前讀不到待開放學校。');
    } else {
      setSchools(parseProvisioned(ops.body.schools));
    }
    setLoaded(true);
  }

  useEffect(() => {
    if (!auth.session || auth.loading) return;
    let active = true;
    setError('');
    void load().catch((failure: Error) => {
      if (active) {
        setError(failure.message || '目前讀不到待審申請。');
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session?.context, auth.loading]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    setError('');
    try {
      const result = await platformFetch(
        `/auth/platform/school-applications/${encodeURIComponent(id)}/decision`,
        {
          decision,
          reason: decision === 'approve' ? APPROVE_SCHOOL_REASON : REJECT_SCHOOL_REASON,
          idempotencyKey: `web-school-decide-${crypto.randomUUID()}`,
        },
      );
      if (result.status === 401) {
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (!result.ok) throw new Error('審核沒有完成，請稍後再試。');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '審核沒有完成，請稍後再試。');
    } finally {
      setBusyId(null);
    }
  }

  async function openSchool(tenantId: string) {
    setBusyId(tenantId);
    setError('');
    try {
      const result = await platformFetch(
        `/auth/platform/ops-api/schools/${encodeURIComponent(tenantId)}/open`,
        {
          reason: OPEN_SCHOOL_REASON,
          idempotencyKey: `web-school-open-${crypto.randomUUID()}`,
        },
      );
      if (result.status === 401) {
        window.location.replace(accountReturnHref(SCHOOL_REVIEW_PATH));
        return;
      }
      if (!result.ok) throw new Error('開放沒有完成，請稍後再試。');
      const ops = await platformFetch('/auth/platform/ops-api/schools');
      if (ops.ok) setSchools(parseProvisioned(ops.body.schools));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '開放沒有完成，請稍後再試。');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SiteShell header={<AdminHeader />} title={auth.session?.isPlatformOperator ? undefined : '接入審核'}>
      {!auth.session && !auth.loading ? (
        <section className={`${common.stateCard} ${admin.gateCard}`}>
          <p className={admin.eyebrow}>平台營運</p>
          <h2>請先登入管理員帳號</h2>
          <p>登入後會確認你的平台管理權限，才能審核學校接入。</p>
          <div className={common.actions}>
            <Link className={admin.link} href="/admin/login">
              前往管理員登入
            </Link>
          </div>
        </section>
      ) : auth.loading && !auth.session ? (
        <p role="status" className={common.loading}>
          正在確認管理權限…
        </p>
      ) : (
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
              <Link href={`${OPS_PATH}#affiliation`}>掛靠</Link>
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
            {!loaded && auth.session ? <p role="status">正在讀取待審申請…</p> : null}
            {loaded && !forbidden && applications.length === 0 ? <p>目前沒有待審申請。</p> : null}
            {applications.map((item) => (
              <article key={item.id} className={styles.item}>
                <div>
                  <strong>{item.displayName}</strong>
                  {item.proposedTenantId ? <p className={styles.muted}>{item.proposedTenantId}</p> : null}
                </div>
                <p className={styles.muted}>
                  網域 {item.proposedEmailDomain || '—'} · 聯絡 {item.contactName || '—'}
                  {item.contactEmail ? `（${item.contactEmail}）` : ''}
                </p>
                {item.justification ? <p>{item.justification}</p> : null}
                <div className={styles.actions}>
                  <Button disabled={busyId === item.id} onClick={() => void decide(item.id, 'approve')}>
                    核准申請
                  </Button>
                  <Button disabled={busyId === item.id} onClick={() => void decide(item.id, 'reject')}>
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
                    <Button
                      disabled={busyId === school.tenantId}
                      onClick={() => void openSchool(school.tenantId)}
                    >
                      一鍵開通
                    </Button>
                    <Link href={OPS_PATH}>去平台管理綁老師</Link>
                  </div>
                </article>
              ))}
            </section>
          ) : null}
        </div>
      )}
    </SiteShell>
  );
}
