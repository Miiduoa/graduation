import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type QueryConstraint,
  type QueryDocumentSnapshot,
  getDocs,
  limit,
  query,
  startAfter,
} from 'firebase/firestore';

export const ADMIN_COLLECTION_PAGE_SIZE = 50;

export type AdminCollectionPageState<T extends { id: string }> = {
  scope: string;
  items: T[];
  cursor: QueryDocumentSnapshot | null;
  busy: boolean;
  error: boolean;
  permissionDenied: boolean;
};

export type UseAdminCollectionPageOptions<T extends { id: string }> = {
  schoolId: string;
  uid: string;
  /** Extra fencing key (e.g. account session); changes invalidate in-flight pages. */
  fenceKey?: string;
  demoItems?: T[];
  pageSize?: number;
  /** Build stable order/filter constraints (no limit / startAfter). */
  buildConstraints: () => QueryConstraint[];
  /** Collection reference factory; keep school-scoped. */
  getCollection: () => unknown;
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

/**
 * Stable school-scoped cursor pagination for admin collections.
 * Mirrors useAdminEvents: request tokens, scope fencing, dedupe by id, retry same cursor.
 */
export function useAdminCollectionPage<T extends { id: string }>(
  options: UseAdminCollectionPageOptions<T>,
) {
  const {
    schoolId,
    uid,
    fenceKey = '',
    demoItems,
    pageSize = ADMIN_COLLECTION_PAGE_SIZE,
    buildConstraints,
    getCollection,
    mapDocs,
  } = options;

  const scope = JSON.stringify([schoolId, uid, fenceKey, Boolean(demoItems), pageSize]);
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
  });
  const latest = useRef(state);
  latest.current = state;

  const load = useCallback(
    async (more = false) => {
      const context = active.current;
      if (lock.current === context) return;
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
            };

      setState({
        scope,
        items: previous.items,
        cursor: previous.cursor,
        busy: true,
        error: false,
        permissionDenied: previous.permissionDenied,
      });

      try {
        if (demoItems) {
          if (current()) {
            setState({
              scope,
              items: demoItems,
              cursor: null,
              busy: false,
              error: false,
              permissionDenied: false,
            });
          }
          return;
        }
        if (!uid || !schoolId) throw new Error('Missing school editor session');

        const page = await getDocs(
          query(
            getCollectionRef.current() as Parameters<typeof query>[0],
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
          cursor: page.docs.length === pageSize ? page.docs[page.docs.length - 1] : null,
          busy: false,
          error: false,
          permissionDenied: false,
        });
      } catch (error) {
        if (!current()) return;
        const denied = isPermissionDenied(error);
        setState({
          scope,
          items: previous.items,
          cursor: previous.cursor,
          busy: false,
          error: true,
          permissionDenied: denied || previous.permissionDenied,
        });
      } finally {
        if (lock.current === context) lock.current = null;
      }
    },
    [scope, schoolId, uid, demoItems, pageSize],
  );

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
      lock.current = null;
    };
  }, [load]);

  const visible =
    state.scope === scope
      ? state
      : {
          items: [] as T[],
          cursor: null,
          busy: true,
          error: false,
          permissionDenied: false,
        };

  return {
    items: visible.items,
    cursor: visible.cursor,
    busy: visible.busy,
    error: visible.error,
    permissionDenied: visible.permissionDenied,
    loading: visible.busy && !visible.items.length,
    hasMore: Boolean(visible.cursor),
    complete: !visible.busy && !visible.cursor && !visible.error,
    reload: () => load(false),
    loadMore: () => load(true),
  };
}
