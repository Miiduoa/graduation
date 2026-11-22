import type { ServiceCategory } from './campusServices';
import { internalSitePath } from './campusDirectorySearch';

export const MENU_RETURN_STATE_KEY = '__campusServiceMenuReturn';

export type MenuNavigationReturn = {
  token: string;
  url: string;
  scope: string;
  query: string;
  category: ServiceCategory | 'all';
  expanded: string[];
};

// Menu drafts belong to this document, never to storage or a future reload.
// History carries only an opaque marker; the account binding is already hashed.
const snapshots = new Map<string, MenuNavigationReturn>();
const listeners = new Set<() => void>();
let pending: MenuNavigationReturn | null = null;
let observedWindow: Window | undefined;
let activeScope: string | null = null;
let sequence = 0;

export function currentMenuReturnUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function marker(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const token = (state as Record<string, unknown>)[MENU_RETURN_STATE_KEY];
  return typeof token === 'string' ? token : null;
}

function publish(value: MenuNavigationReturn | null) {
  if (pending === value) return;
  pending = value;
  listeners.forEach((listener) => listener());
}

function captureReturn(event: PopStateEvent) {
  const token = marker(event.state);
  const snapshot = token ? snapshots.get(token) : null;
  publish(
    snapshot && snapshot.url === currentMenuReturnUrl() && snapshot.scope === activeScope
      ? snapshot
      : null,
  );
}

function observeWindow() {
  if (observedWindow !== window) {
    observedWindow?.removeEventListener('popstate', captureReturn);
    observedWindow = window;
    snapshots.clear();
    pending = null;
    activeScope = null;
    // Keep observing while a destination without this header is mounted. Only
    // the returning menu can restore UI; this listener never changes focus.
    window.addEventListener('popstate', captureReturn);
  }
}

export function subscribeMenuReturn(listener: () => void) {
  observeWindow();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getMenuReturn = () => pending;
export const getServerMenuReturn = () => null;

export function setMenuReturnScope(scope: string | null) {
  observeWindow();
  if (activeScope === scope) return;
  activeScope = scope;
  snapshots.clear();
  publish(null);
}

function removeCurrentMarker(token: string) {
  if (marker(window.history.state) !== token) return;
  try {
    const state = { ...window.history.state };
    delete state[MENU_RETURN_STATE_KEY];
    // No URL change: retain the router's own fields exactly as they are.
    window.history.replaceState(state, '');
  } catch {
    // A stale marker cannot restore anything after its memory snapshot is gone.
  }
}

export function discardMenuReturn() {
  const token = marker(window.history.state);
  if (token) {
    snapshots.delete(token);
    removeCurrentMarker(token);
  }
  publish(null);
}

export function rememberMenuReturn(
  destination: string,
  draft: Pick<MenuNavigationReturn, 'scope' | 'query' | 'category' | 'expanded'>,
) {
  discardMenuReturn();
  const safeDestination = internalSitePath(destination);
  const url = currentMenuReturnUrl();
  if (!safeDestination || safeDestination === url || draft.scope !== activeScope) return;
  const token = `${Date.now().toString(36)}-${++sequence}`;
  const snapshot: MenuNavigationReturn = {
    ...draft,
    token,
    url,
    query: draft.query.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100),
    expanded: [...draft.expanded],
  };
  try {
    window.history.replaceState({ ...window.history.state, [MENU_RETURN_STATE_KEY]: token }, '');
    snapshots.set(token, snapshot);
    // A tab only needs a small number of pending menu journeys.
    while (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
  } catch {
    // History can be unavailable; opening the destination must still work.
  }
}

/** Consume only after the route and rendered menu have caught up with popstate. */
export function consumeMenuReturn(snapshot: MenuNavigationReturn, scope: string): boolean {
  if (
    pending !== snapshot ||
    snapshots.get(snapshot.token) !== snapshot ||
    snapshot.scope !== scope ||
    snapshot.url !== currentMenuReturnUrl() ||
    marker(window.history.state) !== snapshot.token
  ) {
    if (pending === snapshot) publish(null);
    return false;
  }
  snapshots.delete(snapshot.token);
  removeCurrentMarker(snapshot.token);
  publish(null);
  return true;
}
