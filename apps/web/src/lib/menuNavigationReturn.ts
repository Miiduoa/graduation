import { SERVICE_CATEGORIES, type ServiceCategory } from './campusServices';
import { forgetDirectorySearch, internalSitePath } from './campusDirectorySearch';

export const MENU_RETURN_STATE_KEY = '__campusServiceMenuReturn';
const STORAGE_KEY = 'campus.menu.return.v1';
const MAX_SNAPSHOTS = 20;

export type MenuNavigationReturn = {
  token: string;
  url: string;
  scope: string;
  query: string;
  category: ServiceCategory | 'all';
  expanded: string[];
  open?: boolean;
};

type MenuReturnBoundary = {
  campus: string;
  schoolOwner: string | undefined;
  platformOwner: string | undefined;
};

// History carries only an opaque marker. The tab stores drafts with a hashed scope.
const snapshots = new Map<string, MenuNavigationReturn>();
const listeners = new Set<() => void>();
let pending: MenuNavigationReturn | null = null;
let observedWindow: Window | undefined;
let activeScope: string | null | undefined;
let scopeConfirmed = false;
let lastBoundary: MenuReturnBoundary | undefined;
let storedSnapshots: string | null | undefined;
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

function captureReturnState(state: unknown) {
  loadSnapshots();
  const token = marker(state);
  const snapshot = token ? snapshots.get(token) : null;
  publish(snapshot && snapshot.url === currentMenuReturnUrl() ? snapshot : null);
}

function captureReturn(event: PopStateEvent) {
  captureReturnState(event.state);
}

function loadSnapshots() {
  try {
    // A cached document may resume after another document cleared this tab's drafts.
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (storedSnapshots === raw) return;
    storedSnapshots = raw;
    snapshots.clear();
    const stored: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(stored)) return;
    for (const snapshot of stored.slice(-MAX_SNAPSHOTS)) {
      if (
        snapshot &&
        typeof snapshot.token === 'string' &&
        typeof snapshot.url === 'string' &&
        typeof snapshot.scope === 'string' &&
        typeof snapshot.query === 'string' &&
        (snapshot.category === 'all' ||
          SERVICE_CATEGORIES.some(({ id }) => id === snapshot.category)) &&
        Array.isArray(snapshot.expanded) &&
        snapshot.expanded.every((id: unknown) => typeof id === 'string') &&
        (snapshot.open === undefined || typeof snapshot.open === 'boolean')
      ) {
        snapshots.set(snapshot.token, snapshot);
      }
    }
  } catch {
    // The in-memory drafts still work when storage is unavailable.
  }
}

function saveSnapshots() {
  try {
    if (snapshots.size) {
      const raw = JSON.stringify([...snapshots.values()]);
      window.sessionStorage.setItem(STORAGE_KEY, raw);
      storedSnapshots = raw;
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
      storedSnapshots = null;
    }
  } catch {
    // The in-memory drafts still work when storage is unavailable.
  }
}

function observeWindow() {
  if (observedWindow !== window) {
    observedWindow?.removeEventListener('popstate', captureReturn);
    observedWindow = window;
    snapshots.clear();
    pending = null;
    activeScope = undefined;
    scopeConfirmed = false;
    lastBoundary = undefined;
    storedSnapshots = undefined;
    // A new document can mount on the origin after the browser has already returned.
    captureReturnState(window.history.state);
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

// undefined means verification is outstanding. null explicitly invalidates the draft.
export function setMenuReturnScope(scope: string | null | undefined, boundary?: MenuReturnBoundary) {
  observeWindow();
  scopeConfirmed = typeof scope === 'string';
  let boundaryChanged = false;
  if (boundary) {
    const { campus, schoolOwner, platformOwner } = boundary;
    boundaryChanged =
      !!lastBoundary &&
      (lastBoundary.campus !== campus ||
        (schoolOwner !== undefined &&
          lastBoundary.schoolOwner !== undefined &&
          schoolOwner !== lastBoundary.schoolOwner) ||
        (platformOwner !== undefined &&
          lastBoundary.platformOwner !== undefined &&
          platformOwner !== lastBoundary.platformOwner));
    // Keep the last known owner for each source until it can be verified again.
    lastBoundary = {
      campus,
      schoolOwner: schoolOwner ?? lastBoundary?.schoolOwner,
      platformOwner: platformOwner ?? lastBoundary?.platformOwner,
    };
  }
  if (scope === null) lastBoundary = undefined;
  if (!boundaryChanged && (scope === undefined || activeScope === scope)) return;
  loadSnapshots();
  const previousScope = activeScope;
  activeScope = scope ?? null;
  if (boundaryChanged || previousScope != null || scope === null) {
    snapshots.clear();
    saveSnapshots();
    forgetDirectorySearch('menu');
  } else {
    for (const [token, snapshot] of snapshots) {
      if (snapshot.scope !== scope) snapshots.delete(token);
    }
    saveSnapshots();
  }
  if (pending && !snapshots.has(pending.token)) publish(null);
}

function removeCurrentMarker(token: string) {
  if (marker(window.history.state) !== token) return;
  try {
    const state = { ...window.history.state };
    delete state[MENU_RETURN_STATE_KEY];
    // No URL change: retain the router's own fields exactly as they are.
    window.history.replaceState(state, '');
  } catch {
    // A stale marker cannot restore anything after its snapshot is gone.
  }
}

export function discardMenuReturn() {
  loadSnapshots();
  const token = marker(window.history.state);
  if (token) {
    snapshots.delete(token);
    saveSnapshots();
    removeCurrentMarker(token);
  }
  forgetDirectorySearch('menu');
  publish(null);
}

export function rememberMenuReturn(
  destination: string,
  draft: Pick<MenuNavigationReturn, 'scope' | 'query' | 'category' | 'expanded' | 'open'>,
) {
  if (!scopeConfirmed) return;
  discardMenuReturn();
  const safeDestination = internalSitePath(destination);
  const url = currentMenuReturnUrl();
  if (!safeDestination || safeDestination === url || draft.scope !== activeScope) return;
  const token = window.crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}`;
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
    while (snapshots.size > MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
    saveSnapshots();
  } catch {
    // History can be unavailable; opening the destination must still work.
  }
}

/** Acknowledge this return after the route catches up, keeping the entry for future returns. */
export function consumeMenuReturn(snapshot: MenuNavigationReturn, scope: string): boolean {
  if (!scopeConfirmed) return false;
  loadSnapshots();
  if (
    pending !== snapshot ||
    snapshots.get(snapshot.token) !== snapshot ||
    activeScope !== scope ||
    snapshot.scope !== scope ||
    snapshot.url !== currentMenuReturnUrl() ||
    marker(window.history.state) !== snapshot.token
  ) {
    if (pending === snapshot) publish(null);
    return false;
  }
  publish(null);
  return true;
}
