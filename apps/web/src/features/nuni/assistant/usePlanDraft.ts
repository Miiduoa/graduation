'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RevisionDraftScope, RevisionDraftSource } from '@/lib/assistantPlanRevisionDraft';
import type { PlanDraft, createPlanDraftStorage } from '@/lib/assistantPlanDraftStorage';

export type PlanDraftOutcome<C> = { ok: boolean; message: string; content?: C };
type Prepared<C> = { ok: true; message: string; content: C } | { ok: false; message: string };
type HookMessages = Record<'stale' | 'choice' | 'inactive' | 'empty' | 'expired' | 'saveFailure' |
  'replaced' | 'saved' | 'emptySaved' | 'restored' | 'discarded' | 'clearFailure' |
  'clearedForDispatch' | 'cleared' | 'restoreFirst', string>;
export type PlanDraftHookPolicy<C extends object, A extends unknown[]> = {
  storage: Pick<ReturnType<typeof createPlanDraftStorage<C>>, 'read' | 'save' | 'clear'>;
  ttl: number; messages: HookMessages; isEmpty(content: C): boolean;
  prepare(draft: PlanDraft<C>, source: RevisionDraftSource, ...args: A): Prepared<C>;
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Shared unsent-draft lifecycle; proposal/execution gates remain with the owner. */
export function usePlanDraft<C extends object, A extends unknown[]>(
  scope: RevisionDraftScope, active: () => boolean, policy: PlanDraftHookPolicy<C, A>,
) {
  type Draft = PlanDraft<C>;
  const messages = policy.messages;
  const { stale: STALE, choice: CHOICE, inactive: INACTIVE, empty: EMPTY } = messages;
  const [bound] = useState(() => ({ ...scope }));
  const latest = useRef({ scope, active });
  useLayoutEffect(() => { latest.current = { scope, active }; }, [scope, active]);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const isActive = () => {
    const current = latest.current;
    return mounted.current && current.active() &&
      current.scope.accountId === bound.accountId && current.scope.schoolId === bound.schoolId &&
      current.scope.context === bound.context;
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const offered = useRef<Draft | null>(null);
  const observed = useRef<Draft | null>(null);
  const editorOwner = useRef<string | null>(null);
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);
  const [status, setStatus] = useState('');
  const [editorStatuses, setEditorStatuses] = useState<Record<string, string>>({});

  function editorStatus(sourceKey: string, message: string) {
    setEditorStatuses(previous => ({ ...previous, [sourceKey]: message }));
  }
  function setOffer(value: Draft | null, recovered = false) {
    offered.current = value ? copy(value) : null;
    setDraft(offered.current);
    restoredRef.current = recovered;
    setRestored(recovered);
  }
  function receive(value: Draft | null) {
    observed.current = value ? copy(value) : null;
    editorOwner.current = null;
    setOffer(value);
  }
  function failure(message: string, sourceKey?: string): PlanDraftOutcome<C> {
    if (isActive()) {
      setStatus(message);
      if (sourceKey) editorStatus(sourceKey, message);
    }
    return { ok: false, message };
  }

  useEffect(() => {
    mounted.current = true;
    let live = true;
    queueMicrotask(() => {
      if (!live || !isActive() || loaded.current) return;
      const result = policy.storage.read(bound);
      if (!isActive()) return;
      loaded.current = true;
      receive(result.draft);
      setStatus(result.message || '');
    });
    return () => { live = false; mounted.current = false; };
    // The owning conversation remounts for account, school and session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function readCurrent(sourceKey?: string) {
    if (!isActive()) return { ok: false as const, outcome: failure(INACTIVE, sourceKey) };
    const result = policy.storage.read(bound);
    loaded.current = true;
    if (!isActive()) return { ok: false as const, outcome: failure(INACTIVE, sourceKey) };
    if (result.status === 'unavailable')
      return { ok: false as const, outcome: failure(result.message || STALE, sourceKey) };
    if (!same(result.draft, observed.current)) {
      receive(result.draft);
      return { ok: false as const, outcome: failure(result.message || STALE, sourceKey) };
    }
    return { ok: true as const, draft: result.draft };
  }

  function reviewed() {
    if (!offered.current) return { ok: false as const, outcome: failure(STALE) };
    const read = readCurrent();
    if (!read.ok) return read;
    if (!read.draft) return { ok: false as const, outcome: failure(STALE) };
    return { ok: true as const, draft: read.draft };
  }

  useEffect(() => {
    if (!draft) return;
    const id = draft.id;
    const expire = () => {
      if (!isActive() || offered.current?.id !== id ||
        Date.now() < draft.savedAt + policy.ttl) return;
      const result = policy.storage.read(bound);
      if (!isActive()) return;
      receive(result.draft);
      setStatus(result.message || (result.draft ? STALE : messages.expired));
    };
    const timer = window.setTimeout(expire, Math.max(0, draft.savedAt + policy.ttl - Date.now()));
    document.addEventListener('visibilitychange', expire);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', expire); };
    // Reads, restores and source rebindings do not renew this deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.savedAt]);

  function commitEditor(source: RevisionDraftSource, content: C, replace: boolean): PlanDraftOutcome<C> {
    const read = readCurrent(source.key);
    if (!read.ok) return read.outcome;
    if (!replace && (offered.current || (read.draft && editorOwner.current !== source.key))) {
      if (!offered.current && read.draft) receive(read.draft);
      return failure(CHOICE, source.key);
    }
    if (replace && policy.isEmpty(content)) return failure(EMPTY, source.key);
    const result = policy.storage.save(bound, source, content, isActive, Date.now(), { expected: read.draft });
    if (!isActive()) return failure(INACTIVE, source.key);
    if (!result.ok) return failure(result.message || messages.saveFailure, source.key);
    observed.current = result.draft ? copy(result.draft) : null;
    editorOwner.current = source.key;
    setOffer(null);
    const message = result.draft
      ? replace ? messages.replaced : messages.saved
      : messages.emptySaved;
    setStatus('');
    editorStatus(source.key, message);
    return { ok: true, message };
  }
  function saveEditor(source: RevisionDraftSource, content: C) {
    return commitEditor(source, content, false);
  }
  function replaceEditor(source: RevisionDraftSource, content: C) {
    return commitEditor(source, content, true);
  }

  function restore(): PlanDraftOutcome<C> {
    const read = reviewed();
    if (!read.ok) return read.outcome;
    setOffer(read.draft, true);
    const message = messages.restored;
    setStatus(message);
    return { ok: true, message };
  }
  function discard(): PlanDraftOutcome<C> {
    const read = reviewed();
    if (!read.ok) return read.outcome;
    const result = policy.storage.clear(bound, isActive, {
      sourceKey: read.draft.source.key, id: read.draft.id, snapshot: read.draft,
    });
    if (!isActive()) return failure(INACTIVE);
    if (!result.ok) return failure(result.message || STALE);
    receive(null);
    const message = messages.discarded;
    setStatus(message);
    return { ok: true, message };
  }

  function clearSource(sourceKey: string, beforeDispatch = false): PlanDraftOutcome<C> {
    if (!isActive()) return failure(INACTIVE, sourceKey);
    const read = policy.storage.read(bound);
    loaded.current = true;
    if (!isActive()) return failure(INACTIVE, sourceKey);
    if (read.status === 'unavailable') return failure(read.message || STALE, sourceKey);
    if (read.draft?.source.key === sourceKey && !same(read.draft, observed.current)) {
      receive(read.draft);
      return failure(STALE, sourceKey);
    }
    const result = policy.storage.clear(bound, isActive, {
      sourceKey, ...(read.draft?.source.key === sourceKey ? { id: read.draft.id } : {}), snapshot: read.draft,
    });
    if (!isActive()) return failure(INACTIVE, sourceKey);
    if (!result.ok) return failure(result.message || messages.clearFailure, sourceKey);
    if (!read.draft || read.draft.source.key === sourceKey) { receive(null); setStatus(''); }
    else if (!same(read.draft, observed.current)) receive(read.draft);
    const message = beforeDispatch
      ? messages.clearedForDispatch
      : messages.cleared;
    editorStatus(sourceKey, message);
    return { ok: true, message };
  }

  function apply(source: RevisionDraftSource, ...args: A): PlanDraftOutcome<C> {
    if (!restoredRef.current) return failure(messages.restoreFirst, source.key);
    const read = reviewed();
    if (!read.ok) return read.outcome;
    const prepared = policy.prepare(read.draft, source, ...args);
    if (!prepared.ok) return failure(prepared.message, source.key);
    const content = copy(prepared.content);
    const result = policy.storage.save(bound, source, content, isActive, Date.now(), {
      expected: read.draft, savedAt: read.draft.savedAt,
    });
    if (!isActive()) return failure(INACTIVE, source.key);
    if (!result.ok) return failure(result.message || STALE, source.key);
    observed.current = result.draft ? copy(result.draft) : null;
    editorOwner.current = source.key;
    setOffer(null);
    setStatus('');
    const message = prepared.message;
    editorStatus(source.key, message);
    return { ok: true, message, content };
  }

  const sameScope = scope.accountId === bound.accountId && scope.schoolId === bound.schoolId &&
    scope.context === bound.context;
  return {
    draft: sameScope ? draft : null, restored: sameScope && restored,
    status: sameScope ? status : '', editorStatuses: sameScope ? editorStatuses : {},
    restore, discard, saveEditor, replaceEditor, clearSource, apply,
  };
}
