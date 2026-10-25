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

const navGroups: Array<{ label: string; sections: AdminSection[] }> = [
  { label: '工作概況', sections: ['overview'] },
  { label: '校園與授權', sections: ['schools', 'people', 'merchants'] },
  { label: '社群與安全', sections: ['boards', 'reports'] },
  { label: '紀錄', sections: ['audit'] },
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
  const draftRef = useRef<{ tenantId: string | null; dirty: boolean }>({
    tenantId: null,
    dirty: false,
  });
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
        if (
          draftRef.current.dirty &&
          locationRef.current.section === 'schools' &&
          (parsed.section !== 'schools' || parsed.schoolId !== locationRef.current.schoolId)
        ) {
          if (!window.confirm('這所學校有尚未儲存的資料。確定要離開並捨棄變更嗎？')) {
            writeAdminLocation(locationRef.current, 'replace');
            return;
          }
          draftRef.current = { tenantId: null, dirty: false };
        }
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

  useEffect(() => {
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      if (!draftRef.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, []);

  const go = useCallback((patch: Partial<AdminLocation>, mode: 'push' | 'replace' = 'push') => {
    const previousLocation = locationRef.current;
    if (
      draftRef.current.dirty &&
      previousLocation.section === 'schools' &&
      ((patch.section !== undefined && patch.section !== 'schools') ||
        (patch.schoolId !== undefined && patch.schoolId !== previousLocation.schoolId))
    ) {
      if (!window.confirm('這所學校有尚未儲存的資料。確定要離開並捨棄變更嗎？'))
        return;
      draftRef.current = { tenantId: null, dirty: false };
    }
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
            <nav className={styles.sideNav} aria-label="平台管理項目">
              {navGroups.map((group) => (
                <div className={styles.navGroup} key={group.label}>
                  <p className={styles.navGroupLabel}>{group.label}</p>
                  {group.sections.map((section) => (
                    <button
                      type="button"
                      className={styles.navItem}
                      key={section}
                      aria-pressed={location.section === section}
                      aria-current={location.section === section ? 'page' : undefined}
                      onClick={() => {
                        const keepSchool =
                          (section === 'schools' || section === 'people') &&
                          (location.section === 'schools' || location.section === 'people');
                        go({
                          section,
                          schoolId: keepSchool ? location.schoolId : null,
                          reportId: null,
                          boardsCreate: false,
                        });
                      }}
                    >
                      {sectionMeta[section].label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className={styles.sideSecondary}>
              <p className={styles.sideLabel}>延伸作業</p>
              <a className={styles.link} href="/admin/school-review">接入申請審核</a>
              <a className={styles.link} href="/admin/ops?tab=people">校方成員作業</a>
              <a className={styles.link} href="/admin/ops?tab=merchants">店家審核作業</a>
              <a className={styles.link} href="/admin/ops?tab=affiliation">課班掛靠審核</a>
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
                <a className={styles.link} href="/admin/school-review">接入審核</a>
                <a className={styles.link} href="/admin/ops?tab=people">校方成員</a>
                <a className={styles.link} href="/admin/ops?tab=merchants">店家審核</a>
                <a className={styles.link} href="/admin/ops?tab=affiliation">課班掛靠</a>
              </div>
              {(location.section === 'schools' || location.section === 'people') &&
              location.schoolId ? (
                <div className={styles.scopeStrip}>
                  <span>目前學校代號：<strong>{location.schoolId}</strong></span>
                  <div className={styles.scopeActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() =>
                        go({
                          section: location.section === 'schools' ? 'people' : 'schools',
                          schoolId: location.schoolId,
                        })
                      }
                    >
                      {location.section === 'schools' ? '查看校方授權' : '查看學校設定'}
                    </button>
                    <Link
                      className={styles.link}
                      href={'/admin/ops?tab=people&school=' + encodeURIComponent(location.schoolId)}
                    >
                      校方授權作業
                    </Link>
                  </div>
                </div>
              ) : null}
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
                onDraftChange={(tenantId, dirty) => {
                  draftRef.current = { tenantId, dirty };
                }}
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
