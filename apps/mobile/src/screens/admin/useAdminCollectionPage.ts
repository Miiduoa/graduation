import { useCallback, useEffect, useRef, useState } from 'react';
/* eslint-disable no-restricted-imports -- school-scoped cursor queries are isolated in this loader */
import {
  type QueryConstraint,
  type QueryDocumentSnapshot,
  getDocs,
  limit,
  query,
  startAfter,
} from 'firebase/firestore';
/* eslint-enable no-restricted-imports */

export type AdminCollectionPageState<T extends { id: string }> = {
  scope: string;
  items: T[];
  cursor: QueryDocumentSnapshot | null;
  busy: boolean;
  error: boolean;
  permissionDenied: boolean;
  errorMessage: string | null;
};

export type UseAdminCollectionPageOptions<T extends { id: string }> = {
  schoolId: string;
  uid: string;
  /** Must be true for admin or editor; false skips queries and clears visible rows. */
  canAccess: boolean;
  /** Extra fencing (e.g. role label / demo); changes invalidate in-flight pages. */
  fenceKey?: string;
  demoItems?: T[];
  pageSize: number;
  /** Build stable order/filter constraints (no limit / startAfter). */
  buildConstraints: () => QueryConstraint[];
  /** Collection reference factory; keep school-scoped. */
  getCollection: () => Parameters<typeof query>[0];
  /**
   * Map raw page docs → items. Cursor always comes from the last raw snapshot,
   * even if enrichment filters or reorders mapped rows.
   */
  mapDocs: (docs: QueryDocumentSnapshot[]) => Promise<T[]> | T[];
};

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  return (
    code === 'permission-denied' ||
    code === 'PERMISSION_DENIED' ||
    /permission-denied|missing or insufficient permissions/i.test(message)
  );
}

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (message) return message;
  }
  return '載入失敗';
}

/**
 * School-scoped cursor pagination for announcements, members and audit history.
 * Permission denial clears private rows; departed sessions cannot apply late pages.
 */
export function useAdminCollectionPage<T extends { id: string }>(
  options: UseAdminCollectionPageOptions<T>,
) {
  const {
    schoolId,
    uid,
    canAccess,
    fenceKey = '',
    demoItems,
    pageSize,
    buildConstraints,
    getCollection,
    mapDocs,
  } = options;

  const scope = JSON.stringify([schoolId, uid, canAccess, fenceKey, Boolean(demoItems), pageSize]);
  const active = useRef({ scope });
  if (active.current.scope !== scope) active.current = { scope };

  const request = useRef(0);
  const lock = useRef<object | null>(null);
  const buildConstraintsRef = useRef(buildConstraints);
  buildConstraintsRef.current = buildConstraints;
  const getCollectionRef = useRef(getCollection);
  getCollectionRef.current = getCollection;
  const mapDocsRef = useRef(mapDocs);
  mapDocsRef.current = mapDocs;

  const [state, setState] = useState<AdminCollectionPageState<T>>({
    scope,
    items: [],
    cursor: null,
    busy: true,
    error: false,
    permissionDenied: false,
    errorMessage: null,
  });
  const latest = useRef(state);
  latest.current = state;

  const load = useCallback(
    async (more = false) => {
      const context = active.current;
      if (more) {
        // Same-scope concurrent page requests stay locked.
        if (lock.current === context) return;
      } else {
        // Reload supersedes an in-flight more/reload for this scope.
        lock.current = null;
      }
      lock.current = context;
      const token = ++request.current;
      const current = () => active.current === context && token === request.current;
      const previous =
        latest.current.scope === scope
          ? latest.current
          : {
              items: [] as T[],
              cursor: null as QueryDocumentSnapshot | null,
              permissionDenied: false,
              errorMessage: null as string | null,
            };

      setState({
        scope,
        items: more ? previous.items : [],
        cursor: more ? previous.cursor : null,
        busy: true,
        error: false,
        permissionDenied: false,
        errorMessage: null,
      });

      try {
        if (!canAccess || !uid || !schoolId) {
          if (current()) {
            setState({
              scope,
              items: [],
              cursor: null,
              busy: false,
              error: false,
              permissionDenied: false,
              errorMessage: null,
            });
          }
          return;
        }

        if (demoItems) {
          if (current()) {
            setState({
              scope,
              items: demoItems,
              cursor: null,
              busy: false,
              error: false,
              permissionDenied: false,
              errorMessage: null,
            });
          }
          return;
        }

        const page = await getDocs(
          query(
            getCollectionRef.current(),
            ...buildConstraintsRef.current(),
            ...(more && previous.cursor ? [startAfter(previous.cursor)] : []),
            limit(pageSize),
          ),
        );
        if (!current()) return;

        const mapped = await mapDocsRef.current(page.docs);
        if (!current()) return;

        const rows = new Map((more ? previous.items : []).map((item) => [item.id, item]));
        for (const item of mapped) {
          rows.set(item.id, item);
        }

        setState({
          scope,
          items: Array.from(rows.values()),
          // Cursor from last raw doc — tie-safe via Firestore implicit document-ID order.
          cursor: page.docs.length === pageSize ? page.docs[page.docs.length - 1]! : null,
          busy: false,
          error: false,
          permissionDenied: false,
          errorMessage: null,
        });
      } catch (error) {
        if (!current()) return;
        const denied = isPermissionDenied(error);
        setState({
          scope,
          // Permission denied must not retain private rows from a prior successful page.
          items: denied ? [] : previous.items,
          cursor: denied ? null : previous.cursor,
          busy: false,
          error: true,
          permissionDenied: denied,
          errorMessage: denied ? '權限不足，已清除已載入內容' : errorMessageFrom(error),
        });
      } finally {
        if (lock.current === context) lock.current = null;
      }
    },
    [scope, schoolId, uid, canAccess, demoItems, pageSize],
  );

  useEffect(() => {
    void load(false);
    return () => {
      request.current += 1;
      lock.current = null;
    };
  }, [load]);

  // Empty for a new scope during render, before effects resolve.
  const visible: AdminCollectionPageState<T> =
    state.scope === scope
      ? state
      : {
          scope,
          items: [],
          cursor: null,
          busy: true,
          error: false,
          permissionDenied: false,
          errorMessage: null,
        };

  return {
    items: visible.items,
    cursor: visible.cursor,
    busy: visible.busy,
    error: visible.error,
    permissionDenied: visible.permissionDenied,
    errorMessage: visible.errorMessage,
    loading: visible.busy && visible.items.length === 0,
    hasMore: Boolean(visible.cursor),
    reload: () => load(false),
    loadMore: () => load(true),
  };
}
