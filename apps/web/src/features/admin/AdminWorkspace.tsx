'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { useNuniSession } from '@/features/nuni/Session';
import {
  defaultAdminLocation,
  readAdminLocation,
  sectionMeta,
  tryParseAdminHash,
  writeAdminLocation,
  type AdminLocation,
  type AdminSection,
  type SchoolLifecycleFilter,
} from './adminNav';
import { AdminAudit } from './AdminAudit';
import { AdminBoards } from './AdminBoards';
import { AdminOverview } from './AdminOverview';
import { AdminReports } from './AdminReports';
import { AdminSchools } from './AdminSchools';
import { AdminHeader } from './AdminHeader';
import { AdminPeople } from './AdminPeople';
import { AdminMerchants } from './AdminMerchants';
import common from '@/app/servicePages.module.css';
import styles from './Admin.module.css';

const navGroups: { label: string; sections: AdminSection[] }[] = [
  { label: '日常營運', sections: ['overview', 'schools', 'people', 'merchants'] },
  { label: '社群與治理', sections: ['boards', 'reports', 'audit'] },
];

export function AdminWorkspace() {
  const auth = useNuniSession();
  return (
    <div
      onClickCapture={(event) => {
        if (
          auth.session?.isPlatformOperator &&
          (event.target as Element).closest?.('a[href="#page-content"]')
        ) {
          event.preventDefault();
          document.getElementById('page-content')?.focus();
        }
      }}
    >
      <SiteShell
        header={<AdminHeader />}
        title={auth.session?.isPlatformOperator ? undefined : '平台管理'}
      >
        {auth.session?.isPlatformOperator ? (
          <Workspace
            key={`${auth.session.platformAccountId}:${auth.session.context}`}
            context={auth.session.context}
            suspended={auth.loading || auth.pendingLogout}
          />
        ) : auth.loading ? (
          <p role="status" className={common.loading}>
            正在確認管理權限…
          </p>
        ) : (
          <section className={`${common.stateCard} ${styles.gateCard}`}>
            <p className={styles.eyebrow}>平台管理員</p>
            <h2>{auth.session ? '沒有管理權限' : '請先登入管理員帳號'}</h2>
            <p>
              {auth.error ||
                (auth.session
                  ? '目前帳號無法查看或修改平台管理資料。這與學校管理員身分不同。'
                  : '登入後會確認你的平台管理權限。')}
            </p>
            <div className={common.actions}>
              <Link className={styles.link} href="/admin/login">
                前往管理員登入
              </Link>
              {auth.error && <Button onClick={() => void auth.refresh()}>重新確認</Button>}
            </div>
          </section>
        )}
      </SiteShell>
    </div>
  );
}

function Workspace({ context, suspended }: { context: string; suspended: boolean }) {
  const [location, setLocation] = useState<AdminLocation>(readAdminLocation);
  const locationRef = useRef(location);
  useLayoutEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const initial = tryParseAdminHash(window.location.hash);
    if (!initial) {
      writeAdminLocation(defaultAdminLocation(), 'replace');
    }
    const sync = () => {
      const parsed = tryParseAdminHash(window.location.hash);
      if (parsed) {
        setLocation(parsed);
        return;
      }
      // Skip-link / content anchors must not wipe the workbench location.
      writeAdminLocation(locationRef.current, 'replace');
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const go = useCallback((patch: Partial<AdminLocation>, mode: 'push' | 'replace' = 'push') => {
    setLocation((previous) => {
      const next: AdminLocation = {
        ...previous,
        ...patch,
        schoolId:
          patch.schoolId !== undefined
            ? patch.schoolId
            : patch.section && patch.section !== 'schools' && patch.section !== 'people'
              ? null
              : previous.schoolId,
        reportId:
          patch.section && patch.section !== 'reports'
            ? null
            : patch.reportId !== undefined
              ? patch.reportId
              : previous.reportId,
        boardsCreate:
          patch.section && patch.section !== 'boards'
            ? false
            : patch.boardsCreate !== undefined
              ? patch.boardsCreate
              : previous.boardsCreate,
      };
      writeAdminLocation(next, mode);
      return next;
    });
  }, []);

  const meta = sectionMeta[location.section];

  return (
    <>
      {suspended && (
        <p role="status" className={common.loading}>
          正在重新確認管理權限…
        </p>
      )}
      {/* Unstyled wrapper: author CSS on .workbench must not override [hidden]. */}
      <div hidden={suspended}>
        <div className={styles.workbench}>
          <aside className={styles.sidebar}>
            <div className={styles.brandBlock}>
              <p className={styles.eyebrow}>管理範圍 · 全部學校</p>
              <p className={styles.muted}>已使用平台管理員帳號登入</p>
            </div>
            <nav className={styles.sideNav} aria-label="管理項目">
              {navGroups.map((group) => (
                <div className={styles.navGroup} key={group.label}>
                  <p className={styles.sideLabel}>{group.label}</p>
                  {group.sections.map((section) => (
                    <button
                      type="button"
                      className={styles.navItem}
                      key={section}
                      aria-current={location.section === section ? 'page' : undefined}
                      onClick={() => go({ section, reportId: null, boardsCreate: false })}
                    >
                      {sectionMeta[section].label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className={styles.sideSecondary}>
              <p className={styles.sideLabel}>延伸作業</p>
              <a className={styles.link} href="/admin/school-review">
                審核學校申請
              </a>
              <p className={styles.muted}>尚未建檔的接入申請在此審核。</p>
              <a className={styles.link} href="/admin/ops">
                人員、店家與課班
              </a>
              <p className={styles.muted}>前往既有管理台，處理身分與所屬學校。</p>
            </div>
          </aside>

          <div className={styles.workspace}>
            <header className={styles.workspaceHeader}>
              <div className={styles.sectionIntro}>
                <p className={styles.eyebrow}>平台工作台 / {meta.label}</p>
                <h1 className={styles.workspaceTitle}>{meta.heading}</h1>
                <p className={styles.muted}>{meta.purpose}</p>
              </div>
              <div className={styles.mobileSecondary}>
                <a className={styles.link} href="/admin/school-review">
                  審核學校申請
                </a>
                <a className={styles.link} href="/admin/ops">
                  人員、店家與課班
                </a>
              </div>
            </header>

            {location.section === 'overview' ? (
              <AdminOverview
                context={context}
                suspended={suspended}
                onNavigate={(section, patch) => go({ section, ...patch })}
              />
            ) : location.section === 'schools' ? (
              <AdminSchools
                context={context}
                suspended={suspended}
                selectedId={location.schoolId}
                search={location.schoolQuery}
                lifecycle={location.schoolLifecycle}
                onSelect={(schoolId) => go({ section: 'schools', schoolId })}
                onPeople={(schoolId) => go({ section: 'people', schoolId })}
                onSearch={(schoolQuery) =>
                  go({ section: 'schools', schoolQuery, schoolId: null }, 'replace')
                }
                onLifecycle={(schoolLifecycle: SchoolLifecycleFilter) =>
                  go({ section: 'schools', schoolLifecycle }, 'replace')
                }
              />
            ) : location.section === 'people' ? (
              <AdminPeople
                context={context}
                suspended={suspended}
                selectedSchool={location.schoolId}
                onSchool={(schoolId) => go({ section: 'people', schoolId })}
                onManageSchool={(schoolId) =>
                  go({ section: 'schools', schoolId, schoolQuery: '', schoolLifecycle: 'all' })
                }
              />
            ) : location.section === 'merchants' ? (
              <AdminMerchants context={context} suspended={suspended} />
            ) : location.section === 'boards' ? (
              <AdminBoards
                context={context}
                suspended={suspended}
                creating={location.boardsCreate}
                onCreating={(boardsCreate) => go({ section: 'boards', boardsCreate })}
              />
            ) : location.section === 'reports' ? (
              <AdminReports
                context={context}
                suspended={suspended}
                selectedId={location.reportId}
                state={location.reportState}
                onSelect={(reportId) => go({ section: 'reports', reportId })}
                onState={(reportState) =>
                  go({ section: 'reports', reportState, reportId: null }, 'replace')
                }
              />
            ) : (
              <AdminAudit
                context={context}
                suspended={suspended}
                query={location.auditQuery}
                onQuery={(auditQuery) => go({ section: 'audit', auditQuery }, 'replace')}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
