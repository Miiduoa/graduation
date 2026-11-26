import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  campusEventShortlistKey,
  campusEventShortlistOwner,
  createCampusEventShortlistStore,
  EMPTY_CAMPUS_EVENT_SHORTLIST,
  type SavedCampusEvent,
} from '@campus/shared/src/campusEventShortlist';
import { useAuth } from './auth';
import { useSchool } from './school';
import { useOptionalNuniSession } from './nuniSession';
import { useAssistantSessionExpiry } from './useAssistantSessionExpiry';

const store = createCampusEventShortlistStore(AsyncStorage, { evictIdleSnapshots: true });
const noop = () => {};

export function useCampusEventShortlist() {
  const { user, loading, tokenExpired } = useAuth();
  const platform = useOptionalNuniSession();
  useAssistantSessionExpiry(platform);
  const { school, selectionReady } = useSchool();
  let scopeNotice: string | null = null;
  if (platform?.pendingLogout) scopeNotice = '完成登出後即可查看收藏';
  else if (
    tokenExpired ||
    platform?.error ||
    (platform?.session && platform.session.expiresAt <= Date.now())
  )
    scopeNotice = '請重新確認登入狀態後查看收藏';
  else if (!selectionReady || loading || platform?.loading) scopeNotice = '正在確認帳號與校園';
  const owner = campusEventShortlistOwner(user?.uid, platform?.session?.platformAccountId);
  const key = scopeNotice ? null : campusEventShortlistKey(school.id, owner);
  // A callback belongs to one mounted account/campus session, not just its storage key.
  // Switching away and back must not revive a delayed press from the old session.
  const scope = useMemo(() => ({ key }), [key]);
  const activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);
  const subscribe = useCallback(
    (listener: () => void) => (key ? store.subscribe(key, listener) : noop),
    [key],
  );
  const getSnapshot = useCallback(
    () => (key ? store.getSnapshot(key) : EMPTY_CAMPUS_EVENT_SHORTLIST),
    [key],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const reload = useCallback(() => {
    if (key && activeScope.current === scope) void store.load(key);
  }, [key, scope]);
  useEffect(reload, [reload]);
  return {
    ...snapshot,
    available: key !== null,
    scopeNotice,
    reload,
    setSaved: (event: SavedCampusEvent, saved: boolean) => {
      if (key && activeScope.current === scope && store.getSnapshot(key).ready) {
        void store.setSaved(key, event, saved);
      }
    },
  };
}
