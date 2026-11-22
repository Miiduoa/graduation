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
  previousMarker?: string | null;
  provisionalBoundary?: MenuReturnBoundary;
  publicLegacy?: true;
  // Keep the original binding when a legacy draft is restored before confirmation.
  legacyScope?: string;
};

type MenuReturnBoundary = Partial<Record<'campus' | 'schoolOwner' | 'platformOwner', string>>;

const ownerFields = ['schoolOwner', 'platformOwner'] as const;
const boundaryFields = ['campus', ...ownerFields] as const;

function boundaryChanged(previous: MenuReturnBoundary, next: MenuReturnBoundary, guest = false) {
  if (guest && ownerFields.some((field) => previous[field] !== undefined)) return true;
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
let acknowledgedToken: string | undefined;
let observedWindow: Window | undefined;
let activeScope: string | null | undefined;
let lastConfirmedScope: string | undefined;
let lastConfirmedGuest = false;
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

function currentSnapshot(state: unknown) {
  const token = marker(state);
  const marked = token ? snapshots.get(token) : undefined;
  if (marked) return matchesReturnUrl(marked) ? marked : undefined;
  // A rejected marker update leaves the origin at its previous marker (or none).
  return [...snapshots.values()].reverse().find(
    (snapshot) => snapshot.previousMarker === token && matchesReturnUrl(snapshot),
  );
}

function captureReturnState(state: unknown) {
  loadSnapshots();
  publish(currentSnapshot(state) ?? null);
}

function captureReturn(event: PopStateEvent) {
  captureReturnState(event.state);
}

function loadSnapshots(): boolean {
  let raw: string | null;
  try {
    // A cached document may resume after another document cleared this tab's drafts.
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (storedSnapshots === raw) return true;
  try {
    storedSnapshots = raw;
    snapshots.clear();
    const stored: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(stored)) return true;
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
        (snapshot.previousMarker === undefined || snapshot.previousMarker === null ||
          typeof snapshot.previousMarker === 'string') &&
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
    // Ignore malformed persisted data.
  }
  return true;
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
    acknowledgedToken = undefined;
    activeScope = undefined;
    lastConfirmedScope = undefined;
    lastConfirmedGuest = false;
    lastBoundary = undefined;
    storedSnapshots = undefined;
    // A new document can mount on the origin after the browser has already returned.
    const state = window.history.state;
    const navigation = window.performance.getEntriesByType?.('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (
      navigation?.type === 'back_forward' ||
      (marker(state) !== null && state?.[ACKNOWLEDGED_STATE_KEY] !== marker(state))
    ) {
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
export const isMenuReturnSuspended = () => activeScope === null;

export function restoreLegacyMenuReturn(pathname: string) {
  loadSnapshots();
  if (currentSnapshot(window.history.state)) return null;
  return restoreDirectorySearch('menu', pathname);
}

export function matchesKnownMenuReturnScope(scope: string) {
  return lastConfirmedScope === undefined || lastConfirmedScope === scope;
}

// Undefined keeps the known parts of the boundary while verification is outstanding.
export function setMenuReturnScope(
  scope: string | null | undefined,
  boundary?: MenuReturnBoundary,
  guest = false,
) {
  observeWindow();
  // A null scope with no boundary resets the document's in-memory binding.
  if (scope === null && !boundary) {
    lastConfirmedScope = undefined;
    lastConfirmedGuest = false;
    lastBoundary = undefined;
    activeScope = undefined;
    acknowledgedToken = undefined;
    publish(null);
    return false;
  }
  const nextBoundary = scope === null && boundary ? { campus: boundary.campus } : boundary;
  const changedBoundary = !!nextBoundary && !!lastBoundary &&
    (lastConfirmedScope === undefined
      ? boundaryChanged({ campus: lastBoundary.campus }, nextBoundary)
      : boundaryChanged(lastBoundary, nextBoundary));
  const missingOwner = !!nextBoundary && !!lastBoundary && !changedBoundary &&
    ownerFields.some(
      (field) => lastBoundary?.[field] !== undefined && nextBoundary[field] === undefined,
    ) &&
    !ownerFields.some(
      (field) => lastBoundary?.[field] === undefined && nextBoundary[field] !== undefined,
    );
  // A partial account can also mean that one identity source is unavailable.
  if (!guest && typeof scope === 'string' && missingOwner) scope = null;
  const changed =
    changedBoundary ||
    (lastConfirmedScope !== undefined &&
      ((guest && !lastConfirmedGuest) || (typeof scope === 'string' && lastConfirmedScope !== scope)));
  const previousScope = activeScope;
  activeScope = scope;
  if (typeof scope === 'string' || changed) {
    lastConfirmedScope = typeof scope === 'string' ? scope : undefined;
    lastConfirmedGuest = guest;
  }
  if (nextBoundary) {
    const previousBoundary = changed ? undefined : lastBoundary;
    lastBoundary = {
      campus: nextBoundary.campus ?? previousBoundary?.campus,
      schoolOwner: nextBoundary.schoolOwner ?? previousBoundary?.schoolOwner,
      platformOwner: nextBoundary.platformOwner ?? previousBoundary?.platformOwner,
    };
  }
  loadSnapshots();
  let invalidatedRestoredDraft = false;
  if (changed) {
    snapshots.clear();
    saveSnapshots();
    forgetDirectorySearch('menu');
  } else if (typeof scope === 'string' && previousScope !== scope) {
    let updated = false;
    for (const [token, snapshot] of snapshots) {
      const previous = snapshot.provisionalBoundary;
      if (
        previous &&
        (snapshot.legacyScope === undefined || snapshot.legacyScope === scope) &&
        !boundaryChanged(previous, boundary ?? {}, guest)
      ) {
        snapshot.scope = scope;
        delete snapshot.provisionalBoundary;
        delete snapshot.publicLegacy;
        delete snapshot.legacyScope;
        updated = true;
      } else if (snapshot.provisionalBoundary || snapshot.scope !== scope) {
        if (
          (snapshot.legacyScope !== undefined || snapshot.publicLegacy) &&
          (acknowledgedToken === token || window.history.state?.[ACKNOWLEDGED_STATE_KEY] === token)
        ) {
          invalidatedRestoredDraft = true;
        }
        snapshots.delete(token);
        updated = true;
      }
    }
    if (updated) saveSnapshots();
  } else if (scope === undefined && lastBoundary) {
    let updated = false;
    for (const [token, snapshot] of snapshots) {
      const previous = snapshot.provisionalBoundary;
      if (!previous) continue;
      if (boundaryChanged(previous, lastBoundary, guest)) {
        if (
          (snapshot.legacyScope !== undefined || snapshot.publicLegacy) &&
          (acknowledgedToken === token || window.history.state?.[ACKNOWLEDGED_STATE_KEY] === token)
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
  if (activeScope === null) return;
  loadSnapshots();
  const state = window.history.state;
  const snapshot = currentSnapshot(state);
  if (snapshot) {
    const staged = new Map(snapshots);
    staged.delete(snapshot.token);
    if (!saveSnapshots(staged)) return;
    snapshots.delete(snapshot.token);
    const token = marker(state);
    if (token) removeCurrentMarker(token);
  }
  if (restoreDirectorySearch('menu', window.location.pathname)) forgetDirectorySearch('menu');
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
  if (!loadSnapshots()) return;
  const state = window.history.state;
  const previousToken = marker(state);
  const previous = currentSnapshot(state);
  const provisional = activeScope === undefined;
  const legacy = provisional && !alreadyRestored
    ? restoreDirectorySearch('menu', window.location.pathname)
    : null;
  // Incomplete identity cannot replace a draft already bound to a confirmed scope.
  if (
    provisional &&
    ((previous && (previous.provisionalBoundary === undefined || previous.legacyScope !== undefined)) ||
      legacy?.scope !== undefined)
  ) return;
  // A fresh draft can be claimed on first confirmation, as with the old per-tab draft.
  // Retain the known boundary when a previously confirmed identity is being rechecked.
  const provisionalBoundary = alreadyRestored || lastConfirmedScope !== undefined
    ? { ...lastBoundary }
    : {};
  const token = window.crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${++sequence}`;
  const snapshot: MenuNavigationReturn = {
    ...draft,
    token,
    previousMarker: previousToken,
    urlDigest: returnUrlDigest(token, url),
    query: draft.query.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 100),
    expanded: [...draft.expanded],
    ...(provisional ? { provisionalBoundary } : {}),
    ...(provisional && legacyScope !== undefined
      ? { legacyScope }
      : provisional && alreadyRestored ? { publicLegacy: true } : {}),
  };
  const staged = new Map(snapshots);
  if (previous) staged.delete(previous.token);
  staged.set(token, snapshot);
  if (staged.size > MAX_SNAPSHOTS) {
    staged.delete(staged.keys().next().value!);
  }
  if (!saveSnapshots(staged)) return;
  snapshots.clear();
  for (const [key, value] of staged) snapshots.set(key, value);
  try {
    const nextState: Record<string, unknown> = { ...state, [MENU_RETURN_STATE_KEY]: token };
    delete nextState[ACKNOWLEDGED_STATE_KEY];
    if (alreadyRestored) nextState[ACKNOWLEDGED_STATE_KEY] = token;
    window.history.replaceState(nextState, '');
  } catch {
    // The stored draft still matches its origin if the marker cannot be updated.
  }
  acknowledgedToken = alreadyRestored ? token : undefined;
  if (
    alreadyRestored || legacy ||
    (!provisional && restoreDirectorySearch('menu', window.location.pathname, activeScope))
  ) {
    forgetDirectorySearch('menu');
  }
  publish(null);
}

/** Skip reopening on reload while keeping the draft available for future history returns. */
export function consumeMenuReturn(snapshot: MenuNavigationReturn, scope: string): boolean {
  const previous = snapshot.provisionalBoundary;
  const unverifiedLegacy = activeScope === undefined &&
    (snapshot.publicLegacy ||
      (snapshot.legacyScope !== undefined && matchesKnownMenuReturnScope(snapshot.legacyScope)));
  if (typeof activeScope !== 'string' && !unverifiedLegacy) return false;
  loadSnapshots();
  const confirmedDraft =
    activeScope === scope && snapshot.scope === scope && previous === undefined;
  if (
    pending !== snapshot ||
    snapshots.get(snapshot.token) !== snapshot ||
    (!unverifiedLegacy && !confirmedDraft) ||
    !matchesReturnUrl(snapshot) ||
    currentSnapshot(window.history.state) !== snapshot
  ) {
    if (pending === snapshot) publish(null);
    return false;
  }
  try {
    const state = window.history.state;
    if (state?.[ACKNOWLEDGED_STATE_KEY] !== snapshot.token) {
      window.history.replaceState({
        ...state,
        [MENU_RETURN_STATE_KEY]: snapshot.token,
        [ACKNOWLEDGED_STATE_KEY]: snapshot.token,
      }, '');
    }
  } catch {
    // The active document can still acknowledge the return in memory.
  }
  acknowledgedToken = snapshot.token;
  publish(null);
  return true;
}
