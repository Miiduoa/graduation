import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createMaterialBookmarkStore, EMPTY_MATERIAL_BOOKMARKS } from '@campus/shared/src/materialBookmarks';

const store = createMaterialBookmarkStore(AsyncStorage);

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
  }, [accountId, reload]);
  return { ...snapshot, setBookmark, reload };
}
