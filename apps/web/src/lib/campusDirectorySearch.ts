import { sanitizeInternalPath } from './navigation';
import { CAMPUS_SERVICES, SERVICE_CATEGORIES, type ServiceCategory } from './campusServices';

export const DIRECTORY_SEARCH_STORAGE_KEY = 'campus.directory.search.v1';
export const DIRECTORY_SEARCH_MAX_QUERY = 160;

export type DirectorySearchSource = 'menu' | 'quick' | 'search';

export type DirectorySearchSnapshot = {
  path: string;
  destination: string;
  query: string;
  category: ServiceCategory | 'all';
  open: boolean;
  /** Optional opaque account/campus binding. Unscoped callers keep their existing behavior. */
  scope?: string;
  expanded?: string[];
};

type DirectorySearchStore = Partial<Record<DirectorySearchSource, DirectorySearchSnapshot>>;

const sectionIds = new Set([
  ...SERVICE_CATEGORIES.map((category) => `group:${category.id}`),
  ...CAMPUS_SERVICES.map((service) => `service:${service.href}`),
]);

function safeExpanded(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && sectionIds.has(id)))].slice(0, 50);
}

export function expandedDirectorySections(container: Element | null): string[] {
  return safeExpanded(Array.from(container?.querySelectorAll('details[open][data-directory-section]') ?? [])
    .map((element) => element.getAttribute('data-directory-section')));
}

function isCategory(value: unknown): value is ServiceCategory | 'all' {
  return value === 'all' || SERVICE_CATEGORIES.some((item) => item.id === value);
}

function sanitizeQuery(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, DIRECTORY_SEARCH_MAX_QUERY);
}

/** Keep only same-origin site paths. Off-site, protocol-relative and control characters are dropped. */
export function internalSitePath(value: string | null | undefined): string {
  if (!value) return '';
  const safe = sanitizeInternalPath(value, '');
  if (!safe) return '';
  try {
    const url = new URL(safe, 'https://campus.local');
    if (url.origin !== 'https://campus.local') return '';
    return safe;
  } catch {
    return '';
  }
}

function internalPathname(value: string | null | undefined): string {
  const safe = internalSitePath(value);
  if (!safe) return '';
  return new URL(safe, 'https://campus.local').pathname;
}

function isSnapshot(value: unknown): value is DirectorySearchSnapshot {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === 'string' &&
    typeof item.destination === 'string' &&
    typeof item.query === 'string' &&
    isCategory(item.category) &&
    typeof item.open === 'boolean' &&
    (item.scope === undefined || (typeof item.scope === 'string' && item.scope.length <= 1024))
  );
}

function readStore(): DirectorySearchStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const store: DirectorySearchStore = {};
    for (const source of ['menu', 'quick', 'search'] as const) {
      const snapshot = (parsed as DirectorySearchStore)[source];
      if (isSnapshot(snapshot)) store[source] = snapshot;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: DirectorySearchStore): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(store).length === 0) sessionStorage.removeItem(DIRECTORY_SEARCH_STORAGE_KEY);
    else sessionStorage.setItem(DIRECTORY_SEARCH_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage 不可用時略過；搜尋畫面本身仍可使用。
  }
}

export function rememberDirectorySearch(
  source: DirectorySearchSource,
  snapshot: {
    path: string;
    destination: string;
    query: string;
    category?: ServiceCategory | 'all';
    open?: boolean;
    scope?: string;
    expanded?: string[];
  },
  preserveScopeMismatch = false,
): void {
  const path = internalPathname(snapshot.path);
  const destination = internalSitePath(snapshot.destination);
  if (!path || !destination) return;
  const store = readStore();
  const previousScope = store[source]?.scope;
  if (preserveScopeMismatch && previousScope !== undefined && previousScope !== snapshot.scope) {
    return;
  }
  store[source] = {
    path,
    destination,
    query: sanitizeQuery(snapshot.query),
    category: isCategory(snapshot.category) ? snapshot.category : 'all',
    open: snapshot.open !== false,
    ...(snapshot.scope !== undefined ? { scope: snapshot.scope.slice(0, 1024) } : {}),
    ...(safeExpanded(snapshot.expanded).length ? { expanded: safeExpanded(snapshot.expanded) } : {}),
  };
  writeStore(store);
}

export function forgetDirectorySearch(source: DirectorySearchSource, scope?: string): void {
  const store = readStore();
  if (!(source in store)) return;
  if (scope !== undefined && store[source]?.scope !== scope) return;
  delete store[source];
  writeStore(store);
}

export function restoreDirectorySearch(
  source: DirectorySearchSource,
  currentPath: string,
  scope?: string,
  preserveScopeMismatch = false,
): DirectorySearchSnapshot | null {
  const current = internalPathname(currentPath);
  if (!current) return null;
  const snapshot = readStore()[source];
  if (!snapshot) return null;
  if (scope !== undefined && snapshot.scope !== scope) {
    if (!preserveScopeMismatch) forgetDirectorySearch(source);
    return null;
  }
  const path = internalPathname(snapshot.path);
  const destination = internalSitePath(snapshot.destination);
  if (!path || !destination || path !== snapshot.path || destination !== snapshot.destination) {
    forgetDirectorySearch(source);
    return null;
  }
  if (path !== current) return null;
  return {
    path,
    destination,
    query: sanitizeQuery(snapshot.query),
    category: snapshot.category,
    open: snapshot.open,
    ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),
    ...(safeExpanded(snapshot.expanded).length ? { expanded: safeExpanded(snapshot.expanded) } : {}),
  };
}
