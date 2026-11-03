'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type CampusDraftSlot = 'assistant';

const STORAGE_PREFIX = 'campus.draft.v1:';
const MAX_DRAFT_LENGTH = 4000;

type DraftMap = Partial<Record<CampusDraftSlot, string>>;

type DraftState = {
  uid: string | null;
  schoolId: string | null;
  ready: boolean;
  resolved: boolean;
  drafts: DraftMap;
};

type DraftController = {
  hasActivity: () => boolean;
  discard: () => void;
};

let activeController: DraftController | null = null;

/** SelectedSchoolProvider 換校前讀取：目前範圍是否有未送出草稿。 */
export function hasCampusDraftActivity(): boolean {
  return activeController?.hasActivity() ?? false;
}

/** 確認捨棄並切換學校時呼叫，清掉目前範圍草稿。 */
export function discardActiveCampusDrafts(): void {
  activeController?.discard();
}

export function scopeStorageKey(uid: string | null, schoolId: string | null): string {
  return `${STORAGE_PREFIX}${uid ?? 'guest'}:${schoolId ?? 'all'}`;
}

function readStoredDrafts(key: string): DraftMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const drafts: DraftMap = {};
    for (const [slot, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        drafts[slot as CampusDraftSlot] = value.slice(0, MAX_DRAFT_LENGTH);
      }
    }
    return drafts;
  } catch {
    return {};
  }
}

function writeStoredDrafts(key: string, drafts: DraftMap): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: DraftMap = {};
    for (const [slot, value] of Object.entries(drafts) as [CampusDraftSlot, string | undefined][]) {
      if (typeof value === 'string' && value.trim()) payload[slot] = value.slice(0, MAX_DRAFT_LENGTH);
    }
    if (Object.keys(payload).length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // sessionStorage 不可用時仍保留記憶體草稿。
  }
}

export function purgeAccountDrafts(uid: string | null): void {
  if (typeof window === 'undefined') return;
  const prefix = `${STORAGE_PREFIX}${uid ?? 'guest'}:`;
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function hasText(drafts: DraftMap): boolean {
  return Object.values(drafts).some((value) => typeof value === 'string' && value.trim().length > 0);
}

class DraftStore {
  listeners = new Set<() => void>();
  state: DraftState;
  constructor(uid: string | null, schoolId: string | null, ready: boolean) {
    this.state = {
      uid,
      schoolId,
      ready,
      resolved: ready,
      drafts: ready ? readStoredDrafts(scopeStorageKey(uid, schoolId)) : {},
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish(next: DraftState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  reconcile(uid: string | null, schoolId: string | null, ready: boolean) {
    // Render 期間只改 snapshot，不通知 listener（由同一次 render 的 useSyncExternalStore 讀取）。
    const old = this.state;
    const identityChanged = old.resolved && old.uid !== uid;
    const schoolChanged = old.schoolId !== schoolId && (old.resolved || old.schoolId !== null);
    if (identityChanged || schoolChanged) {
      this.state = {
        uid,
        schoolId,
        ready,
        resolved: ready || old.resolved,
        // 換帳後不讀舊帳號 session；換校讀目標校自己的 key（不會帶 A 校草稿到 B 校）
        drafts: ready && !identityChanged ? readStoredDrafts(scopeStorageKey(uid, schoolId)) : {},
      };
      return;
    }
    if (old.ready !== ready || old.uid !== uid || old.schoolId !== schoolId) {
      const drafts =
        ready && !old.ready && !hasText(old.drafts)
          ? readStoredDrafts(scopeStorageKey(uid, schoolId))
          : old.drafts;
      this.state = {
        uid,
        schoolId,
        ready,
        resolved: ready || old.resolved,
        drafts,
      };
    }
  }
  setDraft(slot: CampusDraftSlot, text: string) {
    if (!this.state.ready) return;
    const nextText = text.slice(0, MAX_DRAFT_LENGTH);
    if ((this.state.drafts[slot] ?? '') === nextText) return;
    const drafts = { ...this.state.drafts, [slot]: nextText };
    writeStoredDrafts(scopeStorageKey(this.state.uid, this.state.schoolId), drafts);
    this.publish({ ...this.state, drafts });
  }
  clearDraft(slot: CampusDraftSlot) {
    this.setDraft(slot, '');
  }
  discardAll() {
    writeStoredDrafts(scopeStorageKey(this.state.uid, this.state.schoolId), {});
    this.publish({ ...this.state, drafts: {} });
  }
}

type CampusDraftContextValue = {
  store: DraftStore;
  state: DraftState;
};

const CampusDraftContext = createContext<CampusDraftContextValue | null>(null);

export function CampusDraftProvider({
  uid,
  schoolId,
  ready = true,
  children,
}: {
  uid: string | null;
  schoolId: string | null;
  ready?: boolean;
  children: ReactNode;
}) {
  const [store] = useState(() => new DraftStore(uid, schoolId, ready));
  store.reconcile(uid, schoolId, ready);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const seenUid = useRef(uid);
  const controller = useMemo<DraftController>(
    () => ({
      hasActivity: () => hasText(store.state.drafts),
      discard: () => store.discardAll(),
    }),
    [store],
  );

  useLayoutEffect(() => {
    if (seenUid.current !== uid) {
      purgeAccountDrafts(seenUid.current);
      seenUid.current = uid;
    }
  }, [uid]);

  useLayoutEffect(() => {
    activeController = controller;
    return () => {
      if (activeController === controller) activeController = null;
    };
  }, [controller]);

  const value = useMemo(() => ({ store, state }), [store, state]);
  return <CampusDraftContext.Provider value={value}>{children}</CampusDraftContext.Provider>;
}

export function useCampusDraft(slot: CampusDraftSlot) {
  const context = useContext(CampusDraftContext);
  if (!context) {
    throw new Error('useCampusDraft must be used within CampusDraftProvider');
  }
  const text = context.state.drafts[slot] ?? '';
  const setText = useCallback(
    (next: string | ((previous: string) => string)) => {
      const previous = context.store.state.drafts[slot] ?? '';
      const value = typeof next === 'function' ? next(previous) : next;
      context.store.setDraft(slot, value);
    },
    [context.store, slot],
  );
  const clear = useCallback(() => {
    context.store.clearDraft(slot);
  }, [context.store, slot]);
  return {
    text,
    setText,
    clear,
    ready: context.state.ready,
    uid: context.state.uid,
    schoolId: context.state.schoolId,
  };
}

/** 測試或尚未掛 Provider 的頁面可安全呼叫；無 Provider 時退回元件內本地狀態。 */
export function useOptionalCampusDraft(slot: CampusDraftSlot) {
  const context = useContext(CampusDraftContext);
  const [localText, setLocalText] = useState('');
  const setText = useCallback(
    (next: string | ((previous: string) => string)) => {
      if (context) {
        const previous = context.store.state.drafts[slot] ?? '';
        context.store.setDraft(slot, typeof next === 'function' ? next(previous) : next);
        return;
      }
      setLocalText((previous) => (typeof next === 'function' ? next(previous) : next));
    },
    [context, slot],
  );
  const clear = useCallback(() => {
    if (context) context.store.clearDraft(slot);
    else setLocalText('');
  }, [context, slot]);
  if (!context) {
    return {
      text: localText,
      setText,
      clear,
      ready: false,
      uid: null as string | null,
      schoolId: null as string | null,
      available: false as const,
    };
  }
  return {
    text: context.state.drafts[slot] ?? '',
    setText,
    clear,
    ready: context.state.ready,
    uid: context.state.uid,
    schoolId: context.state.schoolId,
    available: true as const,
  };
}
