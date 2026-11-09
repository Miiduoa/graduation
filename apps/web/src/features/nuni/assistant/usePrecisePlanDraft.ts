'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RevisionDraftScope, RevisionDraftSource } from '@/lib/assistantPlanRevisionDraft';
import {
  clearPrecisePlanDraft, precisePlanDraftSourceMatch, readPrecisePlanDraft, savePrecisePlanDraft,
  PRECISE_PLAN_DRAFT_TTL_MS, type PrecisePlanDraft, type PrecisePlanDraftContent,
} from '@/lib/assistantPrecisePlanDraft';

const STALE = '時間草稿已更新或失效，請重新核對目前可恢復的內容。';
const CHOICE = '本分頁已有時間草稿，請先恢復或捨棄；若要保留目前欄位，請明確選擇改存目前時間欄位。';
const INACTIVE = '帳號、登入狀態或校園已切換，這次時間草稿操作已停止。';
const EMPTY = '目前沒有可套用的時間修改內容。';
type Outcome = { ok: boolean; message: string; content?: PrecisePlanDraftContent };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (left: PrecisePlanDraft | null, right: PrecisePlanDraft | null) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Unsent inputs only. The owner separately gates proposal state and execution. */
export function usePrecisePlanDraft(scope: RevisionDraftScope, active: () => boolean) {
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
  const [draft, setDraft] = useState<PrecisePlanDraft | null>(null);
  const offered = useRef<PrecisePlanDraft | null>(null);
  const observed = useRef<PrecisePlanDraft | null>(null);
  const editorOwner = useRef<string | null>(null);
  const [restored, setRestored] = useState(false);
  const restoredRef = useRef(false);
  const [status, setStatus] = useState('');
  const [editorStatuses, setEditorStatuses] = useState<Record<string, string>>({});

  function editorStatus(sourceKey: string, message: string) {
    setEditorStatuses(previous => ({ ...previous, [sourceKey]: message }));
  }
  function setOffer(value: PrecisePlanDraft | null, recovered = false) {
    offered.current = value ? copy(value) : null;
    setDraft(offered.current);
    restoredRef.current = recovered;
    setRestored(recovered);
  }
  function receive(value: PrecisePlanDraft | null) {
    observed.current = value ? copy(value) : null;
    editorOwner.current = null;
    setOffer(value);
  }
  function failure(message: string, sourceKey?: string): Outcome {
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
      const result = readPrecisePlanDraft(bound);
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
    const result = readPrecisePlanDraft(bound);
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
        Date.now() < draft.savedAt + PRECISE_PLAN_DRAFT_TTL_MS) return;
      const result = readPrecisePlanDraft(bound);
      if (!isActive()) return;
      receive(result.draft);
      setStatus(result.message || (result.draft ? STALE : '時間草稿已超過 30 分鐘，請重新編輯。'));
    };
    const timer = window.setTimeout(expire, Math.max(0, draft.savedAt + PRECISE_PLAN_DRAFT_TTL_MS - Date.now()));
    document.addEventListener('visibilitychange', expire);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', expire); };
    // Reads, restores and source rebindings do not renew this deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.savedAt]);

  function commitEditor(source: RevisionDraftSource, content: PrecisePlanDraftContent, replace: boolean): Outcome {
    const read = readCurrent(source.key);
    if (!read.ok) return read.outcome;
    if (!replace && (offered.current || (read.draft && editorOwner.current !== source.key))) {
      if (!offered.current && read.draft) receive(read.draft);
      return failure(CHOICE, source.key);
    }
    if (replace && content.edits.length === 0) return failure(EMPTY, source.key);
    const result = savePrecisePlanDraft(bound, source, content, isActive, Date.now(), { expected: read.draft });
    if (!isActive()) return failure(INACTIVE, source.key);
    if (!result.ok) return failure(result.message || '時間欄位尚未暫存，請保留目前頁面。', source.key);
    observed.current = result.draft ? copy(result.draft) : null;
    editorOwner.current = source.key;
    setOffer(null);
    const message = result.draft
      ? replace ? '已明確改存目前時間欄位，尚未送出。' : '已暫存於本分頁，30 分鐘內可恢復。'
      : '時間修改目前空白，沒有保留草稿。';
    setStatus('');
    editorStatus(source.key, message);
    return { ok: true, message };
  }
  function saveEditor(source: RevisionDraftSource, content: PrecisePlanDraftContent) {
    return commitEditor(source, content, false);
  }
  function replaceEditor(source: RevisionDraftSource, content: PrecisePlanDraftContent) {
    return commitEditor(source, content, true);
  }

  function restore(): Outcome {
    const read = reviewed();
    if (!read.ok) return read.outcome;
    setOffer(read.draft, true);
    const message = '時間草稿已恢復，尚未套用或送出；請核對目前提議後再決定是否帶入欄位。';
    setStatus(message);
    return { ok: true, message };
  }
  function discard(): Outcome {
    const read = reviewed();
    if (!read.ok) return read.outcome;
    const result = clearPrecisePlanDraft(bound, isActive, {
      sourceKey: read.draft.source.key, id: read.draft.id, snapshot: read.draft,
    });
    if (!isActive()) return failure(INACTIVE);
    if (!result.ok) return failure(result.message || STALE);
    receive(null);
    const message = '已捨棄時間草稿，沒有取消或確認任何行程。';
    setStatus(message);
    return { ok: true, message };
  }

  function clearSource(sourceKey: string, beforeDispatch = false): Outcome {
    if (!isActive()) return failure(INACTIVE, sourceKey);
    const read = readPrecisePlanDraft(bound);
    loaded.current = true;
    if (!isActive()) return failure(INACTIVE, sourceKey);
    if (read.status === 'unavailable') return failure(read.message || STALE, sourceKey);
    if (read.draft?.source.key === sourceKey && !same(read.draft, observed.current)) {
      receive(read.draft);
      return failure(STALE, sourceKey);
    }
    const result = clearPrecisePlanDraft(bound, isActive, {
      sourceKey, ...(read.draft?.source.key === sourceKey ? { id: read.draft.id } : {}), snapshot: read.draft,
    });
    if (!isActive()) return failure(INACTIVE, sourceKey);
    if (!result.ok) return failure(result.message || '時間草稿尚未確認清除，這次操作尚未送出。', sourceKey);
    if (!read.draft || read.draft.source.key === sourceKey) { receive(null); setStatus(''); }
    else if (!same(read.draft, observed.current)) receive(read.draft);
    const message = beforeDispatch
      ? '時間草稿已清除；操作結果請依確認卡核對。'
      : '這份時間修改已清除，沒有取消或確認行程。';
    editorStatus(sourceKey, message);
    return { ok: true, message };
  }

  function apply(source: RevisionDraftSource): Outcome {
    if (!restoredRef.current) return failure('請先恢復並核對時間草稿。', source.key);
    const read = reviewed();
    if (!read.ok) return read.outcome;
    const match = precisePlanDraftSourceMatch(read.draft, source);
    if (match === 'mismatch' || match === 'ambiguous')
      return failure(match === 'ambiguous'
        ? '草稿來源有完全相同的行程，無法可靠對應新提議；請保留草稿供核對並重新選擇項目。'
        : '目前提議與草稿來源不同，沒有帶入時間欄位；請保留草稿供核對並重新選擇項目。', source.key);
    if (!read.draft.edits.length) return failure(EMPTY, source.key);
    const content = copy({ selectedIndex: read.draft.selectedIndex, edits: read.draft.edits });
    const result = savePrecisePlanDraft(bound, source, content, isActive, Date.now(), {
      expected: read.draft, savedAt: read.draft.savedAt,
    });
    if (!isActive()) return failure(INACTIVE, source.key);
    if (!result.ok) return failure(result.message || STALE, source.key);
    observed.current = result.draft ? copy(result.draft) : null;
    editorOwner.current = source.key;
    setOffer(null);
    setStatus('');
    const message = '已帶入經逐欄核對的時間草稿，尚未送出；請再次檢查日期與時間。';
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
