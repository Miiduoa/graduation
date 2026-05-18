'use client';

/**
 * Campus AI-First — AppShell (新版三層導航殼)
 * --------------------------------------------
 * 取代舊 SiteShell。Layer 0: Command Bar(在頁面內)、Layer 1: 三大時空軸 (Today/Hub/Me)、Layer 2: 子內容。
 *
 * 設計規範對應：docs/design/AI_FIRST_REDESIGN.md §2-3
 *
 * 注意：本檔不取代 SiteShell；它與 SiteShell 共存。
 *   - 新頁面（如新版 /today, /hub, /me）使用 AppShell
 *   - 舊頁面（/grades, /lms-admin, /timetable...）繼續用 SiteShell
 *   - 過渡期完成後再下架 SiteShell
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

type ShellTab = {
  href: string;
  label: string;
  icon: string;
  description: string;
};

const PRIMARY_TABS: ShellTab[] = [
  {
    href: '/',
    label: 'Today',
    icon: '☀️',
    description: '今日課表、作業、訊息、AI 主動提醒',
  },
  {
    href: '/hub',
    label: 'Hub',
    icon: '🏛',
    description: '校園地圖、餐廳、圖書館、社團',
  },
  {
    href: '/me',
    label: 'Me',
    icon: '👤',
    description: '成績、學分、個人檔案、隱私',
  },
];

function AppShellInner({
  children,
  rightDrawer,
}: {
  children: ReactNode;
  rightDrawer?: ReactNode;
}) {
  const pathname = usePathname() ?? '/';

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: rightDrawer ? '72px 1fr 380px' : '72px 1fr',
        minHeight: '100vh',
        background: 'var(--bg)',
      }}
    >
      {/* Left Rail — Layer 1 三大時空軸 */}
      <nav
        aria-label="主要導航"
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          padding: '16px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <Link
          href="/"
          aria-label="校園 AI 首頁"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'var(--ai-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 700,
            fontSize: 18,
            marginBottom: 12,
            textDecoration: 'none',
            boxShadow: 'var(--shadow-sm)',
            animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
          }}
        >
          C
        </Link>

        {PRIMARY_TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={`${tab.label} — ${tab.description}`}
              aria-current={active ? 'page' : undefined}
              style={{
                width: 48,
                height: 56,
                borderRadius: 12,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                textDecoration: 'none',
                color: active ? 'var(--ai)' : 'var(--muted)',
                background: active ? 'var(--ai-soft)' : 'transparent',
                transition: 'all 0.18s var(--ai-ease-out)',
              }}
            >
              <span style={{ fontSize: 20 }} aria-hidden>
                {tab.icon}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{tab.label}</span>
            </Link>
          );
        })}

        <div style={{ flex: 1 }} />

        <Link
          href="/settings"
          aria-label="設定"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 20 }} aria-hidden>
            ⚙
          </span>
        </Link>
      </nav>

      {/* Main content */}
      <main style={{ overflow: 'auto', padding: '0 32px 32px' }}>{children}</main>

      {/* Right AI Drawer (optional) */}
      {rightDrawer && (
        <aside
          aria-label="AI 對話面板"
          style={{
            background: 'var(--surface)',
            borderLeft: '1px solid var(--border)',
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {rightDrawer}
        </aside>
      )}

      {/* Mobile bottom dock */}
      <nav
        aria-label="行動版導航"
        className="appShellMobileDock"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 84,
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--border)',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '0 8px 20px',
          zIndex: 100,
        }}
      >
        <Link
          href="/"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            color: isActive('/') ? 'var(--ai)' : 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>☀️</span>
          <span>Today</span>
        </Link>
        <Link
          href="/hub"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            color: isActive('/hub') ? 'var(--ai)' : 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>🏛</span>
          <span>Hub</span>
        </Link>
        <Link
          href="/ai-assistant"
          aria-label="AI 助理（主入口）"
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--ai-gradient)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            marginTop: -28,
            boxShadow: 'var(--shadow-ai)',
            animation: 'aiBreath var(--ai-breath-duration) ease-in-out infinite',
            flexShrink: 0,
            textDecoration: 'none',
          }}
        >
          ✨
        </Link>
        <Link
          href="/me"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            color: isActive('/me') ? 'var(--ai)' : 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>👤</span>
          <span>Me</span>
        </Link>
        <Link
          href="/settings"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            color: isActive('/settings') ? 'var(--ai)' : 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 22 }}>⚙</span>
          <span>More</span>
        </Link>
      </nav>

      <style jsx>{`
        @media (max-width: 768px) {
          :global(.appShellMobileDock) {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}

export function AppShell({
  children,
  rightDrawer,
}: {
  children: ReactNode;
  rightDrawer?: ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)',
          }}
        >
          載入中…
        </div>
      }
    >
      <AppShellInner rightDrawer={rightDrawer}>{children}</AppShellInner>
    </Suspense>
  );
}
