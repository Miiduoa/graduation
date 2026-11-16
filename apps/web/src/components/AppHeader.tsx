'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const CampusAssistantEntry = lazy(async () => ({
  default: (await import('./TodayCampusEntry')).TodayCampusEntry,
}));

type HeaderProps = { onOpenAssistant?: () => void; assistantExpanded?: boolean };
type AssistantPanelState = { scope: string; open: boolean; focusRequest: number };

function Header({ onOpenAssistant, assistantExpanded }: HeaderProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const hash = useLocationHash();
  const { user, loading, signOutUser } = useAuth();
  const nuni = useNuniSession();
  const hydrated = useClientHydrated();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [assistant, setAssistant] = useState<AssistantPanelState | null>(null);
  const quickTrigger = useRef<HTMLButtonElement>(null);
  const quickPanel = useRef<HTMLElement>(null);
  const context = useCampusNavigationSearch(params);
  const campus = useCampusBrowseContext();
  const scope = JSON.stringify([
    pathname,
    params?.toString(),
    campus.schoolId,
    user?.uid,
    nuni.session?.context,
    nuni.session?.platformAccountId,
    nuni.pendingLogout,
    Boolean(nuni.error),
  ]);
  const panel = assistant?.scope === scope ? assistant : null;
  const assistantOpen = panel?.open === true;
  if (assistant && assistant.scope !== scope) setAssistant(null);
  useLayoutEffect(() => {
    if (assistantOpen) quickPanel.current?.focus({ preventScroll: true });
  }, [assistantOpen]);
  const closeAssistant = () => {
    quickPanel.current
      ?.querySelectorAll<HTMLButtonElement>(
        '[data-voice-input][aria-pressed="true"], [data-voice-playback][aria-pressed="true"]',
      )
      .forEach((button) => button.click());
    setAssistant((current) => (current?.scope === scope ? { ...current, open: false } : null));
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
      open: true,
      focusRequest: current?.scope === scope ? current.focusRequest + 1 : 1,
    }));
  };
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
    setAssistant({ scope, open: true, focusRequest: 1 });
  }, [hash, currentPage, scope, checking, nuni.pendingLogout, campus.status, onOpenAssistant]);
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
            aria-label="開啟校園助理"
            aria-controls={onOpenAssistant ? 'today-voice-entry' : 'campus-assistant-entry'}
            aria-expanded={onOpenAssistant ? assistantExpanded : assistantOpen}
            onClick={onOpenAssistant ?? (assistantOpen ? closeAssistant : openAssistant)}
          >
            <CampusIcon name="social" size={18} />
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
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              closeAssistant();
            }
          }}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('a')) {
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
            />
          </Suspense>
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
