import { sha256 } from 'js-sha256';
import { SERVICE_CATEGORIES, type ServiceCategory } from './campusServices';
import {
  forgetDirectorySearch,
  internalSitePath,
  restoreDirectorySearch,
} from './campusDirectorySearch';

export const MENU_RETURN_STATE_KEY = '__campusServiceMenuReturn';
const ACKNOWLEDGED_STATE_KEY = '__campusServiceMenuReturnAcknowledged';
const STORAGE_KEY = 'campus.menu.return.v1';
const MAX_SNAPSHOTS = 20;

export type MenuNavigationReturn = {
  token: string;
  urlDigest: string;
  scope: string;
  query: string;
  category: ServiceCategory | 'all';
  expanded: string[];
  open?: boolean;
  provisionalBoundary?: MenuReturnBoundary;
  publicLegacy?: true;
  // Keep the original binding when a legacy draft is restored before confirmation.
  legacyScope?: string;
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

function returnUrlDigest(token: string, url: string) {
  // Bind the exact location to this entry without retaining its path, query or fragment.
  return sha256(JSON.stringify([token, url]));
}

function matchesReturnUrl(snapshot: MenuNavigationReturn) {
  return snapshot.urlDigest === returnUrlDigest(snapshot.token, currentMenuReturnUrl());
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
  publish(snapshot && matchesReturnUrl(snapshot) ? snapshot : null);
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
    const containsRawUrls = stored.some((snapshot) => snapshot && Object.hasOwn(snapshot, 'url'));
    for (const snapshot of stored.slice(-MAX_SNAPSHOTS)) {
      if (
        snapshot &&
        typeof snapshot.token === 'string' &&
        (typeof snapshot.url === 'string' ||
          (typeof snapshot.urlDigest === 'string' && /^[a-f0-9]{64}$/u.test(snapshot.urlDigest))) &&
        typeof snapshot.scope === 'string' &&
        typeof snapshot.query === 'string' &&
        (snapshot.category === 'all' ||
          SERVICE_CATEGORIES.some(({ id }) => id === snapshot.category)) &&
        Array.isArray(snapshot.expanded) &&
        snapshot.expanded.every((id: unknown) => typeof id === 'string') &&
        (snapshot.open === undefined || typeof snapshot.open === 'boolean') &&
        (snapshot.provisionalBoundary === undefined || validBoundary(snapshot.provisionalBoundary)) &&
        (snapshot.publicLegacy === undefined ||
          (snapshot.publicLegacy === true && snapshot.provisionalBoundary !== undefined)) &&
        (snapshot.legacyScope === undefined ||
          (typeof snapshot.legacyScope === 'string' && snapshot.provisionalBoundary !== undefined))
      ) {
        const { url, ...draft } = snapshot;
        if (typeof url === 'string') draft.urlDigest = returnUrlDigest(draft.token, url);
        snapshots.set(draft.token, draft);
      }
    }
    // Scrub URLs written by earlier versions, including entries outside the retention limit.
    if (containsRawUrls) saveSnapshots();
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
    const state = window.history.state;
    const navigation = window.performance.getEntriesByType?.('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigation?.type === 'back_forward' || state?.[ACKNOWLEDGED_STATE_KEY] !== marker(state)) {
      captureReturnState(state);
    }
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

export function matchesKnownMenuReturnScope(scope: string) {
  return lastConfirmedScope === undefined || lastConfirmedScope === scope;
}

// Undefined keeps the known parts of the boundary while verification is outstanding.
export function setMenuReturnScope(
  scope: string | null | undefined,
  boundary?: MenuReturnBoundary,
) {
  observeWindow();
  const changed =
    scope === null ||
    (lastConfirmedScope !== undefined &&
      !!boundary && !!lastBoundary && boundaryChanged(lastBoundary, boundary)) ||
    (typeof scope === 'string' && lastConfirmedScope !== undefined && lastConfirmedScope !== scope);
  const previousScope = activeScope;
  activeScope = scope;
  if (typeof scope === 'string' || changed) lastConfirmedScope = scope ?? undefined;
  if (scope === null) lastBoundary = undefined;
  else if (boundary) {
    const previousBoundary = changed ? undefined : lastBoundary;
    lastBoundary = {
      campus: boundary.campus ?? previousBoundary?.campus,
      schoolOwner: boundary.schoolOwner ?? previousBoundary?.schoolOwner,
      platformOwner: boundary.platformOwner ?? previousBoundary?.platformOwner,
    };
  }
  loadSnapshots();
  let invalidatedRestoredDraft = false;
  if (changed) {
    snapshots.clear();
    saveSnapshots();
    forgetDirectorySearch('menu');
  } else if (typeof scope === 'string' && previousScope !== scope) {
    for (const [token, snapshot] of snapshots) {
      const previous = snapshot.provisionalBoundary;
      if (
        previous &&
        (snapshot.legacyScope === undefined || snapshot.legacyScope === scope) &&
        (!boundary || !boundaryChanged(previous, boundary))
      ) {
        snapshot.scope = scope;
        delete snapshot.provisionalBoundary;
        delete snapshot.publicLegacy;
        delete snapshot.legacyScope;
      } else if (snapshot.provisionalBoundary || snapshot.scope !== scope) {
        if (
          (snapshot.legacyScope !== undefined || snapshot.publicLegacy) &&
          window.history.state?.[ACKNOWLEDGED_STATE_KEY] === token
        ) {
          invalidatedRestoredDraft = true;
        }
        snapshots.delete(token);
      }
    }
    saveSnapshots();
  } else if (scope === undefined && lastBoundary) {
    let updated = false;
    for (const [token, snapshot] of snapshots) {
      const previous = snapshot.provisionalBoundary;
      if (!previous) continue;
      if (boundaryChanged(previous, lastBoundary)) {
        if (
          (snapshot.legacyScope !== undefined || snapshot.publicLegacy) &&
          window.history.state?.[ACKNOWLEDGED_STATE_KEY] === token
        ) {
          invalidatedRestoredDraft = true;
        }
        snapshots.delete(token);
        updated = true;
      } else if ((snapshot.publicLegacy || snapshot.legacyScope !== undefined) && boundaryFields.some(
        (field) => previous[field] === undefined && lastBoundary?.[field] !== undefined,
      )) {
        snapshot.provisionalBoundary = {
          campus: previous.campus ?? lastBoundary.campus,
          schoolOwner: previous.schoolOwner ?? lastBoundary.schoolOwner,
          platformOwner: previous.platformOwner ?? lastBoundary.platformOwner,
        };
        updated = true;
      }
    }
    if (updated) saveSnapshots();
  }
  if (pending && !snapshots.has(pending.token)) publish(null);
  return changed || invalidatedRestoredDraft;
}

function removeCurrentMarker(token: string) {
  if (marker(window.history.state) !== token) return;
  try {
    const state = { ...window.history.state };
    delete state[MENU_RETURN_STATE_KEY];
    delete state[ACKNOWLEDGED_STATE_KEY];
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
  alreadyRestored = false,
  legacyScope?: string,
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
  const previous = previousToken ? snapshots.get(previousToken) : undefined;
  const legacy = activeScope === undefined && !alreadyRestored
    ? restoreDirectorySearch('menu', window.location.pathname)
    : null;
  // Incomplete identity cannot replace a draft already bound to a confirmed scope.
  if (
    activeScope === undefined &&
    ((previous && (previous.provisionalBoundary === undefined || previous.legacyScope !== undefined)) ||
      legacy?.scope !== undefined)
  ) return;
  // A fresh draft can be claimed on first confirmation, as with the old per-tab draft.
  // Retain the known boundary when a previously confirmed identity is being rechecked.
  const provisionalBoundary = alreadyRestored || lastConfirmedScope !== undefined ? { ...lastBoundary } : {};
  const token = window.crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}`;
  const snapshot: MenuNavigationReturn = {
    ...draft,
    token,
    urlDigest: returnUrlDigest(token, url),
    query: draft.query.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100),
    expanded: [...draft.expanded],
    ...(activeScope === undefined ? { provisionalBoundary } : {}),
    ...(activeScope === undefined && legacyScope !== undefined
      ? { legacyScope }
      : activeScope === undefined && alreadyRestored ? { publicLegacy: true } : {}),
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
    const nextState: Record<string, unknown> = { ...state, [MENU_RETURN_STATE_KEY]: token };
    delete nextState[ACKNOWLEDGED_STATE_KEY];
    if (alreadyRestored) nextState[ACKNOWLEDGED_STATE_KEY] = token;
    window.history.replaceState(nextState, '');
  } catch {
    saveSnapshots();
    return;
  }
  const replacedPrevious = previousToken !== null && staged.delete(previousToken);
  snapshots.clear();
  for (const [key, value] of staged) snapshots.set(key, value);
  if (replacedPrevious) saveSnapshots();
  if (alreadyRestored || activeScope !== undefined || legacy) forgetDirectorySearch('menu');
  publish(null);
}

/** Skip reopening on reload while keeping the draft available for future history returns. */
export function consumeMenuReturn(snapshot: MenuNavigationReturn, scope: string): boolean {
  const unverifiedLegacy = activeScope === undefined &&
    (snapshot.publicLegacy ||
      (snapshot.legacyScope !== undefined && matchesKnownMenuReturnScope(snapshot.legacyScope)));
  if (typeof activeScope !== 'string' && !unverifiedLegacy) return false;
  loadSnapshots();
  const confirmedDraft =
    activeScope === scope && snapshot.provisionalBoundary === undefined && snapshot.scope === scope;
  if (
    pending !== snapshot ||
    snapshots.get(snapshot.token) !== snapshot ||
    (!unverifiedLegacy && !confirmedDraft) ||
    !matchesReturnUrl(snapshot) ||
    marker(window.history.state) !== snapshot.token
  ) {
    if (pending === snapshot) publish(null);
    return false;
  }
  try {
    const state = window.history.state;
    if (state[ACKNOWLEDGED_STATE_KEY] !== snapshot.token) {
      window.history.replaceState({ ...state, [ACKNOWLEDGED_STATE_KEY]: snapshot.token }, '');
    }
  } catch {
    // The active document can still acknowledge the return in memory.
  }
  publish(null);
  return true;
}
