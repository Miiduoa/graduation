'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import { SERVICE_CATEGORIES, type ServiceCategory } from '@/lib/campusServices';

import { consumeSearchResultNavigation, markSearchResultNavigation } from './searchResultNavigation';

const HISTORY_ENTRY_KEY = '__campusSearchHistoryEntry';
const SEARCH_RETURN_STATE = '__campusSearchResultReturn';
type ResultKind = 'service' | 'suggested' | 'assistant';
type SearchReturn = {
  token: string;
  url: string;
  scope: string;
  filters: { query: string; category: ServiceCategory | 'all' };
  href: string;
  kind: ResultKind;
};

let observedWindow: Window | undefined;
let pendingReturn: SearchReturn | null = null;
let returnSequence = 0;
const listeners = new Set<() => void>();
// popstate exposes the arriving entry. Keep its predecessor across router writes and traversals.
let trackedEntryKey: string | null = null;
let historyEntrySequence = 0;
const armedReturnByToken = new Map<string, { searchKey: string; destinationKey: string | null }>();

function currentUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function appUrl(href: string) {
  const url = new URL(href, window.location.origin);
  return `${url.pathname}${url.search}${url.hash}`;
}

function readEntryKey(state: unknown) {
  if (!state || typeof state !== 'object') return null;
  const key = (state as Record<string, unknown>)[HISTORY_ENTRY_KEY];
  return typeof key === 'string' ? key : null;
}

export function getSearchHistoryEntryKey() {
  return readEntryKey(window.history.state);
}

function hasSearchHistoryFields(state: unknown): state is Record<string, unknown> {
  return state !== null &&
    typeof state === 'object' &&
    (HISTORY_ENTRY_KEY in state || SEARCH_RETURN_STATE in state);
}

function onHistoryPush(
  previousState: unknown,
  previousPath: string,
  entryKey: string | null,
  routerCommit: boolean,
) {
  const navigationToken = consumeSearchResultNavigation();
  // Only a traversal between the linked entries can start another restore.
  publishReturn(null);
  const leaving = readReturn(previousState);
  const armed = leaving && armedReturnByToken.get(leaving.token);
  if (leaving && armed?.searchKey === readEntryKey(previousState) && previousPath === '/search') {
    if (routerCommit && leaving.token === navigationToken && appUrl(leaving.href) === currentUrl()) {
      armed.destinationKey = entryKey;
    } else if (window.location.pathname !== '/search') {
      armedReturnByToken.delete(leaving.token);
    }
  }
}

function isHistoryRecord(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null;
}

function installHistoryTracking() {
  trackedEntryKey = readEntryKey(window.history.state);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const previousState = this.state;
      const previousKey = readEntryKey(previousState);
      const previousPath = window.location.pathname;
      const push = method === 'pushState';
      // Use the shape History will serialize, including arrays with custom fields.
      const cloned = !isHistoryRecord(data) && hasSearchHistoryFields(data);
      let state = cloned ? structuredClone(data) : data;
      if (state == null || isHistoryRecord(state) || hasSearchHistoryFields(state)) {
        const current = state as Record<string, unknown> | null | undefined;
        if (push || previousKey || current?.[SEARCH_RETURN_STATE] || current?.[HISTORY_ENTRY_KEY]) {
          const fields = cloned && current ? current : { ...current };
          if (push) delete fields[SEARCH_RETURN_STATE];
          // Replace retains the current entry's identity. Push always creates a new one.
          fields[HISTORY_ENTRY_KEY] =
            (push ? null : previousKey) ?? `${Date.now()}-${++historyEntrySequence}`;
          state = fields;
        }
      }
      original.call(this, state, unused, url);
      // A router replace can run during traversal, before our popstate observer.
      // Keep the departing key until that observer has compared the two entries.
      if (push || previousKey === trackedEntryKey) trackedEntryKey = readEntryKey(this.state);
      if (push) {
        // Next's own commit supplies its router state before the native History
        // wrapper has a chance to fill it in for application-authored writes.
        const routerCommit =
          isHistoryRecord(data) &&
          (data as { __NA?: boolean }).__NA === true &&
          readEntryKey(data) === null &&
          !readReturn(data);
        onHistoryPush(previousState, previousPath, trackedEntryKey, routerCommit);
      }
    };
  }
}

function readReturn(state: unknown): SearchReturn | null {
  if (!state || typeof state !== 'object') return null;
  const saved = (state as Record<string, unknown>)[SEARCH_RETURN_STATE];
  if (!saved || typeof saved !== 'object') return null;
  const value = saved as Partial<SearchReturn>;
  return typeof value.token === 'string' &&
    typeof value.url === 'string' &&
    typeof value.scope === 'string' &&
    typeof value.filters?.query === 'string' &&
    (value.filters.category === 'all' ||
      SERVICE_CATEGORIES.some(({ id }) => id === value.filters?.category)) &&
    typeof value.href === 'string' &&
    (value.kind === 'service' || value.kind === 'suggested' || value.kind === 'assistant')
    ? (value as SearchReturn)
    : null;
}

function readCurrentReturn(expected: SearchReturn) {
  const state = window.history.state;
  const current = readReturn(state);
  const armed = armedReturnByToken.get(expected.token);
  return armed &&
    readEntryKey(state) === armed.searchKey &&
    current?.token === expected.token &&
    current.url === expected.url &&
    current.url === currentUrl()
    ? current
    : null;
}

function matchesRouterUrl(saved: SearchReturn, queryString: string) {
  return new URL(saved.url, window.location.origin).searchParams.toString() === queryString;
}

function publishReturn(value: SearchReturn | null) {
  if (pendingReturn === value) return;
  pendingReturn = value;
  listeners.forEach((listener) => listener());
}

function captureReturn(event: PopStateEvent) {
  const saved = readReturn(event.state);
  const entryKey = readEntryKey(event.state);
  const departedKey = trackedEntryKey;
  trackedEntryKey = entryKey;
  consumeSearchResultNavigation();
  const armed = saved && armedReturnByToken.get(saved.token);
  publishReturn(
    saved &&
      armed &&
      entryKey === armed.searchKey &&
      departedKey !== null &&
      departedKey === armed.destinationKey &&
      window.location.pathname === '/search' &&
      saved.url === currentUrl()
      ? saved
      : null,
  );
}

function cancelPendingReturn() {
  // Typing, touching, or scrolling while the Router/account/campus is resolving
  // means the person has already chosen where to continue.
  publishReturn(null);
}

function subscribeReturn(listener: () => void) {
  if (observedWindow !== window) {
    installHistoryTracking();
    observedWindow?.removeEventListener('popstate', captureReturn, true);
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      observedWindow?.removeEventListener(event, cancelPendingReturn, true);
    }
    observedWindow = window;
    pendingReturn = null;
    // The search page is absent while its destination is open. One session
    // observer records a real history traversal; mounting alone never opts in.
    // Capture the departing key before router listeners can rewrite the arriving state.
    window.addEventListener('popstate', captureReturn, true);
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
  const token = `${Date.now()}-${++returnSequence}`;
  const previousState = window.history.state;
  try {
    window.history.replaceState(
      {
        ...previousState,
        [SEARCH_RETURN_STATE]: {
          ...value,
          token,
          url: currentUrl(),
        } satisfies SearchReturn,
      },
      '',
    );
    const searchKey = readEntryKey(window.history.state);
    if (searchKey) {
      const previous = readReturn(previousState);
      if (previous && armedReturnByToken.get(previous.token)?.searchKey === searchKey) {
        armedReturnByToken.delete(previous.token);
      }
      armedReturnByToken.set(token, { searchKey, destinationKey: null });
      markSearchResultNavigation(token);
    }
  } catch {
    // Opening a service remains available when the browser denies History access.
  }
}

export function clearSearchResultReturn() {
  publishReturn(null);
  const saved = readReturn(window.history.state);
  if (!saved) return;
  if (armedReturnByToken.get(saved.token)?.searchKey === readEntryKey(window.history.state)) {
    armedReturnByToken.delete(saved.token);
  }
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
  query,
  category,
}: {
  directory: RefObject<HTMLDivElement | null>;
  resultsHeading: RefObject<HTMLHeadingElement | null>;
  scope: string;
  ready: boolean;
  blocked: boolean;
  queryString: string;
  query: string;
  category: ServiceCategory | 'all';
}) {
  const historyReturn = useSyncExternalStore(subscribeReturn, getReturn, getServerReturn);
  const liveState = useRef({ scope, ready, blocked, queryString, query, category });
  useLayoutEffect(() => {
    liveState.current = { scope, ready, blocked, queryString, query, category };
  }, [blocked, category, query, queryString, ready, scope]);

  const matchingFilters =
    historyReturn &&
    ready &&
    !blocked &&
    historyReturn.scope === scope &&
    readCurrentReturn(historyReturn) &&
    matchesRouterUrl(historyReturn, queryString)
      ? historyReturn.filters
      : null;

  useEffect(() => {
    if (!historyReturn || getReturn() !== historyReturn) return;
    const current = readCurrentReturn(historyReturn);
    if (blocked || !current) {
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
      !matchesRouterUrl(current, queryString) ||
      current.filters.query !== query ||
      current.filters.category !== category
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
      const latest = readCurrentReturn(historyReturn);
      const live = liveState.current;
      const focus = document.activeElement;
      if (
        !target.isConnected ||
        !directory.current?.contains(target) ||
        !latest ||
        latest.scope !== live.scope ||
        latest.filters.query !== live.query ||
        latest.filters.category !== live.category ||
        !matchesRouterUrl(latest, live.queryString) ||
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
  }, [
    blocked,
    category,
    directory,
    historyReturn,
    query,
    queryString,
    ready,
    resultsHeading,
    scope,
  ]);

  return matchingFilters;
}
