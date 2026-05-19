'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { PWAInstallBanner } from './PWAInstallBanner';
import { OfflineBanner } from './OfflineBanner';
import { UpdateBanner } from './UpdateBanner';
import { DemoRolePill } from './DemoRolePill';
import { useDemoRole } from '@/lib/demoRole';
import { useDemoStore, getUnreadCountDynamic } from '@/lib/demoStore';

const NAV_ICONS: Record<string, string> = {
  '/': '☀️',
  '/groups': '🎓',
  '/community': '✨',
  '/messages': '💬',
  '/map': '🗺️',
  '/announcements': '📥',
  '/profile': '👤',
  '/timetable': '📅',
  '/cafeteria': '🍱',
  '/bus': '🚌',
  '/library': '📚',
  '/search': '🔍',
  '/settings': '⚙',
  '/credit-planner': '📊',
  '/ai-assistant': '🤖',
};

function SiteShellInner(props: {
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [demoRole] = useDemoRole();
  const store = useDemoStore();
  const msgUnread = useMemo(() => getUnreadCountDynamic(demoRole, store), [demoRole, store]);

  const school = searchParams.get('school') || '';
  const schoolId = searchParams.get('schoolId') || '';
  const q = school
    ? `?school=${encodeURIComponent(school)}&schoolId=${encodeURIComponent(schoolId)}`
    : '';

  const isAdminLike = demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'admin' || demoRole === 'department_head';
  // 學生型角色：學生本人 + 在校學生身份的社團幹部（社團幹部本質是學生）
  const isStudentLike = demoRole === 'student' || demoRole === 'club_officer';
  // 在校身份（看課表）：student / teacher / ta / club_officer
  const hasTimetable = demoRole === 'student' || demoRole === 'teacher' || demoRole === 'ta' || demoRole === 'club_officer';
  // 訪客只能看公開資訊（不開 profile / 個人收件匣等）
  const isGuestOnly = demoRole === 'guest';

  const navItems = [
    { href: '/', label: 'Today', group: 'primary' as const },
    { href: '/groups', label: '課程', group: 'primary' as const },
    { href: '/community', label: '社群', group: 'primary' as const },
    // 訊息：訪客頁面內已自行攔截到 login,nav 仍顯示維持引導入口
    { href: '/messages', label: '訊息', group: 'primary' as const },
    // 私訊：1 對 1 對話（與 mobile 端 DmsScreen 對齊；guest/alumni 頁面內擋）
    ...(!isGuestOnly ? [{ href: '/dms', label: '私訊', group: 'secondary' as const }] : []),
    { href: '/map', label: '校園', group: 'primary' as const },
    { href: '/announcements', label: '收件匣', group: 'primary' as const },
    // 我的：訪客沒個人檔案
    ...(!isGuestOnly ? [{ href: '/profile', label: '我的', group: 'primary' as const }] : []),
    // 課表：校友/訪客 / 系主任 / 管理員不在課表上線(系主任/管理員看的是儀表板)
    ...(hasTimetable ? [{ href: '/timetable', label: '課表', group: 'secondary' as const }] : []),
    // 學分試算:僅學生 / 社團幹部(本質是學生)可見;教師、TA、系主任、管理員、校友、訪客全部隱藏
    ...(isStudentLike ? [{ href: '/credit-planner', label: '學分試算', group: 'secondary' as const }] : []),
    // 管理後台入口:僅對管理員 / 系主任顯示
    ...(demoRole === 'admin' || demoRole === 'department_head'
      ? [{ href: '/admin', label: '管理後台', group: 'secondary' as const }]
      : []),
    // LMS 管理(Supabase 技術後台):僅 admin-like 角色可見
    ...(isAdminLike
      ? [{ href: '/lms-admin', label: 'LMS 管理', group: 'secondary' as const }]
      : []),
    { href: '/ai-assistant', label: 'AI 助理', group: 'secondary' as const },
    { href: '/cafeteria', label: '餐廳', group: 'secondary' as const },
    { href: '/bus', label: '公車', group: 'secondary' as const },
    { href: '/library', label: '圖書館', group: 'secondary' as const },
    { href: '/settings', label: '設定', group: 'secondary' as const },
  ];

  const primaryNav = navItems.filter((item) => item.group === 'primary');
  const secondaryNav = navItems.filter((item) => item.group === 'secondary');

  // Mobile bottom tab 也隨角色變(學分鍵僅學生型顯示;教師端把學分位置換成「成績冊」)
  const mobileNav = isStudentLike
    ? [
        { href: '/', label: 'Today', icon: '☀️' },
        { href: '/groups', label: '課程', icon: '🎓' },
        { href: '/credit-planner', label: '學分', icon: '📊' },
        { href: '/ai-assistant', label: 'AI', icon: '🤖' },
        { href: '/profile', label: '我的', icon: '👤' },
      ]
    : isAdminLike
      ? [
          { href: '/', label: 'Today', icon: '☀️' },
          { href: '/groups', label: '課程', icon: '🎓' },
          { href: '/lms-admin', label: 'LMS', icon: '📋' },
          { href: '/ai-assistant', label: 'AI', icon: '🤖' },
          { href: '/profile', label: '我的', icon: '👤' },
        ]
      : [
          { href: '/', label: 'Today', icon: '☀️' },
          { href: '/groups', label: '課程', icon: '🎓' },
          { href: '/announcements', label: '公告', icon: '📥' },
          { href: '/ai-assistant', label: 'AI', icon: '🤖' },
          ...(!isGuestOnly
            ? [{ href: '/profile', label: '我的', icon: '👤' }]
            : [{ href: '/login', label: '登入', icon: '🔑' }]),
        ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      <OfflineBanner />
      <div className="shell">
        <header className="topbar">
          <div className="topbarGlass">
            {/* Top row: brand + actions */}
            <div className="topbarRow">
              <div className="brandCluster">
                <Link href={`/${q}`} className="brandLink">
                  <span className="brandMark">OS</span>
                  <div className="brand">
                    <span className="brandEyebrow">Campus Learning OS</span>
                    <span className="brandTitle">校園學習中樞</span>
                  </div>
                </Link>
                <div className="brandMeta">
                  {props.schoolName ? (
                    <>
                      <span className="pill">{props.schoolName}</span>
                      {props.schoolCode ? (
                        <span className="pill subtle">{props.schoolCode}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="pill subtle">靜宜大學</span>
                  )}
                </div>
              </div>

              <div className="topbarRight" style={{ alignItems: 'center', gap: 10 }}>
                <DemoRolePill />
                <Link href={`/search${q}`} className="iconBtn" title="搜尋">
                  🔍 搜尋
                </Link>
                <Link href={`/settings${q}`} className="iconBtn" title="設定">
                  ⚙ 設定
                </Link>
                <Link href={`/profile${q}`} className="iconBtn" title="個人檔案">
                  👤 個人
                </Link>
              </div>
            </div>

            {/* Nav row */}
            <div className="navClusters">
              <nav className="nav navPrimary" aria-label="主要導覽">
                {primaryNav.map((item) => (
                  <Link
                    key={item.href}
                    href={`${item.href}${q}`}
                    className={`navLink${isActive(item.href) ? ' active' : ''}`}
                    style={{ position: 'relative' }}
                  >
                    <span style={{ marginRight: 4 }}>{NAV_ICONS[item.href]}</span>
                    {item.label}
                    {item.href === '/messages' && msgUnread > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -4,
                          right: -6,
                          minWidth: 16,
                          height: 16,
                          borderRadius: 99,
                          background: '#FF3B30',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 3px',
                          lineHeight: 1,
                        }}
                      >
                        {msgUnread}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>

              <div className="navSecondaryCluster">
                <nav className="nav navSecondary" aria-label="次要導覽">
                  {secondaryNav.map((item) => (
                    <Link
                      key={item.href}
                      href={`${item.href}${q}`}
                      className={`navLink secondary${isActive(item.href) ? ' active' : ''}`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <span className="navCta" aria-label="目前校區">
                  靜宜大學
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="main">
          {props.title ? (
            <div className="pageHead">
              <div className="pageHeadCopy">
                <div className="pageHeadEyebrow">Campus Learning OS</div>
                <h1 className="h1">{props.title}</h1>
                {props.subtitle ? <p className="sub">{props.subtitle}</p> : null}
              </div>
              <div className="pageHeadMeta">
                <span className="pill">{props.schoolName ?? '靜宜大學'}</span>
                <span className="pill subtle">{props.schoolCode ?? 'Campus Soft'}</span>
              </div>
            </div>
          ) : null}

          {props.children}
        </main>

        <footer className="footer">
          <div className="shellActions">
            <span>© 2026 Campus One</span>
            <Link href={`/terms${q}`} className="footerLink">
              服務條款
            </Link>
            <Link href={`/privacy${q}`} className="footerLink">
              隱私政策
            </Link>
            <a href="mailto:contact@pu.edu.tw" className="footerLink">
              聯絡我們
            </a>
          </div>
        </footer>

        {/* Mobile bottom dock */}
        <nav className="mobileDock" aria-label="行動版導覽">
          {mobileNav.map((item) => (
            <Link
              key={item.href}
              href={`${item.href}${q}`}
              className={`mobileDockLink${isActive(item.href) ? ' active' : ''}`}
            >
              <span style={{ fontSize: 20, display: 'block', lineHeight: 1 }}>{item.icon}</span>
              <span style={{ display: 'block', fontSize: 10, marginTop: 2 }}>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      <PWAInstallBanner />
      <UpdateBanner />
    </>
  );
}

export function SiteShell(props: {
  title?: string;
  subtitle?: string;
  schoolName?: string;
  schoolCode?: string;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="shell">
          <header className="topbar">
            <div className="topbarGlass">
              <div className="topbarRow">
                <div className="brandCluster">
                  <div className="brandLink">
                    <span className="brandMark">OS</span>
                    <div className="brand">
                      <span className="brandEyebrow">Campus Learning OS</span>
                      <span className="brandTitle">校園學習中樞</span>
                    </div>
                  </div>
                  <div className="brandMeta">
                    <span className="pill subtle">載入中…</span>
                  </div>
                </div>
              </div>
            </div>
          </header>
          <main className="main">
            <div
              className="card"
              style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}
            >
              載入中…
            </div>
          </main>
        </div>
      }
    >
      <SiteShellInner {...props} />
    </Suspense>
  );
}
