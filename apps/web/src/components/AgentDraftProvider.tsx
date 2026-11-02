'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type AgentDraftSlot = 'quick' | 'search' | 'navigation';
export type AgentDraft = { text: string; category?: string };
export type AgentDraftActivity = { hasActivity: boolean };
const HISTORY_KEY = '__nuniAgentDraft';
const emptyDraft: AgentDraft = { text: '' };
let instanceSequence = 0;
type DraftState = {
  ownerKey: string | null;
  schoolId: string | null;
  scopeKey: string;
  scopeEpoch: number;
  activityEpoch: number;
  ready: boolean;
  editable: boolean;
  drafts: Partial<Record<AgentDraftSlot, AgentDraft>>;
  quotaUntil: number | null;
  revisions: Partial<Record<AgentDraftSlot, number>>;
  handoffs: Partial<Record<AgentDraftSlot, number>>;
  pending: Set<object>;
};

class DraftStore {
  readonly id = `draft-${++instanceSequence}-${Math.random().toString(36).slice(2)}`;
  listeners = new Set<() => void>();
  onActivity?: (activity: AgentDraftActivity) => void;
  state: DraftState;
  private resolved: boolean;
  private identityResolved: boolean;
  constructor(ownerKey: string | null, schoolId: string | null, ready: boolean, editable = ready) {
    this.resolved = ready;
    this.identityResolved = editable;
    this.state = {
      ownerKey,
      schoolId,
      scopeKey: `${this.id}:0`,
      scopeEpoch: 0,
      activityEpoch: 0,
      ready,
      editable,
      drafts: {},
      quotaUntil: null,
      revisions: {},
      handoffs: {},
      pending: new Set(),
    };
  }
  snapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  configureActivity(callback?: (activity: AgentDraftActivity) => void) {
    this.onActivity = callback;
  }
  activity() {
    this.onActivity?.({
      hasActivity:
        this.state.pending.size > 0 ||
        Object.values(this.state.drafts).some(
          (draft) => !!draft?.text.trim() || (!!draft?.category && draft.category !== 'all'),
        ),
    });
  }
  publish(next: DraftState) {
    this.state = next;
    this.activity();
    for (const listener of this.listeners) listener();
  }
  reconcile(ownerKey: string | null, schoolId: string | null, ready: boolean, editable = ready) {
    const old = this.state;
    const identityChanged = this.identityResolved && old.ownerKey !== ownerKey;
    const schoolChanged = old.schoolId !== schoolId && (this.resolved || old.schoolId !== null);
    if (identityChanged || schoolChanged) {
      this.state = {
        ownerKey,
        schoolId,
        scopeKey: `${this.id}:${old.scopeEpoch + 1}`,
        scopeEpoch: old.scopeEpoch + 1,
        activityEpoch: old.activityEpoch + 1,
        ready,
        editable,
        drafts: {},
        quotaUntil: null,
        revisions: {},
        handoffs: {},
        pending: new Set(),
      };
    } else if (
      old.ready !== ready ||
      old.editable !== editable ||
      old.schoolId !== schoolId ||
      old.ownerKey !== ownerKey
    ) {
      this.state = {
        ...old,
        ownerKey,
        schoolId,
        ready,
        editable,
        activityEpoch: old.activityEpoch + 1,
        pending: new Set(),
      };
    }
    if (ready) this.resolved = true;
    if (editable) this.identityResolved = true;
    this.activity();
  }
  current(scope: Pick<DraftState, 'scopeKey' | 'activityEpoch'>, requireReady = true) {
    return (
      this.state.scopeKey === scope.scopeKey &&
      this.state.activityEpoch === scope.activityEpoch &&
      (!requireReady || this.state.ready)
    );
  }
  trustedHistory() {
    if (typeof window === 'undefined') return false;
    const marker = window.history.state?.[HISTORY_KEY];
    return marker === this.state.scopeKey || (marker == null && this.state.scopeEpoch === 0);
  }
  stampHistory() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!this.trustedHistory() && ['/search', '/ai-assistant'].includes(url.pathname)) {
      url.searchParams.delete('q');
      url.searchParams.delete('category');
    }
    window.history.replaceState(
      { ...window.history.state, [HISTORY_KEY]: this.state.scopeKey },
      '',
      url,
    );
  }
}
const DraftContext = createContext<{ store: DraftStore; state: DraftState } | null>(null);

export function AgentDraftProvider({
  ownerKey,
  schoolId,
  ready,
  editable = ready,
  onActivityChange,
  children,
}: {
  ownerKey: string | null;
  schoolId: string | null;
  ready: boolean;
  editable?: boolean;
  onActivityChange?: (activity: AgentDraftActivity) => void;
  children: ReactNode;
}) {
  const [store] = useState(() => new DraftStore(ownerKey, schoolId, ready, editable));
  store.configureActivity(onActivityChange);
  store.reconcile(ownerKey, schoolId, ready, editable);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useLayoutEffect(() => {
    store.stampHistory();
    const changed = () => store.stampHistory();
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, [store, state.scopeKey]);
  return <DraftContext.Provider value={{ store, state }}>{children}</DraftContext.Provider>;
}

type DraftOptions = {
  uid?: string | null;
  schoolId?: string | null;
  ready?: boolean;
  editable?: boolean;
  initialDraft?: AgentDraft;
};
export function useAgentDraft(slot: AgentDraftSlot, options: DraftOptions = {}) {
  const context = useContext(DraftContext);
  const [consumer] = useState(() => {
    let signature = '';
    let epoch = 0;
    return {
      reconcile(next: string) {
        if (signature !== next) {
          signature = next;
          epoch += 1;
        }
        return epoch;
      },
      current(captured: number) {
        return captured === epoch;
      },
    };
  });
  const consumerEpoch = consumer.reconcile(
    JSON.stringify([
      options.uid ?? null,
      options.schoolId ?? null,
      options.ready ?? true,
      options.editable ?? options.ready ?? true,
    ]),
  );
  const [fallback] = useState(
    () =>
      new DraftStore(
        options.uid ?? null,
        options.schoolId ?? null,
        options.ready ?? true,
        options.editable ?? options.ready ?? true,
      ),
  );
  const store = context?.store ?? fallback;
  if (!context)
    store.reconcile(
      options.uid ?? null,
      options.schoolId ?? null,
      options.ready ?? true,
      options.editable ?? options.ready ?? true,
    );
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const handoffEpoch = state.handoffs[slot] ?? 0;
  const token = useRef({});
  const lease = useRef(true);
  useLayoutEffect(() => {
    lease.current = true;
    return () => {
      lease.current = false;
    };
  }, []);
  // Only uninitialised slots may consume a URL seed. Returning to a page cannot overwrite edits.
  const urlSeed =
    typeof window === 'undefined'
      ? emptyDraft
      : {
          text: (new URLSearchParams(window.location.search).get('q') ?? '').slice(0, 1600),
          ...(new URLSearchParams(window.location.search).get('category')
            ? { category: new URLSearchParams(window.location.search).get('category')! }
            : {}),
        };
  const initial =
    state.drafts[slot] ??
    (store.trustedHistory() && state.editable ? (options.initialDraft ?? urlSeed) : undefined) ??
    emptyDraft;
  useLayoutEffect(() => {
    if (state.editable && store.state.drafts[slot] === undefined && store.current(state, false)) {
      store.publish({ ...store.state, drafts: { ...store.state.drafts, [slot]: initial } });
    }
    const pendingToken = token.current;
    return () => {
      if (store.state.pending.has(pendingToken)) {
        const pending = new Set(store.state.pending);
        pending.delete(pendingToken);
        store.publish({ ...store.state, pending });
      }
    };
    // The initial seed belongs to the first render of this slot in this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, slot, state.scopeKey, state.editable, consumerEpoch, handoffEpoch]);
  useLayoutEffect(() => {
    store.stampHistory();
  }, [store, state.scopeKey]);
  const draft = state.drafts[slot] ?? initial;
  const executionScope = useMemo(
    () => ({ scopeKey: state.scopeKey, activityEpoch: state.activityEpoch }),
    [state.scopeKey, state.activityEpoch],
  );
  const actions = useMemo(
    () => ({
      setDraft(next: AgentDraft | ((previous: AgentDraft) => AgentDraft)) {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope, false) ||
          !store.state.editable ||
          (options.editable ?? options.ready) === false
        )
          return;
        const value =
          typeof next === 'function' ? next(store.state.drafts[slot] ?? emptyDraft) : next;
        const previous = store.state.drafts[slot];
        if (previous?.text === value.text.slice(0, 1600) && previous?.category === value.category)
          return;
        store.publish({
          ...store.state,
          revisions: { ...store.state.revisions, [slot]: (store.state.revisions[slot] ?? 0) + 1 },
          drafts: {
            ...store.state.drafts,
            [slot]: {
              text: value.text.slice(0, 1600),
              ...(value.category ? { category: value.category } : {}),
            },
          },
        });
      },
      retainQuotaUntil(until: number) {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope) ||
          options.ready === false ||
          !Number.isFinite(until)
        )
          return;
        const quotaUntil = Math.max(store.state.quotaUntil ?? 0, until);
        if (quotaUntil !== store.state.quotaUntil) store.publish({ ...store.state, quotaUntil });
      },
      setPending(pending: boolean) {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope, pending) ||
          (pending && options.ready === false)
        )
          return;
        if (store.state.pending.has(token.current) === pending) return;
        const next = new Set(store.state.pending);
        if (pending) next.add(token.current);
        else next.delete(token.current);
        store.publish({ ...store.state, pending: next });
      },
      readUrlDraft(params: URLSearchParams): AgentDraft | null {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope, false) ||
          !store.trustedHistory()
        )
          return null;
        return (
          store.state.drafts[slot] ?? {
            text: (params.get('q') ?? '').slice(0, 1600),
            ...(params.get('category') ? { category: params.get('category')! } : {}),
          }
        );
      },
      writeUrlDraft(input: string | URL) {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope, false) ||
          !store.state.editable ||
          (options.editable ?? options.ready) === false ||
          typeof window === 'undefined'
        )
          return;
        const url = new URL(input, window.location.href);
        if (url.origin !== window.location.origin) return;
        window.history.replaceState(
          { ...window.history.state, [HISTORY_KEY]: executionScope.scopeKey },
          '',
          url,
        );
      },
      handoff(target: AgentDraftSlot, value: AgentDraft) {
        if (
          !lease.current ||
          !consumer.current(consumerEpoch) ||
          (store.state.handoffs[slot] ?? 0) !== handoffEpoch ||
          !store.current(executionScope, false) ||
          !store.state.editable ||
          (options.editable ?? options.ready) === false
        )
          return;
        store.publish({
          ...store.state,
          revisions: {
            ...store.state.revisions,
            [target]: (store.state.revisions[target] ?? 0) + 1,
          },
          handoffs: { ...store.state.handoffs, [target]: (store.state.handoffs[target] ?? 0) + 1 },
          drafts: {
            ...store.state.drafts,
            [target]: {
              text: value.text.slice(0, 1600),
              ...(value.category ? { category: value.category } : {}),
            },
          },
        });
      },
      // Actions capture the execution epoch, but read current draft values from the store.
    }),
    [
      store,
      slot,
      executionScope,
      options.ready,
      options.editable,
      consumer,
      consumerEpoch,
      handoffEpoch,
    ],
  );
  return {
    draft,
    scopeKey: state.scopeKey,
    scopeEpoch: state.scopeEpoch,
    activityEpoch: state.activityEpoch + consumerEpoch + handoffEpoch,
    draftRevision: state.revisions[slot] ?? 0,
    ready: state.ready && (options.ready ?? true),
    editable: state.editable && (options.editable ?? options.ready ?? true),
    quotaUntil: state.quotaUntil,
    ...actions,
  };
}
