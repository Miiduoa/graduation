'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
import { primaryNavigationSection } from '@/lib/primaryNavigation';

type HeaderProps = { onOpenVoice?: () => void };

function closeNavigationPopovers(header: HTMLElement | null, except?: HTMLDetailsElement) {
  header
    ?.querySelectorAll<HTMLDetailsElement>('details[name="campus-navigation-popover"][open]')
    .forEach((element) => {
      if (element !== except) element.open = false;
    });
}

function Header({ onOpenVoice }: HeaderProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const hash = useLocationHash();
  const { user, loading, signOutUser } = useAuth();
  const nuni = useNuniSession();
  const hydrated = useClientHydrated();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const header = useRef<HTMLElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const accountTrigger = useRef<HTMLElement>(null);
  const [accountScope, setAccountScope] = useState<string | null>(null);
  const [quickScope, setQuickScope] = useState<string | null>(null);
  const quickTrigger = useRef<HTMLButtonElement>(null);
  const quickPanel = useRef<HTMLElement>(null);
  const context = useCampusNavigationSearch(params);
  const navigationScope = JSON.stringify([
    pathname,
    params?.toString(),
    hash,
    context,
    user?.uid,
    nuni.session?.platformAccountId,
    nuni.session?.context,
    nuni.pendingLogout,
    Boolean(onOpenVoice),
  ]);
  const quickOpen = quickScope === navigationScope && !onOpenVoice;
  const accountOpen = accountScope === navigationScope;
  if (quickScope !== null && quickScope !== navigationScope) setQuickScope(null);
  if (accountScope !== null && accountScope !== navigationScope) setAccountScope(null);

  const closeQuick = () => {
    setQuickScope(null);
    quickTrigger.current?.focus({ preventScroll: true });
  };
  const closeAccount = () => {
    if (!accountMenu.current?.open) return;
    accountMenu.current.open = false;
    accountTrigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const navigation = header.current;
    function onToggle(event: Event) {
      const element = event.target;
      if (element === accountMenu.current && element instanceof HTMLDetailsElement) {
        setAccountScope(element.open ? navigationScope : null);
      }
      if (
        element instanceof HTMLDetailsElement &&
        element.getAttribute('name') === 'campus-navigation-popover' &&
        element.open
      ) {
        closeNavigationPopovers(navigation, element);
        setQuickScope(null);
      }
    }
    // Native details toggle does not bubble; capture also covers keyboard/programmatic opening.
    navigation?.addEventListener('toggle', onToggle, true);
    return () => navigation?.removeEventListener('toggle', onToggle, true);
  }, [navigationScope]);
  useEffect(() => {
    function dismissOutside(event: PointerEvent | FocusEvent) {
      if (!(event.target instanceof Node)) return;
      if (accountMenu.current?.open && !accountMenu.current.contains(event.target)) {
        accountMenu.current.open = false;
      }
      if (
        quickOpen &&
        !quickPanel.current?.contains(event.target) &&
        !quickTrigger.current?.contains(event.target)
      ) {
        // Keep focus on the destination the person selected outside this nonmodal panel.
        setQuickScope(null);
      }
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [quickOpen]);
  useEffect(() => {
    if (quickOpen) quickPanel.current?.focus({ preventScroll: true });
  }, [quickOpen]);
  useLayoutEffect(() => {
    const navigation = header.current;
    const panel = quickPanel.current;
    if (!navigation) return;
    const updateHeaderInset = () => {
      // A nonmodal panel must leave the other header destinations reachable.
      const bottom = Math.max(0, navigation.getBoundingClientRect().bottom);
      navigation.style.setProperty('--navigation-header-bottom', `${bottom}px`);
      panel?.style.setProperty('--voice-header-bottom', `${bottom}px`);
    };
    updateHeaderInset();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeaderInset);
    observer?.observe(navigation);
    window.addEventListener('resize', updateHeaderInset);
    window.addEventListener('scroll', updateHeaderInset, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeaderInset);
      window.removeEventListener('scroll', updateHeaderInset);
    };
  }, [quickOpen]);
  const activeSection = primaryNavigationSection(pathname);
  const href = (path: string) => campusServiceHref(path, context);
  const currentPage = currentReturnPath(pathname || '/', params?.size ? `?${params}` : '', hash);
  const loginPage = ['/login', '/classroom/login', '/admin/login'].includes(pathname || '');
  const checking = !hydrated || loading || nuni.loading;
  return (
    <>
      <header ref={header} className={headerStyles.header} data-campus-navigation="true">
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
            aria-controls={onOpenVoice ? 'today-voice-entry' : `${id}-voice`}
            aria-expanded={onOpenVoice ? undefined : quickOpen}
            onClick={() => {
              closeNavigationPopovers(header.current);
              if (onOpenVoice) {
                setQuickScope(null);
                onOpenVoice();
              } else {
                setQuickScope(quickOpen ? null : navigationScope);
              }
            }}
          >
            <CampusIcon name="microphone" size={18} />
            <span>語音 AI</span>
          </button>
          <Link
            href={href('/search')}
            className={headerStyles.quickSearch}
            aria-label="搜尋服務與語音輸入"
            title="搜尋服務與語音輸入"
          >
            <CampusIcon name="search" size={17} />
            <span>搜尋</span>
          </Link>
          {user || nuni.session || nuni.pendingLogout ? (
            <details
              ref={accountMenu}
              key={navigationScope}
              name="campus-navigation-popover"
              className={headerStyles.accountMenu}
              onKeyDown={(event) => {
                if (
                  event.key === 'Escape' &&
                  !event.nativeEvent.isComposing &&
                  event.currentTarget.open
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeAccount();
                }
              }}
            >
              <summary
                ref={accountTrigger}
                aria-controls={`${id}-account`}
                aria-label={nuni.pendingLogout || error ? '帳號，登出尚未完成' : '帳號'}
              >
                <CampusIcon name="profile" size={17} />
                <span>帳號</span>
                {(nuni.pendingLogout || error) && (
                  <span className={headerStyles.retryIndicator} aria-hidden />
                )}
              </summary>
              <div
                className={headerStyles.accountPanel}
                id={`${id}-account`}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest('a')) {
                    if (accountMenu.current) accountMenu.current.open = false;
                  }
                }}
              >
                <div className={headerStyles.accountHeading}>
                  <span>帳號</span>
                  <button type="button" onClick={closeAccount} aria-label="關閉帳號選單">
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
                {checking && (
                  <p role="status" className={headerStyles.accountStatus}>
                    確認帳號中…
                  </p>
                )}
                {!checking && (user || nuni.session) && (
                  <Link href="/profile">
                    <CampusIcon name="profile" size={18} />
                    我的帳號
                    <CampusIcon name="arrow" size={16} />
                  </Link>
                )}
                {!checking && nuni.session?.isPlatformOperator && (
                  <Link href="/admin">
                    <CampusIcon name="services" size={18} />
                    平台管理
                    <CampusIcon name="arrow" size={16} />
                  </Link>
                )}
                <button
                  type="button"
                  className={headerStyles.logout}
                  disabled={busy || checking}
                  aria-describedby={error ? `${id}-error` : undefined}
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
                {error && accountOpen && (
                  <p id={`${id}-error`} role="alert" className={headerStyles.accountError}>
                    {error}
                  </p>
                )}
              </div>
            </details>
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
          <Link href={href('/')} aria-current={activeSection === 'today' ? 'page' : undefined}>
            <CampusIcon name="calendar" size={17} />
            今天
          </Link>
          <Link
            href={href('/timetable')}
            aria-current={activeSection === 'study' ? 'page' : undefined}
            title="課務：課表、課程與作業、成績"
          >
            <CampusIcon name="library" size={17} />
            課務
          </Link>
          <Link href={href('/life')} aria-current={activeSection === 'life' ? 'page' : undefined}>
            <CampusIcon name="map" size={17} />
            生活
          </Link>
          <Link
            href={user || nuni.session ? '/profile' : '/login?returnUrl=%2Fprofile'}
            aria-current={activeSection === 'me' ? 'page' : undefined}
          >
            <CampusIcon name="profile" size={17} />我
          </Link>
          <CampusServiceMenu />
        </nav>
      </header>
      {quickOpen && (
        <section
          id={`${id}-voice`}
          ref={quickPanel}
          role="dialog"
          aria-label="校園語音與 AI 快速操作"
          tabIndex={-1}
          className={headerStyles.voicePanel}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.nativeEvent.isComposing &&
              !event.defaultPrevented
            ) {
              event.preventDefault();
              event.stopPropagation();
              closeQuick();
            }
          }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a')) {
              setQuickScope(null);
            }
          }}
        >
          <div className={headerStyles.voicePanelHeading}>
            <span>校園助理</span>
            <button type="button" onClick={closeQuick} aria-label="關閉校園語音 AI">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <QuickCampusEntry />
        </section>
      )}
      {error && !accountOpen && (
        <p id={`${id}-error`} role="alert" className={headerStyles.error}>
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
        <header className={headerStyles.header} data-campus-navigation="true" aria-busy="true">
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
