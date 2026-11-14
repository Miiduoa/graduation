'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthGuard';
import { CampusServiceMenu } from './CampusServiceMenu';
import { CampusIcon } from './CampusIcon';
import { QuickCampusEntry } from './QuickCampusEntry';
import { SchoolSelector } from './SchoolSelector';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { useLocationHash } from '@/lib/useLocationHash';
import headerStyles from './AppHeader.module.css';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { LoginLink } from './LoginLink';
import { currentReturnPath } from '@/lib/navigation';
import { PRIMARY_DESTINATIONS, primaryNavigationSection } from '@/lib/primaryNavigation';

type HeaderProps = { onOpenVoice?: () => void };

function Header({ onOpenVoice }: HeaderProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const hash = useLocationHash();
  const { user, loading, signOutUser } = useAuth();
  const nuni = useNuniSession();
  const hydrated = useClientHydrated();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const quickTrigger = useRef<HTMLButtonElement>(null);
  const quickPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (quickOpen) quickPanel.current?.focus();
  }, [quickOpen]);
  const closeQuick = () => {
    setQuickOpen(false);
    quickTrigger.current?.focus();
  };
  const context = useCampusNavigationSearch(params);
  const activeSection = primaryNavigationSection(pathname);
  const href = (path: string) => campusServiceHref(path, context);
  const currentPage = currentReturnPath(pathname || '/', params?.size ? `?${params}` : '', hash);
  const loginPage = ['/login', '/classroom/login', '/admin/login'].includes(pathname || '');
  const checking = !hydrated || loading || nuni.loading;
  return (
    <>
      <header className={headerStyles.header} data-campus-navigation="true">
        <Link href={href('/')} className={headerStyles.brand} aria-label="nuni">
          <span className={headerStyles.mark} aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/mark.svg" alt="" width={28} height={28} />
          </span>
          <span className={headerStyles.wordmark}>nuni</span>
        </Link>
        <div className={headerStyles.campus}>
          {pathname !== '/bus' && !pathname?.startsWith('/bus/') ? (
            <SchoolSelector compact variant="name" />
          ) : null}
        </div>
        <div className={headerStyles.account}>
          <button
            ref={quickTrigger}
            type="button"
            className={headerStyles.voiceTrigger}
            aria-label="開啟校園語音 AI"
            aria-controls={onOpenVoice ? 'today-voice-entry' : 'campus-voice-quick-panel'}
            aria-expanded={onOpenVoice ? undefined : quickOpen}
            onClick={onOpenVoice ?? (() => setQuickOpen((opened) => !opened))}
          >
            <CampusIcon name="microphone" size={18} />
            <span>助理</span>
          </button>
          <CampusServiceMenu />
          {!checking && nuni.session?.isPlatformOperator && (
            <Link className={headerStyles.operatorLink} href="/admin">
              平台管理
            </Link>
          )}
          {user || nuni.session || nuni.pendingLogout ? (
            <button
              type="button"
              disabled={busy || checking}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError('');
                try {
                  await Promise.all([
                    ...(user ? [signOutUser()] : []),
                    ...(nuni.session || nuni.pendingLogout ? [nuni.logout()] : []),
                  ]);
                } catch {
                  setError('登出失敗，請稍後重試。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '登出中…' : nuni.pendingLogout ? '重試登出' : '登出'}
            </button>
          ) : checking ? (
            <span role="status">確認帳號中…</span>
          ) : !loginPage ? (
            <LoginLink
              className={headerStyles.login}
              returnPath={currentPage}
              liveReturnPath={() =>
                currentReturnPath(
                  window.location.pathname,
                  window.location.search,
                  window.location.hash,
                )
              }
            >
              登入
            </LoginLink>
          ) : null}
        </div>
        <nav aria-label="主要導覽" className={headerStyles.nav}>
          {PRIMARY_DESTINATIONS.map((destination) => (
            <Link
              key={destination.id}
              href={href(destination.href)}
              aria-current={activeSection === destination.id ? 'page' : undefined}
              title={destination.id === 'study' ? '課務：課表、課程與作業、成績' : undefined}
            >
              <CampusIcon name={destination.icon} size={17} />
              {destination.label}
            </Link>
          ))}
        </nav>
      </header>
      {quickOpen && (
        <section
          id="campus-voice-quick-panel"
          ref={quickPanel}
          role="dialog"
          aria-label="校園語音與 AI 快速操作"
          tabIndex={-1}
          className={headerStyles.voicePanel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeQuick();
            }
          }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a')) {
              setQuickOpen(false);
            }
          }}
        >
          <div className={headerStyles.voicePanelHeading}>
            <span>校園快速操作</span>
            <button type="button" onClick={closeQuick} aria-label="關閉校園語音 AI">
              關閉
            </button>
          </div>
          <QuickCampusEntry />
        </section>
      )}
      {error && (
        <p role="alert" className={headerStyles.error}>
          {error}
        </p>
      )}
    </>
  );
}
export function AppHeader(props: HeaderProps) {
  return (
    <Suspense
      fallback={
        <header className={headerStyles.header} data-campus-navigation="true">
          <Link href="/" className={headerStyles.brand} aria-label="nuni">
            <span className={headerStyles.mark} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/mark.svg" alt="" width={28} height={28} />
            </span>
            <span className={headerStyles.wordmark}>nuni</span>
          </Link>
        </header>
      }
    >
      <Header {...props} />
    </Suspense>
  );
}
