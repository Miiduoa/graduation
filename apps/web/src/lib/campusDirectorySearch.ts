import { sanitizeInternalPath } from './navigation';
import { CAMPUS_SERVICES, SERVICE_CATEGORIES, type ServiceCategory } from './campusServices';

export const DIRECTORY_SEARCH_STORAGE_KEY = 'campus.directory.search.v1';
export const DIRECTORY_SEARCH_MAX_QUERY = 160;

export type DirectorySearchSource = 'menu' | 'quick' | 'search';

export type DirectoryDraftBinding = {
  campus?: string;
  schoolOwner?: string;
  platformOwner?: string;
  guest?: true;
};

export const directoryDraftOwners = ['schoolOwner', 'platformOwner'] as const;

export function matchDirectoryDraft(
  saved: DirectoryDraftBinding,
  current: DirectoryDraftBinding,
): 'restore' | 'wait' | 'clear' {
  if (saved.campus !== undefined && current.campus !== undefined && saved.campus !== current.campus)
    return 'clear';
  const hasOwner = directoryDraftOwners.some((field) => saved[field] !== undefined);
  if (
    (hasOwner && current.guest) ||
    (saved.guest && directoryDraftOwners.some((field) => current[field] !== undefined)) ||
    directoryDraftOwners.some((field) =>
      saved[field] !== undefined && current[field] !== undefined && saved[field] !== current[field],
    )
  ) return 'clear';
  if (current.campus === undefined) return 'wait';
  if (!hasOwner || directoryDraftOwners.some((field) =>
    saved[field] !== undefined && saved[field] === current[field],
  )) return 'restore';
  return 'wait';
}

export function mergeDraftBinding(saved: DirectoryDraftBinding, current: DirectoryDraftBinding): DirectoryDraftBinding {
  return {
    campus: current.campus ?? saved.campus,
    schoolOwner: current.schoolOwner ?? saved.schoolOwner,
    platformOwner: current.platformOwner ?? saved.platformOwner,
    guest: current.guest,
  };
}

export function validDirectoryDraftBinding(value: unknown): value is DirectoryDraftBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (binding.guest === undefined || binding.guest === true) &&
    (['campus', ...directoryDraftOwners] as const).every(
      (field) => binding[field] === undefined || typeof binding[field] === 'string',
    );
}

export type DirectorySearchSnapshot = {
  path: string;
  destination: string;
  query: string;
  category: ServiceCategory | 'all';
  open: boolean;
  /** Optional opaque account/campus binding. Unscoped callers keep their existing behavior. */
  scope?: string;
  expanded?: string[];
  binding?: DirectoryDraftBinding;
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
    (item.binding === undefined || validDirectoryDraftBinding(item.binding)) &&
    (item.scope === undefined || (typeof item.scope === 'string' && item.scope.length <= 1024))
  );
}

function readStore(): DirectorySearchStore | null {
  if (typeof window === 'undefined') return {};
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return {};
  try {
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
    binding?: DirectoryDraftBinding;
  },
): void {
  const path = internalPathname(snapshot.path);
  const destination = internalSitePath(snapshot.destination);
  if (!path || !destination) return;
  const store = readStore();
  if (!store) return;
  const previous = store[source];
  if (snapshot.binding && !snapshot.binding.guest &&
      !directoryDraftOwners.some((field) => snapshot.binding?.[field] !== undefined)) {
    if (previous?.binding && matchDirectoryDraft(previous.binding, snapshot.binding) === 'wait') return;
    if (previous?.scope !== undefined && !previous.binding) return;
  }
  store[source] = {
    path,
    destination,
    query: sanitizeQuery(snapshot.query),
    category: isCategory(snapshot.category) ? snapshot.category : 'all',
    open: snapshot.open !== false,
    ...(snapshot.scope !== undefined ? { scope: snapshot.scope.slice(0, 1024) } : {}),
    ...(snapshot.binding ? { binding:
      previous?.binding && matchDirectoryDraft(previous.binding, snapshot.binding) === 'restore'
        ? mergeDraftBinding(previous.binding, snapshot.binding)
        : snapshot.binding,
    } : {}),
    ...(safeExpanded(snapshot.expanded).length ? { expanded: safeExpanded(snapshot.expanded) } : {}),
  };
  writeStore(store);
}

export function forgetDirectorySearch(source: DirectorySearchSource, scope?: string): void {
  const store = readStore();
  if (!store || !(source in store)) return;
  if (scope !== undefined && store[source]?.scope !== scope) return;
  delete store[source];
  writeStore(store);
}

export function restoreDirectorySearch(
  source: DirectorySearchSource,
  currentPath: string,
  scope?: string,
  binding?: DirectoryDraftBinding,
  fullyVerified = true,
): DirectorySearchSnapshot | null {
  const current = internalPathname(currentPath);
  if (!current) return null;
  const snapshot = readStore()?.[source];
  if (!snapshot) return null;
  const decision = binding && snapshot.binding
    ? matchDirectoryDraft(snapshot.binding, binding)
    : scope === undefined || snapshot.scope === scope || (binding && snapshot.scope === undefined)
      ? 'restore'
      : fullyVerified ? 'clear' : 'wait';
  if (decision === 'clear') forgetDirectorySearch(source);
  if (decision !== 'restore') return null;
  const path = internalPathname(snapshot.path);
  const destination = internalSitePath(snapshot.destination);
  if (!path || !destination || path !== snapshot.path || destination !== snapshot.destination) {
    forgetDirectorySearch(source);
    return null;
  }
  if (path !== current) return null;
  if (binding && scope !== undefined) rememberDirectorySearch(source, { ...snapshot, scope, binding });
  return {
    path,
    destination,
    query: sanitizeQuery(snapshot.query),
    category: snapshot.category,
    open: snapshot.open,
    ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),
    ...(safeExpanded(snapshot.expanded).length ? { expanded: safeExpanded(snapshot.expanded) } : {}),
    ...(snapshot.binding ? { binding: snapshot.binding } : {}),
  };
}
