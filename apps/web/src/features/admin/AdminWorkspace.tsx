'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { useNuniSession } from '@/features/nuni/Session';
import { SchoolReviewContent } from '@/features/platform/SchoolReview';
import { adminLoginHref, currentPageReturnPath } from '@/features/platform/constants';
import {
  readAdminLocation,
  sectionMeta,
  tryParseAdminHash,
  writeAdminLocation,
  type AdminLocation,
  type AdminSection,
  type SchoolLifecycleFilter,
} from './adminNav';
import { AdminAnnouncements } from './AdminAnnouncements';
import { AdminAudit } from './AdminAudit';
import { AdminBoards } from './AdminBoards';
import { AdminOverview } from './AdminOverview';
import { AdminReports } from './AdminReports';
import { AdminSchools } from './AdminSchools';
import { AdminHeader } from './AdminHeader';
import { AdminPeopleManagement } from './AdminPeopleManagement';
import { AdminMerchantReview } from './AdminMerchantReview';
import { AdminAffiliationReview } from './AdminAffiliationReview';
import common from '@/app/servicePages.module.css';
import styles from './Admin.module.css';

const navGroups: Array<{ label: string; sections: AdminSection[] }> = [
  { label: '每日工作', sections: ['overview'] },
  {
    label: '校園營運',
    sections: ['school-review', 'schools', 'people', 'merchants', 'affiliation'],
  },
  { label: '內容與追蹤', sections: ['reports', 'boards', 'audit'] },
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
              <Link className={styles.link} href={adminLoginHref(currentPageReturnPath('/admin'))}>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(location.section);
  const locationRef = useRef(location);
  const draftRef = useRef<{ tenantId: string | null; dirty: boolean }>({
    tenantId: null,
    dirty: false,
  });
  useLayoutEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    writeAdminLocation(locationRef.current, 'replace');
    const sync = () => {
      const parsed =
        window.location.pathname !== '/admin'
          ? readAdminLocation()
          : tryParseAdminHash(window.location.hash);
      if (parsed) {
        if (
          draftRef.current.dirty &&
          (parsed.section !== locationRef.current.section ||
            parsed.schoolId !== locationRef.current.schoolId ||
            parsed.reviewId !== locationRef.current.reviewId ||
            parsed.reportId !== locationRef.current.reportId ||
            parsed.boardsCreate !== locationRef.current.boardsCreate)
        ) {
          if (!window.confirm('目前有尚未儲存或送出的內容。確定要離開並捨棄變更嗎？')) {
            writeAdminLocation(locationRef.current, 'replace');
            return;
          }
          draftRef.current = { tenantId: null, dirty: false };
        }
        locationRef.current = parsed;
        setLocation(parsed);
        setMenuOpen(false);
        writeAdminLocation(parsed, 'replace');
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
    if (previousSection.current !== location.section) {
      previousSection.current = location.section;
      headingRef.current?.focus();
    }
  }, [location.section]);

  useEffect(() => {
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      if (!draftRef.current.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const guardLink = (event: MouseEvent) => {
      if (
        !draftRef.current.dirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self') ||
        anchor.getAttribute('href') === '#page-content' ||
        anchor.href === window.location.href
      )
        return;
      if (!window.confirm('目前有尚未儲存或送出的內容。確定要離開並捨棄變更嗎？')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        draftRef.current = { tenantId: null, dirty: false };
      }
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', preventAccidentalExit);
      document.removeEventListener('click', guardLink, true);
    };
  }, []);

  const go = useCallback((patch: Partial<AdminLocation>, mode: 'push' | 'replace' = 'push') => {
    const previousLocation = locationRef.current;
    if (
      draftRef.current.dirty &&
      ((patch.section !== undefined && patch.section !== previousLocation.section) ||
        (patch.schoolId !== undefined && patch.schoolId !== previousLocation.schoolId) ||
        (patch.reviewId !== undefined && patch.reviewId !== previousLocation.reviewId) ||
        (patch.reportId !== undefined && patch.reportId !== previousLocation.reportId) ||
        (patch.boardsCreate !== undefined && patch.boardsCreate !== previousLocation.boardsCreate))
    ) {
      if (!window.confirm('目前有尚未儲存或送出的內容。確定要離開並捨棄變更嗎？')) return false;
      draftRef.current = { tenantId: null, dirty: false };
    }
    const previous = previousLocation;
    const next: AdminLocation = {
      ...previous,
      ...patch,
      schoolId:
        patch.schoolId !== undefined
          ? patch.schoolId
          : patch.section &&
              patch.section !== 'schools' &&
              patch.section !== 'people' &&
              patch.section !== 'announcements'
            ? null
            : previous.schoolId,
      reportId:
        patch.section && patch.section !== 'reports'
          ? null
          : patch.reportId !== undefined
            ? patch.reportId
            : previous.reportId,
      reviewId:
        patch.section && patch.section !== previous.section
          ? (patch.reviewId ?? null)
          : patch.reviewId !== undefined
            ? patch.reviewId
            : previous.reviewId,
      boardsCreate:
        patch.section && patch.section !== 'boards'
          ? false
          : patch.boardsCreate !== undefined
            ? patch.boardsCreate
            : previous.boardsCreate,
    };
    locationRef.current = next;
    setLocation(next);
    writeAdminLocation(next, mode);
    setMenuOpen(false);
    return true;
  }, []);

  const onContentDraftChange = useCallback((dirty: boolean) => {
    draftRef.current = { tenantId: null, dirty };
  }, []);
  const onSchoolDraftChange = useCallback((tenantId: string, dirty: boolean) => {
    draftRef.current = { tenantId, dirty };
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
              <p className={styles.sidebarTitle}>平台營運</p>
              <p className={styles.muted}>已使用平台管理員帳號登入</p>
            </div>
            <button
              type="button"
              className={styles.mobileMenuToggle}
              aria-expanded={menuOpen}
              aria-controls="admin-navigation"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span>管理選單</span>
              <span>
                {meta.label} <span aria-hidden="true">{menuOpen ? '−' : '+'}</span>
              </span>
            </button>
            <nav
              id="admin-navigation"
              className={`${styles.sideNav} ${menuOpen ? styles.menuOpen : ''}`}
              aria-label="平台管理項目"
            >
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
                          (section === 'schools' ||
                            section === 'people' ||
                            section === 'announcements') &&
                          (location.section === 'schools' ||
                            location.section === 'people' ||
                            location.section === 'announcements');
                        go({
                          section,
                          schoolId: keepSchool ? location.schoolId : null,
                          reportId: null,
                          reviewId: null,
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
              <p className={styles.sideLabel}>校方工作區</p>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => go({ section: 'announcements' })}
              >
                校園公告
              </button>
              <p className={styles.scopeHint}>需使用該校已授權的校方帳號</p>
            </div>
          </aside>

          <div className={styles.workspace}>
            <header className={styles.workspaceHeader}>
              <div className={styles.sectionIntro}>
                <div className={styles.breadcrumb}>
                  <span className={styles.eyebrow}>平台管理 / {meta.label}</span>
                  {location.section !== 'overview' && (
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => go({ section: 'overview' })}
                    >
                      回工作總覽
                    </button>
                  )}
                </div>
                <h1 ref={headingRef} tabIndex={-1} className={styles.workspaceTitle}>
                  {meta.heading}
                </h1>
                <p className={styles.muted}>{meta.purpose}</p>
              </div>
              <div className={styles.mobileSecondary}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => go({ section: 'announcements' })}
                >
                  校方公告工作區
                </button>
              </div>
              {(location.section === 'schools' ||
                location.section === 'people' ||
                location.section === 'announcements') &&
              location.schoolId ? (
                <div className={styles.scopeStrip}>
                  <span>工作範圍：目前選取的學校</span>
                  <div className={styles.scopeActions}>
                    {location.section === 'announcements' ? (
                      <Link
                        className={styles.link}
                        href={
                          '/admin/announcements?schoolId=' +
                          encodeURIComponent(location.schoolId) +
                          '&campus=' +
                          encodeURIComponent(location.schoolId)
                        }
                      >
                        開啟公告編輯
                      </Link>
                    ) : (
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
                    )}
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
            ) : location.section === 'school-review' ? (
              !suspended && (
                <SchoolReviewContent
                  context={context}
                  embedded
                  onDraftChange={onContentDraftChange}
                  selectedId={location.reviewId}
                  onSelect={(reviewId) => go({ section: 'school-review', reviewId })}
                  onManagePeople={(schoolId) => go({ section: 'people', schoolId })}
                  onManageSchool={(schoolId) =>
                    go({ section: 'schools', schoolId, schoolQuery: '', schoolLifecycle: 'all' })
                  }
                />
              )
            ) : location.section === 'schools' ? (
              <AdminSchools
                context={context}
                suspended={suspended}
                selectedId={location.schoolId}
                search={location.schoolQuery}
                lifecycle={location.schoolLifecycle}
                onSelect={(schoolId) => go({ section: 'schools', schoolId })}
                onPeople={(schoolId) => go({ section: 'people', schoolId })}
                onAudit={(auditQuery) => go({ section: 'audit', auditQuery })}
                onDraftChange={onSchoolDraftChange}
                onSearch={(schoolQuery) =>
                  go({ section: 'schools', schoolQuery, schoolId: null }, 'replace')
                }
                onLifecycle={(schoolLifecycle: SchoolLifecycleFilter) =>
                  go({ section: 'schools', schoolLifecycle }, 'replace')
                }
              />
            ) : location.section === 'people' ? (
              <AdminPeopleManagement
                context={context}
                suspended={suspended}
                selectedSchool={location.schoolId}
                onDraftChange={onContentDraftChange}
                onSchool={(schoolId) => go({ section: 'people', schoolId })}
                onManageSchool={(schoolId) =>
                  go({ section: 'schools', schoolId, schoolQuery: '', schoolLifecycle: 'all' })
                }
              />
            ) : location.section === 'announcements' ? (
              <AdminAnnouncements schoolId={location.schoolId} />
            ) : location.section === 'merchants' ? (
              !suspended && (
                <AdminMerchantReview
                  context={context}
                  suspended={suspended}
                  onDraftChange={onContentDraftChange}
                  selectedId={location.reviewId}
                  onSelect={(reviewId) => go({ section: 'merchants', reviewId })}
                />
              )
            ) : location.section === 'affiliation' ? (
              !suspended && (
                <AdminAffiliationReview
                  context={context}
                  suspended={suspended}
                  onDraftChange={onContentDraftChange}
                  selectedId={location.reviewId}
                  onSelect={(reviewId) => go({ section: 'affiliation', reviewId })}
                />
              )
            ) : location.section === 'boards' ? (
              <AdminBoards
                context={context}
                suspended={suspended}
                creating={location.boardsCreate}
                onDraftChange={onContentDraftChange}
                onCreating={(boardsCreate) => go({ section: 'boards', boardsCreate })}
              />
            ) : location.section === 'reports' ? (
              <AdminReports
                context={context}
                suspended={suspended}
                selectedId={location.reportId}
                state={location.reportState}
                onDraftChange={onContentDraftChange}
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
