'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import { SERVICE_CATEGORIES, type ServiceCategory } from '@/lib/campusServices';

import {
  APP_ROUTER_HISTORY_PUSH,
  consumeSearchResultNavigation,
  markSearchResultNavigation,
} from './searchResultNavigation';

const HISTORY_ENTRY_KEY = '__campusSearchHistoryEntry';
const SEARCH_RETURN_STATE = '__campusSearchResultReturn';
const HISTORY_STATE_PAYLOAD = '__campusSearchHistoryPayload';
const WRITE_SEARCH_RETURN = Symbol();
type ResultKind = 'service' | 'suggested' | 'assistant';
type SearchReturn = {
  token: string;
  scope: string;
  filters: { query: string; category: ServiceCategory | 'all' };
  href: string;
  kind: ResultKind;
};
type FilterArrival = { saved: SearchReturn; queryString: string };

let observedWindow: Window | undefined;
const emptyReturnState: { pending: SearchReturn | null; arrival: FilterArrival | null } = {
  pending: null,
  arrival: null,
};
let returnState = emptyReturnState;
let returnSequence = 0;
const listeners = new Set<() => void>();
// popstate exposes the arriving entry. Keep its predecessor across router writes and traversals.
let trackedEntryKey: string | null = null;
let historyEntrySequence = 0;
// The source key binds the saved filters to the entry even after its destination is unpaired.
const entriesByReturnToken = new Map<
  string,
  { searchKey: string; searchUrl: string; destinationKey: string | null }
>();

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
  searchEntry: ReturnType<typeof readSearchEntry>,
  entryKey: string | null,
  routerCommit: boolean,
) {
  const navigationToken = consumeSearchResultNavigation();
  // Only a traversal between the linked entries can start another restore.
  publishReturn(null, null);
  if (searchEntry) {
    const { saved, entries } = searchEntry;
    if (routerCommit && saved.token === navigationToken && appUrl(saved.href) === currentUrl()) {
      entries.destinationKey = entryKey;
    } else if (window.location.pathname !== '/search') {
      entries.destinationKey = null;
    }
  }
}

function isHistoryRecord(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null;
}

function isRouterPush(data: unknown) {
  return isHistoryRecord(data) &&
    Object.getOwnPropertyDescriptor(data, APP_ROUTER_HISTORY_PUSH)?.value === true;
}

function cloneHistoryState(data: unknown) {
  const cloned = structuredClone(data);
  if (isHistoryRecord(cloned) || Array.isArray(cloned)) return cloned;
  // Branded values such as Map serialize their payload but drop own properties.
  // Keep the payload intact in a record that can also carry the entry metadata.
  const record: Record<string, unknown> = { [HISTORY_STATE_PAYLOAD]: cloned };
  if (data && typeof data === 'object') {
    const fields = data as Record<string, unknown>;
    for (const key of ['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE']) {
      if (key in fields) record[key] = fields[key];
    }
  }
  return record;
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
      const searchEntry = readSearchEntry(previousState);
      const previousPath = window.location.pathname;
      const push = method === 'pushState';
      const routerCommit = push && isRouterPush(data);
      const replacesPage =
        !push && url != null && new URL(url, window.location.href).pathname !== previousPath;
      // Normalize copies and replacements of keyed entries before serialization.
      const cloned = data != null && !isHistoryRecord(data) &&
        ((!push && previousKey !== null) || hasSearchHistoryFields(data));
      const writesReturn =
        data != null && Object.getOwnPropertyDescriptor(data, WRITE_SEARCH_RETURN)?.value === true;
      let state = cloned ? cloneHistoryState(data) : data;
      if (cloned || state == null || isHistoryRecord(state)) {
        const current = state as Record<string, unknown> | null | undefined;
        if (push || previousKey || hasSearchHistoryFields(current) || writesReturn) {
          const fields = cloned && current ? current : { ...current };
          const saved = push || replacesPage
            ? null
            : writesReturn
              ? readReturn(current)
              : searchEntry?.saved;
          if (saved) fields[SEARCH_RETURN_STATE] = saved;
          else delete fields[SEARCH_RETURN_STATE];
          // Query and fragment replacements keep both pieces of entry metadata.
          fields[HISTORY_ENTRY_KEY] =
            (push || replacesPage ? null : previousKey) ?? `${Date.now()}-${++historyEntrySequence}`;
          state = fields;
        }
      }
      original.call(this, state, unused, url);
      // A router replace can run during traversal, before our popstate observer.
      // Keep the departing key until that observer has compared the two entries.
      if (push || previousKey === trackedEntryKey) trackedEntryKey = readEntryKey(this.state);
      if (push) {
        onHistoryPush(searchEntry, trackedEntryKey, routerCommit);
      } else if (!replacesPage && searchEntry && !writesReturn) {
        // Bind the new URL only after the browser accepts the same-page replacement.
        searchEntry.entries.searchUrl = currentUrl();
        const { arrival, pending } = returnState;
        // A query edit can supersede the traversal before its filters are applied.
        if (arrival && !matchesRouterUrl(arrival.queryString)) publishReturn(pending, null);
      } else if (replacesPage && previousKey) {
        for (const [token, armed] of entriesByReturnToken) {
          if (armed.searchKey === previousKey) entriesByReturnToken.delete(token);
          else if (armed.destinationKey === previousKey) armed.destinationKey = null;
        }
        publishReturn(null, null);
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
    typeof value.scope === 'string' &&
    typeof value.filters?.query === 'string' &&
    (value.filters.category === 'all' ||
      SERVICE_CATEGORIES.some(({ id }) => id === value.filters?.category)) &&
    typeof value.href === 'string' &&
    (value.kind === 'service' || value.kind === 'suggested' || value.kind === 'assistant')
    ? (value as SearchReturn)
    : null;
}

function readSearchEntry(state: unknown) {
  const saved = readReturn(state);
  const entries = saved && entriesByReturnToken.get(saved.token);
  return saved &&
    entries &&
    window.location.pathname === '/search' &&
    readEntryKey(state) === entries.searchKey &&
    currentUrl() === entries.searchUrl
    ? { saved, entries }
    : null;
}

function readCurrentReturn(expected: SearchReturn) {
  const current = readSearchEntry(window.history.state)?.saved;
  return current?.token === expected.token ? current : null;
}

function matchesRouterUrl(queryString: string) {
  return new URLSearchParams(window.location.search).toString() === queryString;
}

function publishReturn(pending: SearchReturn | null, arrival = returnState.arrival) {
  if (returnState.pending === pending && returnState.arrival === arrival) return;
  returnState = { pending, arrival };
  listeners.forEach((listener) => listener());
}

export function finishSearchFilterArrival(arrival: FilterArrival) {
  // Acknowledging this traversal leaves the entry snapshot available for another Back.
  if (returnState.arrival === arrival) publishReturn(returnState.pending, null);
}

function captureReturn(event: PopStateEvent) {
  const entry = readSearchEntry(event.state);
  const entryKey = readEntryKey(event.state);
  const departedKey = trackedEntryKey;
  trackedEntryKey = entryKey;
  consumeSearchResultNavigation();
  const saved = entry?.saved ?? null;
  publishReturn(
    departedKey !== null && departedKey === entry?.entries.destinationKey ? saved : null,
    saved ? { saved, queryString: new URLSearchParams(window.location.search).toString() } : null,
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
    returnState = emptyReturnState;
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

const getReturnState = () => returnState;
const getServerReturnState = () => emptyReturnState;

// Only these explicit writes can change the return data on an existing entry.
function replaceEntryReturn(saved: SearchReturn | null) {
  const previous = window.history.state;
  const state = Array.isArray(previous) ? structuredClone(previous) : { ...previous };
  if (saved) state[SEARCH_RETURN_STATE] = saved;
  else delete state[SEARCH_RETURN_STATE];
  Object.defineProperty(state, WRITE_SEARCH_RETURN, { value: true });
  window.history.replaceState(state, '');
}

export function rememberSearchResultReturn(value: Omit<SearchReturn, 'token'>) {
  publishReturn(null, null);
  if (window.location.pathname !== '/search') return;
  const token = `${Date.now()}-${++returnSequence}`;
  const previousState = window.history.state;
  try {
    replaceEntryReturn({ ...value, token });
    const searchKey = readEntryKey(window.history.state);
    if (searchKey) {
      const previous = readReturn(previousState);
      if (previous && entriesByReturnToken.get(previous.token)?.searchKey === searchKey) {
        entriesByReturnToken.delete(previous.token);
      }
      entriesByReturnToken.set(token, { searchKey, searchUrl: currentUrl(), destinationKey: null });
      markSearchResultNavigation(token);
    }
  } catch {
    // Opening a service remains available when the browser denies History access.
  }
}

export function clearSearchResultReturn() {
  publishReturn(null, null);
  const saved = readReturn(window.history.state);
  if (!saved) return;
  if (entriesByReturnToken.get(saved.token)?.searchKey === readEntryKey(window.history.state)) {
    entriesByReturnToken.delete(saved.token);
  }
  try {
    replaceEntryReturn(null);
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
  const { pending: historyReturn, arrival } = useSyncExternalStore(
    subscribeReturn,
    getReturnState,
    getServerReturnState,
  );
  const liveState = useRef({ scope, ready, blocked, queryString, query, category });
  useLayoutEffect(() => {
    liveState.current = { scope, ready, blocked, queryString, query, category };
  }, [blocked, category, query, queryString, ready, scope]);

  const filterArrival =
    arrival &&
    ready &&
    !blocked &&
    arrival.saved.scope === scope &&
    arrival.queryString === queryString &&
    readCurrentReturn(arrival.saved) &&
    matchesRouterUrl(queryString)
      ? arrival
      : null;

  useEffect(() => {
    if (!historyReturn || returnState.pending !== historyReturn) return;
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
      !matchesRouterUrl(queryString) ||
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
      if (returnState.pending !== historyReturn) return;
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
        !matchesRouterUrl(live.queryString) ||
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

  return filterArrival;
}
