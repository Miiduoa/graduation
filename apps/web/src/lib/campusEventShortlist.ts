'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  campusEventShortlistKey,
  campusEventShortlistOwner,
  EMPTY_CAMPUS_EVENT_SHORTLIST,
  createCampusEventShortlistStore,
  type SavedCampusEvent,
} from '@campus/shared/src/campusEventShortlist';
import { useAuth } from '@/components/AuthGuard';
import { withCampusEventShortlistLock } from './campusEventShortlistLock';
import { useOptionalNuniSession } from '@/features/nuni/Session';

export type { SavedCampusEvent };

/**
 * pending: sign-in state is not resolved, so neither guest nor account data may be shown or written.
 * loading: scope is known, the device copy is still being read.
 * ready: the device copy is readable; write errors are reported separately through `error`.
 * error: either the account or the device copy could not be read; scope distinguishes the two.
 */
export type CampusEventShortlistPhase = 'pending' | 'loading' | 'ready' | 'error';
export type CampusEventShortlistScope =
  | 'pending'
  | 'guest'
  | 'account'
  | 'signing-out'
  | 'auth-error';
export type CampusEventShortlistResult = 'done' | 'failed' | 'ignored';

const GENERIC_WRITE_ERROR = '無法儲存變更，請確認裝置儲存空間後再試一次。';

const store = createCampusEventShortlistStore(
  {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    withLock: withCampusEventShortlistLock,
  },
  { evictIdleSnapshots: true },
);

/** Persist only the identity and label needed to reopen the live event. */
export function toSavedCampusEvent(
  event: Pick<SavedCampusEvent, 'schoolId' | 'id' | 'source' | 'title'>,
): SavedCampusEvent {
  return { schoolId: event.schoolId, id: event.id, source: event.source, title: event.title };
}

export function campusEventShortlistIdentity(
  event: Pick<SavedCampusEvent, 'schoolId' | 'id' | 'source'>,
): string {
  return JSON.stringify([event.schoolId, event.source, event.id]);
}

export function campusEventShortlistScopeCopy(scope: CampusEventShortlistScope): string {
  if (scope === 'account') return '收藏保存在這個瀏覽器，依目前帳號與校園分開顯示。';
  if (scope === 'guest') return '訪客收藏保存在這個瀏覽器，依校園分開顯示。';
  if (scope === 'signing-out') return '請先完成登出，再查看活動收藏。';
  if (scope === 'auth-error') return '目前無法確認登入狀態，請重新確認帳號後查看收藏。';
  return '正在確認登入狀態，確認後才會顯示收藏。';
}

function subscribeNothing() {
  return () => undefined;
}

export function useCampusEventShortlist(schoolId: string) {
  const auth = useAuth();
  const platform = useOptionalNuniSession();
  const owner = campusEventShortlistOwner(auth.user?.uid, platform?.session?.platformAccountId);
  let scope: CampusEventShortlistScope = owner ? 'account' : 'guest';
  if (platform?.pendingLogout) scope = 'signing-out';
  else if (auth.error || platform?.error) scope = 'auth-error';
  else if (auth.loading || platform?.loading || !schoolId) scope = 'pending';
  const key =
    scope === 'guest' || scope === 'account' ? campusEventShortlistKey(schoolId, owner) : null;
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
    return () => {
      keyRef.current = null;
    };
  }, [key]);

  const subscribe = useCallback(
    (listener: () => void) => (key ? store.subscribe(key, listener) : subscribeNothing()),
    [key],
  );
  const getSnapshot = useCallback(
    () => (key ? store.getSnapshot(key) : EMPTY_CAMPUS_EVENT_SHORTLIST),
    [key],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CAMPUS_EVENT_SHORTLIST);

  const [notice, setNotice] = useState<{ key: string; message: string } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    event: SavedCampusEvent;
    saved: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<readonly string[]>([]);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    if (!key) return undefined;
    void store.load(key);
    const reload = () => void store.load(key);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) reload();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [key]);

  const phase: CampusEventShortlistPhase =
    scope === 'auth-error'
      ? 'error'
      : !key
        ? 'pending'
        : snapshot.ready
          ? 'ready'
          : snapshot.error
            ? 'error'
            : 'loading';
  const items = useMemo(
    () =>
      key && snapshot.ready ? snapshot.items.filter((item) => item.schoolId === schoolId) : [],
    [key, schoolId, snapshot],
  );
  const currentFailure = failure && failure.key === key ? failure : null;
  const error =
    scope === 'auth-error'
      ? campusEventShortlistScopeCopy(scope)
      : (snapshot.error ?? (currentFailure ? GENERIC_WRITE_ERROR : null));

  const savedIdentities = useMemo(() => new Set(items.map(campusEventShortlistIdentity)), [items]);
  const isSaved = useCallback(
    (event: Pick<SavedCampusEvent, 'schoolId' | 'id' | 'source'>) =>
      savedIdentities.has(campusEventShortlistIdentity(event)),
    [savedIdentities],
  );
  const isBusy = useCallback(
    (event: Pick<SavedCampusEvent, 'schoolId' | 'id' | 'source'>) =>
      busy.includes(`${key}\n${campusEventShortlistIdentity(event)}`),
    [busy, key],
  );

  async function toggle(
    event: SavedCampusEvent,
    saved: boolean,
  ): Promise<CampusEventShortlistResult> {
    const scopeKey = key;
    // Never write while sign-in is unresolved or before this scope's stored copy was read.
    if (!scopeKey || keyRef.current !== scopeKey || !store.getSnapshot(scopeKey).ready)
      return 'ignored';
    const identity = campusEventShortlistIdentity(event);
    const operation = `${scopeKey}\n${identity}`;
    if (inflight.current.has(operation)) return 'ignored';
    inflight.current.add(operation);
    setBusy((current) => [...current, operation]);
    setNotice(null);
    let saveSucceeded = false;
    try {
      saveSucceeded = await store.setSaved(scopeKey, toSavedCampusEvent(event), saved);
    } catch {
      saveSucceeded = false;
    } finally {
      inflight.current.delete(operation);
      setBusy((current) => {
        const index = current.indexOf(operation);
        return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
      });
    }
    // The user may have switched account or school while storage was working.
    if (keyRef.current !== scopeKey) return 'ignored';
    if (saveSucceeded) {
      setFailure(null);
      setNotice({
        key: scopeKey,
        message: saved ? `已收藏「${event.title}」。` : `已取消收藏「${event.title}」。`,
      });
      return 'done';
    }
    setFailure({ key: scopeKey, event: toSavedCampusEvent(event), saved });
    return 'failed';
  }

  async function reload() {
    if (!key || keyRef.current !== key) return false;
    await store.load(key);
    return keyRef.current === key && store.getSnapshot(key).ready;
  }

  async function retry(): Promise<boolean> {
    if (scope === 'auth-error') {
      if (auth.error) window.location.reload();
      else await platform?.refresh();
      return false;
    }
    const scopeKey = key;
    if (!scopeKey || keyRef.current !== scopeKey) return false;
    if (!currentFailure) return reload();
    if (!store.getSnapshot(scopeKey).ready && !(await reload())) return false;
    return (await toggle(currentFailure.event, currentFailure.saved)) === 'done';
  }

  return {
    scope,
    phase,
    items,
    ready: phase === 'ready',
    error,
    notice: notice && notice.key === key ? notice.message : '',
    isSaved,
    isBusy,
    toggle,
    retry,
    reload,
  };
}

export type CampusEventShortlistController = ReturnType<typeof useCampusEventShortlist>;
