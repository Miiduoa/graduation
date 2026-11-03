'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  createMaterialBookmarkStore,
  EMPTY_MATERIAL_BOOKMARKS,
  materialBookmarkStorageKey,
} from '@campus/shared/src/materialBookmarks';

const store = createMaterialBookmarkStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  withLock: async (key, operation) =>
    typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request(key, operation)
      : await operation(),
});

export function useMaterialBookmarks(accountId: string) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(accountId, listener), [accountId]);
  const getSnapshot = useCallback(() => store.getSnapshot(accountId), [accountId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MATERIAL_BOOKMARKS);
  const reload = useCallback(() => store.load(accountId), [accountId]);
  const setBookmark = useCallback(
    (courseId: string, materialId: string, saved: boolean) => store.setBookmark(accountId, courseId, materialId, saved),
    [accountId],
  );
  useEffect(() => {
    void reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === materialBookmarkStorageKey(accountId)) void reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [accountId, reload]);
  return { ...snapshot, setBookmark, reload };
}
