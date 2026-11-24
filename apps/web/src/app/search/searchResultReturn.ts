'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

const SEARCH_RETURN_STATE = '__campusSearchResultReturn';
type ResultKind = 'service' | 'suggested' | 'assistant';
type SearchReturn = {
  token: string;
  url: string;
  scope: string;
  filters: string;
  href: string;
  kind: ResultKind;
};

let observedWindow: Window | undefined;
let pendingReturn: SearchReturn | null = null;
let returnSequence = 0;
const listeners = new Set<() => void>();
let trackedUrl = '';
let expectedReturnFrom: string | null = null;
let historyTrackingInstalled = false;

function currentUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function leftSearchForUnrelatedDestination(previousUrl: string, nextUrl: string) {
  if (!expectedReturnFrom) return;
  if (new URL(previousUrl, window.location.origin).pathname !== '/search') return;
  // Tests and some in-app moves only keep the pathname in common with the
  // remembered result href; query strings can differ. Bottom navigation to
  // another section uses a different path.
  if (new URL(nextUrl, window.location.origin).pathname ===
      new URL(expectedReturnFrom, window.location.origin).pathname) return;
  // A later departure from the same search entry (for example the bottom
  // navigation) must not reuse the previous result marker on the next Back.
  expectedReturnFrom = null;
}

function syncTrackedUrl() {
  const previousUrl = trackedUrl;
  const nextUrl = currentUrl();
  if (previousUrl && previousUrl !== nextUrl) {
    leftSearchForUnrelatedDestination(previousUrl, nextUrl);
  }
  trackedUrl = nextUrl;
}

function installHistoryTracking() {
  if (historyTrackingInstalled) return;
  historyTrackingInstalled = true;
  trackedUrl = currentUrl();
  const wrap = (method: 'pushState' | 'replaceState') => {
    const original = window.history[method];
    window.history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      const result = original.call(this, data, unused, url);
      syncTrackedUrl();
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', syncTrackedUrl);
}

function readReturn(state: unknown): SearchReturn | null {
  if (!state || typeof state !== 'object') return null;
  const saved = (state as Record<string, unknown>)[SEARCH_RETURN_STATE];
  if (!saved || typeof saved !== 'object') return null;
  const value = saved as Partial<SearchReturn>;
  return typeof value.token === 'string' &&
    typeof value.url === 'string' &&
    typeof value.scope === 'string' &&
    typeof value.filters === 'string' &&
    typeof value.href === 'string' &&
    (value.kind === 'service' || value.kind === 'suggested' || value.kind === 'assistant')
    ? (value as SearchReturn)
    : null;
}

function publishReturn(value: SearchReturn | null) {
  if (pendingReturn === value) return;
  pendingReturn = value;
  listeners.forEach((listener) => listener());
}

function captureReturn(event: PopStateEvent) {
  const saved = readReturn(event.state);
  const sameSearchEntry =
    window.location.pathname === '/search' && saved?.url === currentUrl();
  const cameFromRememberedResult =
    !!saved &&
    !!expectedReturnFrom &&
    new URL(expectedReturnFrom, window.location.origin).pathname ===
      new URL(saved.href, window.location.origin).pathname;
  publishReturn(sameSearchEntry && cameFromRememberedResult ? saved : null);
}

function cancelPendingReturn() {
  // Typing, touching, or scrolling while the Router/account/campus is resolving
  // means the person has already chosen where to continue.
  publishReturn(null);
}

function subscribeReturn(listener: () => void) {
  installHistoryTracking();
  if (observedWindow !== window) {
    observedWindow?.removeEventListener('popstate', captureReturn);
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      observedWindow?.removeEventListener(event, cancelPendingReturn, true);
    }
    observedWindow = window;
    pendingReturn = null;
    // The search page is absent while its destination is open. One session
    // observer records a real history traversal; mounting alone never opts in.
    window.addEventListener('popstate', captureReturn);
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(event, cancelPendingReturn, { capture: true, passive: true });
    }
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getReturn = () => pendingReturn;
const getServerReturn = () => null;

export function rememberSearchResultReturn(value: Omit<SearchReturn, 'token' | 'url'>) {
  publishReturn(null);
  if (window.location.pathname !== '/search') return;
  expectedReturnFrom = value.href;
  try {
    window.history.replaceState(
      {
        ...window.history.state,
        [SEARCH_RETURN_STATE]: {
          ...value,
          token: `${Date.now()}-${++returnSequence}`,
          url: currentUrl(),
        } satisfies SearchReturn,
      },
      '',
    );
  } catch {
    // Opening a service remains available when the browser denies History access.
  }
}

export function clearSearchResultReturn() {
  publishReturn(null);
  if (!readReturn(window.history.state)) return;
  try {
    const state = { ...window.history.state };
    delete state[SEARCH_RETURN_STATE];
    window.history.replaceState(state, '');
  } catch {
    // The pending focus is cancelled even if this entry cannot be updated.
  }
}

export function useSearchResultReturn({
  directory,
  resultsHeading,
  scope,
  ready,
  blocked,
  queryString,
  filters,
}: {
  directory: RefObject<HTMLDivElement | null>;
  resultsHeading: RefObject<HTMLHeadingElement | null>;
  scope: string;
  ready: boolean;
  blocked: boolean;
  queryString: string;
  filters: string;
}) {
  const historyReturn = useSyncExternalStore(subscribeReturn, getReturn, getServerReturn);
  const liveState = useRef({ scope, ready, blocked, queryString, filters });
  useLayoutEffect(() => {
    liveState.current = { scope, ready, blocked, queryString, filters };
  }, [blocked, filters, queryString, ready, scope]);

  useEffect(() => {
    if (!historyReturn || getReturn() !== historyReturn) return;
    const current = readReturn(window.history.state);
    if (
      blocked ||
      current?.token !== historyReturn.token ||
      current.url !== currentUrl() ||
      current.url !== historyReturn.url
    ) {
      publishReturn(null);
      return;
    }
    if (!ready) return;
    if (current.scope !== scope) {
      publishReturn(null);
      return;
    }
    // Back may arrive before Next renders its URL or the saved search draft.
    if (
      new URL(current.url, window.location.origin).searchParams.toString() !== queryString ||
      current.filters !== filters
    )
      return;

    const link = Array.from(
      directory.current?.querySelectorAll<HTMLAnchorElement>('a[data-search-return-kind]') ?? [],
    ).find(
      (element) =>
        element.dataset.searchReturnKind === current.kind &&
        element.getAttribute('href') === current.href,
    );
    // AI previews belong to their original request. If they are no longer on
    // screen, resume at the results without retaining private data or requerying.
    const target = link ?? (current.kind === 'suggested' ? resultsHeading.current : null);
    if (!target) {
      publishReturn(null);
      return;
    }

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== target &&
      active.matches('a, button, input, select, textarea, summary, [contenteditable="true"]')
    ) {
      publishReturn(null);
      return;
    }

    // Native history restoration runs after popstate and can start a smooth
    // scroll after this effect. Resume on the next frame, before paint, without
    // changing the browser's global history.scrollRestoration preference.
    const frame = window.requestAnimationFrame(() => {
      if (getReturn() !== historyReturn) return;
      const latest = readReturn(window.history.state);
      const live = liveState.current;
      const focus = document.activeElement;
      if (
        !target.isConnected ||
        !directory.current?.contains(target) ||
        latest?.token !== historyReturn.token ||
        latest.url !== historyReturn.url ||
        latest.url !== currentUrl() ||
        latest.scope !== live.scope ||
        latest.filters !== live.filters ||
        new URL(latest.url, window.location.origin).searchParams.toString() !== live.queryString ||
        !live.ready ||
        live.blocked ||
        (focus !== active && focus !== target && focus !== document.body)
      ) {
        publishReturn(null);
        return;
      }
      publishReturn(null);
      let parent = target.parentElement;
      while (parent && directory.current?.contains(parent)) {
        if (parent instanceof HTMLDetailsElement) parent.setAttribute('open', '');
        parent = parent.parentElement;
      }
      target.focus({ preventScroll: true });
      // nearest may do nothing when the target is already visible in this
      // frame. Explicitly stop the pending native smooth restoration first so
      // it cannot subsequently move the focused title behind the bottom bar.
      window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'instant' });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [blocked, directory, filters, historyReturn, queryString, ready, resultsHeading, scope]);
}
