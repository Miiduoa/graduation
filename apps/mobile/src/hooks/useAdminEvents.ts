import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getDb } from '../firebase';
const PAGE_SIZE = 50;
export function useAdminEvents<T extends { id: string }>(
  schoolId: string,
  uid: string,
  demoEvents?: T[],
) {
  const scope = JSON.stringify([schoolId, uid, Boolean(demoEvents)]);
  const active = useRef({ scope });
  if (active.current.scope !== scope) active.current = { scope };
  const request = useRef(0);
  const lock = useRef<object | null>(null);
  const [state, setState] = useState<{
    scope: string;
    items: T[];
    cursor: QueryDocumentSnapshot | null;
    busy: boolean;
    error: boolean;
  }>({ scope, items: [], cursor: null, busy: true, error: false });
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
        latest.current.scope === scope ? latest.current : { items: [], cursor: null };
      setState({ scope, items: previous.items, cursor: previous.cursor, busy: true, error: false });
      try {
        if (demoEvents) {
          if (current())
            setState({ scope, items: demoEvents, cursor: null, busy: false, error: false });
          return;
        }
        if (!uid || !schoolId) throw new Error('Missing school editor session');
        const page = await getDocs(
          query(
            collection(getDb(), 'schools', schoolId, 'clubEvents'),
            orderBy(documentId()),
            ...(more && previous.cursor ? [startAfter(previous.cursor)] : []),
            limit(PAGE_SIZE),
          ),
        );
        if (!current()) return;
        const rows = new Map((more ? previous.items : []).map((item) => [item.id, item]));
        page.docs.forEach((document) =>
          rows.set(document.id, { ...document.data(), id: document.id } as T),
        );
        setState({
          scope,
          items: Array.from(rows.values()),
          cursor: page.docs.length === PAGE_SIZE ? page.docs[page.docs.length - 1] : null,
          busy: false,
          error: false,
        });
      } catch {
        if (current())
          setState({
            scope,
            items: previous.items,
            cursor: previous.cursor,
            busy: false,
            error: true,
          });
      } finally {
        if (lock.current === context) lock.current = null;
      }
    },
    [scope, schoolId, uid, demoEvents],
  );
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
      lock.current = null;
    };
  }, [load]);
  const visible =
    state.scope === scope ? state : { items: [], cursor: null, busy: true, error: false };
  return {
    ...visible,
    loading: visible.busy && !visible.items.length,
    hasMore: Boolean(visible.cursor),
    reload: () => load(),
    loadMore: () => load(true),
  };
}
