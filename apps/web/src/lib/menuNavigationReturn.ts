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
  provisionalBoundary?: MenuReturnBoundary;
};

type MenuReturnBoundary = Partial<Record<'campus' | 'schoolOwner' | 'platformOwner', string>>;

const boundaryFields = ['campus', 'schoolOwner', 'platformOwner'] as const;

function boundaryChanged(previous: MenuReturnBoundary, next: MenuReturnBoundary) {
  return boundaryFields.some(
    (field) =>
      previous[field] !== undefined && next[field] !== undefined && previous[field] !== next[field],
  );
}

function validBoundary(value: unknown): value is MenuReturnBoundary {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    boundaryFields.every((field) => {
      const entry = (value as Record<string, unknown>)[field];
      return entry === undefined || typeof entry === 'string';
    })
  );
}

// History carries only an opaque marker. The tab stores drafts with a hashed scope.
const snapshots = new Map<string, MenuNavigationReturn>();
const listeners = new Set<() => void>();
let pending: MenuNavigationReturn | null = null;
let observedWindow: Window | undefined;
let activeScope: string | null | undefined;
let lastConfirmedScope: string | undefined;
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
        (snapshot.open === undefined || typeof snapshot.open === 'boolean') &&
        (snapshot.provisionalBoundary === undefined || validBoundary(snapshot.provisionalBoundary))
      ) {
        snapshots.set(snapshot.token, snapshot);
      }
    }
  } catch {
    // The in-memory drafts still work when storage is unavailable.
  }
}

function saveSnapshots(drafts = snapshots): boolean {
  try {
    if (drafts.size) {
      const raw = JSON.stringify([...drafts.values()]);
      window.sessionStorage.setItem(STORAGE_KEY, raw);
      storedSnapshots = raw;
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
      storedSnapshots = null;
    }
    return true;
  } catch {
    return false;
  }
}

function observeWindow() {
  if (observedWindow !== window) {
    observedWindow?.removeEventListener('popstate', captureReturn);
    observedWindow = window;
    snapshots.clear();
    pending = null;
    activeScope = undefined;
    lastConfirmedScope = undefined;
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

// Undefined keeps the known parts of the boundary while verification is outstanding.
export function setMenuReturnScope(
  scope: string | null | undefined,
  boundary?: MenuReturnBoundary,
) {
  observeWindow();
  const changed =
    scope === null ||
    (!!boundary && !!lastBoundary && boundaryChanged(lastBoundary, boundary)) ||
    (typeof scope === 'string' && lastConfirmedScope !== undefined && lastConfirmedScope !== scope);
  const previousScope = activeScope;
  activeScope = scope;
  if (typeof scope === 'string' || changed) lastConfirmedScope = scope ?? undefined;
  if (scope === null) lastBoundary = undefined;
  else if (boundary) {
    lastBoundary = {
      campus: boundary.campus ?? lastBoundary?.campus,
      schoolOwner: boundary.schoolOwner ?? lastBoundary?.schoolOwner,
      platformOwner: boundary.platformOwner ?? lastBoundary?.platformOwner,
    };
  }
  if (!changed && (scope === undefined || previousScope === scope)) return false;

  loadSnapshots();
  if (changed) {
    snapshots.clear();
    saveSnapshots();
    forgetDirectorySearch('menu');
  } else if (typeof scope === 'string') {
    for (const [token, snapshot] of snapshots) {
      if (
        snapshot.provisionalBoundary &&
        boundary &&
        !boundaryChanged(snapshot.provisionalBoundary, boundary)
      ) {
        snapshot.scope = scope;
        delete snapshot.provisionalBoundary;
      } else if (snapshot.provisionalBoundary || snapshot.scope !== scope) {
        snapshots.delete(token);
      }
    }
    saveSnapshots();
  }
  if (pending && !snapshots.has(pending.token)) publish(null);
  return changed;
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
  const safeDestination = internalSitePath(destination);
  const url = currentMenuReturnUrl();
  if (
    !safeDestination ||
    safeDestination === url ||
    activeScope === null ||
    (activeScope !== undefined && draft.scope !== activeScope)
  )
    return;
  loadSnapshots();
  const state = window.history.state;
  const previousToken = marker(state);
  const token = window.crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}`;
  const snapshot: MenuNavigationReturn = {
    ...draft,
    token,
    url,
    query: draft.query.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100),
    expanded: [...draft.expanded],
    ...(activeScope === undefined ? { provisionalBoundary: lastBoundary ?? {} } : {}),
  };
  // Keep the old snapshot until both the storage write and the history update succeed.
  const staged = new Map(snapshots);
  staged.set(token, snapshot);
  if (staged.size > MAX_SNAPSHOTS) {
    const oldest = [...snapshots.keys()].find((key) => key !== previousToken);
    if (oldest) staged.delete(oldest);
  }
  if (!saveSnapshots(staged)) return;
  try {
    window.history.replaceState({ ...state, [MENU_RETURN_STATE_KEY]: token }, '');
  } catch {
    saveSnapshots();
    return;
  }
  const replacedPrevious = previousToken !== null && staged.delete(previousToken);
  snapshots.clear();
  for (const [key, value] of staged) snapshots.set(key, value);
  if (replacedPrevious) saveSnapshots();
  forgetDirectorySearch('menu');
  publish(null);
}

/** Acknowledge this return after the route catches up, keeping the entry for future returns. */
export function consumeMenuReturn(snapshot: MenuNavigationReturn, scope: string): boolean {
  if (typeof activeScope !== 'string') return false;
  loadSnapshots();
  if (
    pending !== snapshot ||
    snapshots.get(snapshot.token) !== snapshot ||
    activeScope !== scope ||
    snapshot.provisionalBoundary !== undefined ||
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
