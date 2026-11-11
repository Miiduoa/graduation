'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { AdminAudit } from '@/features/admin/AdminAudit';
import { AdminHeader } from '@/features/admin/AdminHeader';
import { AdminPeopleManagement } from '@/features/admin/AdminPeopleManagement';
import { AdminMerchantReview } from '@/features/admin/AdminMerchantReview';
import { AdminAffiliationReview } from '@/features/admin/AdminAffiliationReview';
import { AdminSchools } from '@/features/admin/AdminSchools';
import type { SchoolLifecycleFilter } from '@/features/admin/adminNav';
import { useNuniSession } from '@/features/nuni/Session';
import common from '@/app/servicePages.module.css';
import admin from '@/features/admin/Admin.module.css';
import {
  adminLoginHref,
  currentPageReturnPath,
  OPS_PATH,
  readOpsTab,
  readOpsSchool,
  SCHOOL_REVIEW_PATH,
  type OpsTab,
} from './constants';
import styles from './Platform.module.css';

const tabs: Array<[OpsTab, string]> = [
  ['schools', '學校'],
  ['people', '人員'],
  ['merchants', '店家'],
  ['affiliation', '課班掛靠'],
  ['audit', '紀錄'],
];

function readTab(): OpsTab {
  if (typeof window === 'undefined') return 'schools';
  return readOpsTab(window.location.search, window.location.hash);
}

function readSchool(): string | null {
  return typeof window === 'undefined' ? null : readOpsSchool(window.location.search);
}

export function OpsConsole() {
  const auth = useNuniSession();
  const operator = !!auth.session?.isPlatformOperator;
  const suspended = auth.loading || auth.pendingLogout;
  const sessionKey = `${auth.session?.platformAccountId}:${auth.session?.context}`;
  const [tab, setTab] = useState<OpsTab>('schools');
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolLifecycle, setSchoolLifecycle] = useState<SchoolLifecycleFilter>('all');
  const [auditQuery, setAuditQuery] = useState('');

  useEffect(() => {
    const sync = () => {
      setTab(readTab());
      setSchoolId(readSchool());
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  function go(next: OpsTab) {
    if (next === tab) return;
    setTab(next);
    const params = new URLSearchParams({ tab: next });
    if (schoolId) params.set('school', schoolId);
    window.history.pushState(null, '', OPS_PATH + '?' + params.toString());
  }

  function selectSchool(next: string | null) {
    setSchoolId(next);
    const params = new URLSearchParams({ tab });
    if (next) params.set('school', next);
    window.history.replaceState(null, '', OPS_PATH + '?' + params.toString());
  }

  return (
    <SiteShell header={<AdminHeader />} title={operator ? undefined : '平台管理'}>
      {operator ? (
        <div className={styles.page}>
          <header className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>平台營運</p>
              <h1>完整管理台</h1>
              <p className={styles.muted}>
                從接入審核、校方授權到店家與課班申請，集中完成營運作業。已開通學校需先取得限時代操作權限，審核通過也不代表正式開放服務。
              </p>
            </div>
            <nav className={styles.links} aria-label="營運作業">
              <Link href="/admin">管理總覽</Link>
              <Link href={SCHOOL_REVIEW_PATH}>接入審核</Link>
              <Link href={OPS_PATH} aria-current="page">營運作業</Link>
            </nav>
          </header>
          <div className={styles.tabs} role="tablist" aria-label="營運管理項目">
            {tabs.map(([id, label], index) => (
              <button
                key={id}
                id={'ops-tab-' + id}
                type="button"
                role="tab"
                tabIndex={tab === id ? 0 : -1}
                aria-controls="ops-panel"
                aria-selected={tab === id}
                onClick={() => go(id)}
                onKeyDown={(event) => {
                  let nextIndex = index;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    nextIndex = (index + 1) % tabs.length;
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    nextIndex = (index - 1 + tabs.length) % tabs.length;
                  } else if (event.key === 'Home') {
                    nextIndex = 0;
                  } else if (event.key === 'End') {
                    nextIndex = tabs.length - 1;
                  } else {
                    return;
                  }
                  event.preventDefault();
                  const next = tabs[nextIndex]?.[0];
                  if (!next) return;
                  go(next);
                  document.getElementById('ops-tab-' + next)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className={styles.tabPanel}
            id="ops-panel"
            role="tabpanel"
            aria-labelledby={'ops-tab-' + tab}
            tabIndex={0}
          >
          {tab === 'schools' ? (
            <AdminSchools
              context={auth.session!.context}
              suspended={suspended}
              selectedId={schoolId}
              search={schoolQuery}
              lifecycle={schoolLifecycle}
              onSelect={selectSchool}
              onSearch={setSchoolQuery}
              onLifecycle={setSchoolLifecycle}
            />
          ) : null}
          {tab === 'people' ? (
            <AdminPeopleManagement
              key={sessionKey}
              context={auth.session!.context}
              suspended={suspended}
              selectedSchool={schoolId}
              onSchool={selectSchool}
              onManageSchool={() => go('schools')}
            />
          ) : null}
          {tab === 'merchants' ? (
            suspended ? (
              <p role="status">正在確認管理權限…</p>
            ) : (
              <AdminMerchantReview key={sessionKey} context={auth.session!.context} suspended={suspended} />
            )
          ) : null}
          {tab === 'affiliation' ? (
            suspended ? (
              <p role="status">正在確認管理權限…</p>
            ) : (
              <AdminAffiliationReview key={sessionKey} context={auth.session!.context} suspended={suspended} />
            )
          ) : null}
          {tab === 'audit' ? (
            <AdminAudit
              context={auth.session!.context}
              suspended={suspended}
              query={auditQuery}
              onQuery={setAuditQuery}
            />
          ) : null}
          </div>
        </div>
      ) : auth.loading ? (
        <p role="status" className={common.loading}>
          正在確認管理權限…
        </p>
      ) : (
        <section className={`${common.stateCard} ${admin.gateCard}`}>
          <p className={admin.eyebrow}>平台管理員</p>
          <h2>{auth.session ? '沒有管理權限' : '請先登入管理員帳號'}</h2>
          <p>
            {auth.error ||
              (auth.session
                ? '目前帳號無法查看或修改平台管理資料。這與學校管理員身分不同。'
                : '登入後會確認你的平台管理權限。')}
          </p>
          <div className={common.actions}>
            <Link className={admin.link} href={adminLoginHref(currentPageReturnPath(OPS_PATH))}>
              前往管理員登入
            </Link>
            {auth.error ? <Button onClick={() => void auth.refresh()}>重新確認</Button> : null}
          </div>
        </section>
      )}
    </SiteShell>
  );
}
