'use client';

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import { SERVICE_CATEGORIES, type ServiceCategory } from '@/lib/campusServices';

import {
  APP_ROUTER_HISTORY_PUSH,
  APP_ROUTER_HISTORY_REPLACE,
  APP_ROUTER_SYNC_HISTORY_QUERY,
  consumeSearchResultNavigation,
  isSearchResultNavigationPending,
  markSearchResultNavigation,
} from './searchResultNavigation';

const HISTORY_ENTRY_KEY = '__campusSearchHistoryEntry';
const SEARCH_RETURN_STATE = '__campusSearchResultReturn';
const HISTORY_STATE_PAYLOAD = '__campusSearchHistoryPayload';
const NEXT_HISTORY_FIELDS = ['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE'] as const;
const WRITE_SEARCH_RETURN = Symbol();
type ResultKind = 'service' | 'suggested' | 'assistant';
type SearchReturn = {
  token: string;
  scope: string;
  filters: { query: string; category: ServiceCategory | 'all' };
  href: string;
  kind: ResultKind;
};
type FilterArrival = { entryKey: string; queryString: string; saved: SearchReturn | null };

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
const searchEntriesByKey = new Map<
  string,
  { token: string; searchUrl: string; destinationKey: string | null }
>();

function currentUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function matchesResultDestination(href: string, sourceHash: string) {
  const url = new URL(href, window.location.origin);
  const { pathname, search, hash } = window.location;
  if (url.pathname !== pathname || url.search !== search) return false;
  // Next Link can carry the current fragment into a target without one.
  return url.hash === hash || (!url.href.includes('#') && hash === sourceHash);
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
  const navigation = routerCommit ? consumeSearchResultNavigation() : null;
  // Only a traversal between the linked entries can start another restore.
  publishReturn(null, null);
  if (searchEntry) {
    const { saved, entries } = searchEntry;
    if (
      navigation &&
      saved.token === navigation.token &&
      matchesResultDestination(saved.href, navigation.sourceHash)
    ) {
      entries.destinationKey = entryKey;
    } else if (window.location.pathname !== '/search') {
      entries.destinationKey = null;
    }
  }
}

function isHistoryRecord(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object') return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null;
}

function isRouterHistoryWrite(data: unknown, marker: symbol) {
  return isHistoryRecord(data) &&
    Object.getOwnPropertyDescriptor(data, marker)?.value === true;
}

function readNextHistoryFields(data: unknown) {
  const fields: Partial<Record<(typeof NEXT_HISTORY_FIELDS)[number], unknown>> = {};
  if (data && typeof data === 'object') {
    for (const key of NEXT_HISTORY_FIELDS) {
      if (key in data) fields[key] = (data as Record<string, unknown>)[key];
    }
  }
  return fields;
}

function cloneHistoryState(
  data: unknown,
): Record<string, unknown> | (unknown[] & { [SEARCH_RETURN_STATE]?: SearchReturn }) {
  const cloned: unknown = structuredClone(data);
  if (isHistoryRecord(cloned)) return cloned;
  if (Array.isArray(cloned)) return cloned;
  // Branded values such as Map serialize their payload but drop own properties.
  // Keep the payload intact in a record that can also carry the entry metadata.
  return { [HISTORY_STATE_PAYLOAD]: cloned, ...readNextHistoryFields(data) };
}

export function replaceSearchHistoryQuery(url: URL) {
  const previous = window.history.state;
  const state = readNextHistoryFields(previous).__NA ? cloneHistoryState(previous) : null;
  if (state) {
    // Opt in at the call site so the marker reaches Next in either wrapper order.
    Object.defineProperty(state, APP_ROUTER_SYNC_HISTORY_QUERY, { value: true });
  }
  window.history.replaceState(state, '', `${url.pathname}${url.search}${url.hash}`);
}

function installHistoryTracking() {
  trackedEntryKey = readEntryKey(window.history.state);
  // History caches the deserialized state for the active entry. Its identity
  // ties these fields to that entry even before the first search key is written.
  let nativeState: {
    value: unknown;
    nextFields: ReturnType<typeof readNextHistoryFields>;
  } | null = null;
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
      const previousHref = window.location.href;
      const previousQueryString = currentQueryString();
      const push = method === 'pushState';
      const routerCommit = push && isRouterHistoryWrite(data, APP_ROUTER_HISTORY_PUSH);
      const routerReplace = !push && isRouterHistoryWrite(data, APP_ROUTER_HISTORY_REPLACE);
      const targetUrl = url == null ? null : new URL(url, previousHref);
      const changesPage = targetUrl !== null && targetUrl.pathname !== previousPath;
      const replacesPage = !push && changesPage;
      const incomingNextFields = changesPage ? {} : readNextHistoryFields(data);
      const nextFields = changesPage ? {} : {
        ...(nativeState?.value === previousState ? nativeState?.nextFields : {}),
        ...readNextHistoryFields(previousState),
        ...incomingNextFields,
      };
      const record = isHistoryRecord(data);
      const copiedState = !record && hasSearchHistoryFields(data);
      // A same-page application push can become the entry immediately behind
      // the pending result. Use the active entry to authorize the snapshot, then bind
      // it to the new key after the write succeeds.
      const carriesReturn =
        push && !routerCommit && !changesPage &&
        searchEntry && isSearchResultNavigationPending(searchEntry.saved.token);
      // Normalize any payload that needs entry metadata before serialization.
      const cloned = data != null && !record &&
        (carriesReturn || replacesPage || (!push && previousKey !== null) || copiedState);
      const writesReturn =
        data != null && Object.getOwnPropertyDescriptor(data, WRITE_SEARCH_RETURN)?.value === true;
      let state = cloned ? cloneHistoryState(data) : data;
      if (cloned || state == null || isHistoryRecord(state)) {
        const current = state as Record<string, unknown> | null | undefined;
        if (push || replacesPage || previousKey || hasSearchHistoryFields(current) || writesReturn) {
          const fields = cloned && current ? current : { ...current };
          // Restore the router tree when adding a snapshot to the same native
          // entry so Back stays in this document. Application pushes must reach
          // Next without an injected __NA so it can synchronize the new URL.
          if (!push && writesReturn && nativeState?.value === previousState) {
            Object.assign(fields, nextFields);
          }
          const saved = replacesPage || (push && !carriesReturn)
            ? null
            : writesReturn && !push
              ? readReturn(current)
              : searchEntry?.saved;
          if (saved) fields[SEARCH_RETURN_STATE] = saved;
          else delete fields[SEARCH_RETURN_STATE];
          // Query and fragment replacements keep both pieces of entry metadata.
          fields[HISTORY_ENTRY_KEY] =
            (push || replacesPage ? null : previousKey) ?? `${Date.now()}-${++historyEntrySequence}`;
          if (routerReplace) {
            // Next uses this marker to distinguish its commit from an application replacement.
            Object.defineProperty(fields, APP_ROUTER_HISTORY_REPLACE, { value: true });
          }
          state = fields;
        }
      }
      // Forward the caller's opt-in if Next is inside this observer.
      if (state !== data && data != null &&
        Object.getOwnPropertyDescriptor(data, APP_ROUTER_SYNC_HISTORY_QUERY)?.value === true) {
        Object.defineProperty(state, APP_ROUTER_SYNC_HISTORY_QUERY, { value: true });
      }
      original.call(this, state, unused, url);
      nativeState = !cloned && state != null && !isHistoryRecord(state)
        ? { value: this.state, nextFields }
        : null;
      // A router replace can run during traversal, before our popstate observer.
      // Keep the departing key until that observer has compared the two entries.
      if (push || previousKey === trackedEntryKey) trackedEntryKey = readEntryKey(this.state);
      if (push) {
        if (carriesReturn && trackedEntryKey) {
          searchEntriesByKey.set(trackedEntryKey, {
            token: searchEntry.saved.token,
            searchUrl: currentUrl(),
            destinationKey: null,
          });
        }
        onHistoryPush(searchEntry, trackedEntryKey, routerCommit);
      } else if (!replacesPage && searchEntry && !writesReturn) {
        // Bind the new URL only after the browser accepts the same-page replacement.
        searchEntry.entries.searchUrl = currentUrl();
        const { arrival, pending } = returnState;
        const nextHref = window.location.href;
        const changesOnlyFragment =
          (typeof url === 'string' && url.trimStart().startsWith('#')) ||
          (previousHref !== nextHref &&
            previousHref.split('#', 1)[0] === nextHref.split('#', 1)[0]);
        const queryString = currentQueryString();
        // Match the Router's query representation so a native encoding-only rewrite
        // cannot publish a filter arrival that would replace an in-progress draft.
        const keepsNativeQuery = incomingNextFields.__NA && previousQueryString === queryString;
        if (
          url != null &&
          previousKey &&
          !changesOnlyFragment &&
          !keepsNativeQuery &&
          !routerReplace
        ) {
          publishReturn(null, {
            entryKey: previousKey,
            queryString,
            saved: null,
          });
        } else if (arrival && !matchesRouterUrl(arrival.queryString)) {
          publishReturn(pending, null);
        }
      } else if (replacesPage && previousKey) {
        searchEntriesByKey.delete(previousKey);
        for (const armed of searchEntriesByKey.values()) {
          if (armed.destinationKey === previousKey) armed.destinationKey = null;
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
  const key = readEntryKey(state);
  const entries = key && searchEntriesByKey.get(key);
  return saved &&
    entries &&
    window.location.pathname === '/search' &&
    saved.token === entries.token &&
    currentUrl() === entries.searchUrl
    ? { saved, entries }
    : null;
}

function readCurrentReturn(expected: SearchReturn) {
  const current = readSearchEntry(window.history.state)?.saved;
  return current?.token === expected.token ? current : null;
}

function currentQueryString() {
  return new URLSearchParams(window.location.search).toString();
}

function matchesRouterUrl(queryString: string) {
  return currentQueryString() === queryString;
}

function publishReturn(pending: SearchReturn | null, arrival = returnState.arrival) {
  if (returnState.pending === pending && returnState.arrival === arrival) return;
  returnState = { pending, arrival };
  listeners.forEach((listener) => listener());
}

export function finishSearchFilterArrival(arrival: FilterArrival) {
  // Acknowledging the filter update leaves the entry snapshot available for another Back.
  if (returnState.arrival === arrival) publishReturn(returnState.pending, null);
}

function captureReturn(event: PopStateEvent) {
  const entry = readSearchEntry(event.state);
  const entryKey = readEntryKey(event.state);
  const departedKey = trackedEntryKey;
  trackedEntryKey = entryKey;
  consumeSearchResultNavigation();
  // Only the paired destination can restore the result snapshot and its filters.
  // Other traversals into this entry restore the filters from the arriving URL.
  const saved =
    entry && departedKey !== null && departedKey === entry.entries.destinationKey
      ? entry.saved
      : null;
  publishReturn(
    saved,
    entry && entryKey ? { saved, entryKey, queryString: currentQueryString() } : null,
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
  const state = previous == null ? {} : cloneHistoryState(previous);
  if (saved) state[SEARCH_RETURN_STATE] = saved;
  else delete state[SEARCH_RETURN_STATE];
  Object.defineProperty(state, WRITE_SEARCH_RETURN, { value: true });
  window.history.replaceState(state, '');
}

export function rememberSearchResultReturn(value: Omit<SearchReturn, 'token'>) {
  publishReturn(null, null);
  if (window.location.pathname !== '/search') return;
  const token = `${Date.now()}-${++returnSequence}`;
  try {
    replaceEntryReturn({ ...value, token });
    const searchKey = readEntryKey(window.history.state);
    if (searchKey) {
      searchEntriesByKey.set(searchKey, { token, searchUrl: currentUrl(), destinationKey: null });
      markSearchResultNavigation(token);
    }
  } catch {
    // Opening a service remains available when the browser denies History access.
  }
}

export function supersedeSearchResultReturn() {
  // Reset the active return while keeping the entry's saved filters and destination pairing.
  publishReturn(null, null);
  const entry = readSearchEntry(window.history.state);
  if (entry && isSearchResultNavigationPending(entry.saved.token)) {
    // An edit before the Router commits also cancels that navigation's focus pairing.
    consumeSearchResultNavigation();
  }
}

export function clearSearchResultReturn() {
  supersedeSearchResultReturn();
  const saved = readReturn(window.history.state);
  if (!saved) return;
  const key = readEntryKey(window.history.state);
  if (key && searchEntriesByKey.get(key)?.token === saved.token) {
    searchEntriesByKey.delete(key);
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
    arrival.entryKey === getSearchHistoryEntryKey() &&
    arrival.queryString === queryString &&
    (!arrival.saved || (arrival.saved.scope === scope && readCurrentReturn(arrival.saved))) &&
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
