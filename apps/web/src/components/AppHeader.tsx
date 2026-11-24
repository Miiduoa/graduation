'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthGuard';
import { CampusServiceMenu } from './CampusServiceMenu';
import { CampusIcon } from './CampusIcon';
import { SchoolSelector } from './SchoolSelector';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { useLocationHash } from '@/lib/useLocationHash';
import headerStyles from './AppHeader.module.css';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import { LoginLink } from './LoginLink';
import { currentReturnPath } from '@/lib/navigation';
import { PRIMARY_DESTINATIONS, primaryNavigationSection } from '@/lib/primaryNavigation';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { isCurrentTabNavigationClick } from '@/lib/currentTabNavigation';
import { observeMobileNavigationInset } from '@/lib/mobileNavigationInset';

const CampusAssistantEntry = lazy(async () => ({
  default: (await import('./TodayCampusEntry')).TodayCampusEntry,
}));

function closeNavigationPopovers(header: HTMLElement | null, except?: HTMLDetailsElement) {
  header
    ?.querySelectorAll<HTMLDetailsElement>('details[name="campus-navigation-popover"][open]')
    .forEach((element) => {
      if (element !== except) element.open = false;
    });
}

type HeaderProps = { onOpenAssistant?: () => void; assistantExpanded?: boolean };
type AssistantPanelState = {
  scope: string;
  /** undefined waits for the first campus; null is a confirmed all-campus selection. */
  campusId: string | null | undefined;
  open: boolean;
  focusRequest: number;
};

function Header({ onOpenAssistant, assistantExpanded }: HeaderProps) {
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
  const primaryNavigation = useRef<HTMLElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const accountTrigger = useRef<HTMLElement>(null);
  const [accountScope, setAccountScope] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<AssistantPanelState | null>(null);
  const quickTrigger = useRef<HTMLButtonElement>(null);
  const quickPanel = useRef<HTMLElement>(null);
  const context = useCampusNavigationSearch(params);
  const campus = useCampusBrowseContext();
  const campusId = campus.status === 'loading' ? undefined : campus.schoolId;
  const scope = JSON.stringify([
    pathname,
    params?.toString(),
    hash,
    user?.uid,
    nuni.session?.context,
    nuni.session?.platformAccountId,
    nuni.pendingLogout,
    Boolean(nuni.error),
  ]);
  const panel =
    assistant?.scope === scope &&
    (assistant.campusId === undefined || assistant.campusId === campusId)
      ? assistant
      : null;
  const assistantOpen = panel?.open === true;
  if (assistant && !panel) setAssistant(null);
  else if (panel && panel.campusId === undefined && campusId !== undefined) {
    // Resolve the initial opening once without remounting its focus observer.
    // A later campus, account or page change must still discard the whole panel.
    setAssistant({ ...panel, campusId });
  }
  const navigationScope = JSON.stringify([scope, hash, context, Boolean(onOpenAssistant)]);
  const accountOpen = accountScope === navigationScope;
  if (accountScope !== null && accountScope !== navigationScope) setAccountScope(null);
  const closeAccount = () => {
    if (!accountMenu.current?.open) return;
    accountMenu.current.open = false;
    accountTrigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (assistantOpen) quickPanel.current?.focus({ preventScroll: true });
  }, [assistantOpen]);
  useLayoutEffect(() => {
    const navigation = primaryNavigation.current;
    if (navigation) return observeMobileNavigationInset(navigation);
  }, []);
  const hideAssistant = useCallback(() => {
    quickPanel.current
      ?.querySelectorAll<HTMLButtonElement>(
        '[data-voice-input][aria-pressed="true"], [data-voice-playback][aria-pressed="true"]',
      )
      .forEach((button) => button.click());
    setAssistant((current) => (current ? { ...current, open: false } : null));
  }, []);
  const closeAssistant = () => {
    hideAssistant();
    if (window.location.hash === '#campus-assistant-entry') {
      try {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch {
        // Closing is still available when the browser disallows History access.
      }
    }
    quickTrigger.current?.focus({ preventScroll: true });
  };
  const openAssistant = () => {
    setAssistant((current) => ({
      scope,
      campusId,
      open: true,
      focusRequest: current?.scope === scope ? current.focusRequest + 1 : 1,
    }));
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
        hideAssistant();
      }
    }
    // Native details toggle does not bubble; capture also covers keyboard/programmatic opening.
    navigation?.addEventListener('toggle', onToggle, true);
    return () => navigation?.removeEventListener('toggle', onToggle, true);
  }, [navigationScope, hideAssistant]);
  useEffect(() => {
    function dismissOutside(event: PointerEvent | FocusEvent) {
      if (!(event.target instanceof Node)) return;
      if (accountMenu.current?.open && !accountMenu.current.contains(event.target)) {
        accountMenu.current.open = false;
      }
      if (
        assistantOpen &&
        !quickPanel.current?.contains(event.target) &&
        !quickTrigger.current?.contains(event.target)
      ) {
        // Keep focus on the destination the person selected outside this nonmodal panel.
        hideAssistant();
      }
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [assistantOpen, hideAssistant]);
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
    // A notice above the header can move it without changing its own size.
    // Refresh on opening as well, so every disclosure uses the current position.
    if (navigation.parentElement) observer?.observe(navigation.parentElement);
    navigation.addEventListener('toggle', updateHeaderInset, true);
    window.addEventListener('resize', updateHeaderInset);
    window.addEventListener('scroll', updateHeaderInset, { passive: true });
    return () => {
      observer?.disconnect();
      navigation.removeEventListener('toggle', updateHeaderInset, true);
      window.removeEventListener('resize', updateHeaderInset);
      window.removeEventListener('scroll', updateHeaderInset);
    };
  }, [assistantOpen]);
  const activeSection = primaryNavigationSection(pathname);
  const href = (path: string) => campusServiceHref(path, context);
  const currentPage = currentReturnPath(pathname || '/', params?.size ? `?${params}` : '', hash);
  const loginPage = ['/login', '/classroom/login', '/admin/login'].includes(pathname || '');
  const checking = !hydrated || loading || nuni.loading;
  const restoredReturn = useRef<string | null>(null);
  useEffect(() => {
    if (hash !== '#campus-assistant-entry') {
      restoredReturn.current = null;
      return;
    }
    if (onOpenAssistant || checking || nuni.pendingLogout || campus.status === 'loading') return;
    if (restoredReturn.current === currentPage) return;
    restoredReturn.current = currentPage;
    // Resume the visible task after login, without sending a question or starting audio.
    setAssistant({ scope, campusId, open: true, focusRequest: 1 });
  }, [
    hash,
    currentPage,
    scope,
    campusId,
    checking,
    nuni.pendingLogout,
    campus.status,
    onOpenAssistant,
  ]);
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
            aria-label="開啟校園助理"
            aria-controls={onOpenAssistant ? 'today-voice-entry' : 'campus-assistant-entry'}
            aria-expanded={onOpenAssistant ? assistantExpanded : assistantOpen}
            onClick={() => {
              closeNavigationPopovers(header.current);
              if (onOpenAssistant) onOpenAssistant();
              else if (assistantOpen) closeAssistant();
              else openAssistant();
            }}
          >
            <CampusIcon name="social" size={18} />
            <span>助理</span>
          </button>
          <CampusServiceMenu />
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
              <div className={headerStyles.accountPanel} id={`${id}-account`}>
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
                  <Link
                    href="/profile"
                    onClick={(event) => {
                      if (
                        isCurrentTabNavigationClick(event, event.currentTarget)
                      ) {
                        if (accountMenu.current) accountMenu.current.open = false;
                      }
                    }}
                  >
                    <CampusIcon name="profile" size={18} />
                    我的帳號
                    <CampusIcon name="arrow" size={16} />
                  </Link>
                )}
                {!checking && nuni.session?.isPlatformOperator && (
                  <Link
                    href="/admin"
                    onClick={(event) => {
                      if (
                        isCurrentTabNavigationClick(event, event.currentTarget)
                      ) {
                        if (accountMenu.current) accountMenu.current.open = false;
                      }
                    }}
                  >
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
        <nav ref={primaryNavigation} aria-label="主要導覽" className={headerStyles.nav}>
          {PRIMARY_DESTINATIONS.map((destination) => (
            <Link
              key={destination.id}
              href={href(destination.href)}
              aria-current={activeSection === destination.id ? 'page' : undefined}
              title={destination.id === 'study' ? '課務：課表、課程與作業、成績' : undefined}
            >
              <CampusIcon name={destination.icon} size={17} />
              <span className={headerStyles.navLabel}>{destination.label}</span>
            </Link>
          ))}
        </nav>
      </header>
      {panel && !onOpenAssistant && (
        <section
          key={scope}
          id="campus-assistant-entry"
          ref={quickPanel}
          role="dialog"
          aria-label="校園助理"
          tabIndex={-1}
          hidden={!assistantOpen}
          className={headerStyles.voicePanel}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.nativeEvent.isComposing &&
              !event.defaultPrevented
            ) {
              event.preventDefault();
              event.stopPropagation();
              closeAssistant();
            }
          }}
        >
          <div className={headerStyles.voicePanelHeading}>
            <h2>校園助理</h2>
            <button type="button" onClick={closeAssistant} aria-label="關閉校園助理">
              關閉
            </button>
          </div>
          <Suspense fallback={<p role="status">正在開啟校園助理…</p>}>
            <CampusAssistantEntry
              active={assistantOpen}
              focusRequest={panel.focusRequest}
              returnAnchor="campus-assistant-entry"
              onNavigate={closeAssistant}
            />
          </Suspense>
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
