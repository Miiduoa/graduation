'use client';

import { useEffect, useRef, useState } from 'react';
import {
  clearRevisionDraft, readRevisionDraft, revisionDraftContentMatches, saveRevisionDraft,
  REVISION_DRAFT_TTL_MS, type RevisionDraft, type RevisionDraftContent,
  type RevisionDraftScope, type RevisionDraftSource,
} from '@/lib/assistantPlanRevisionDraft';

const STALE = '草稿已更新或失效，請重新核對目前可恢復的內容。';

/** Content recovery only. The owner separately checks current proposal and journal readiness. */
export function usePlanRevisionDraft(scope: RevisionDraftScope, active: () => boolean) {
  const [bound] = useState(() => ({ ...scope }));
  const mounted = useRef(false);
  const isActive = () => mounted.current && active() &&
    scope.accountId === bound.accountId && scope.schoolId === bound.schoolId &&
    scope.context === bound.context;
  const [draft, setDraft] = useState<RevisionDraft | null>(null);
  const current = useRef<RevisionDraft | null>(null);
  const persistedId = useRef<string | null>(null);
  const persistedSnapshot = useRef<RevisionDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState('');
  const [editorStatuses, setEditorStatuses] = useState<Record<string, string>>({});

  function offer(value: RevisionDraft | null, recovered: boolean,
    storedId: string | null = value?.id || null, storedValue: RevisionDraft | null = value) {
    current.current = value;
    persistedId.current = storedId;
    persistedSnapshot.current = storedValue;
    setDraft(value);
    setRestored(recovered);
  }
  function editorStatus(sourceKey: string, message: string) {
    setEditorStatuses(previous => ({ ...previous, [sourceKey]: message }));
  }
  useEffect(() => {
    mounted.current = true;
    let live = true;
    queueMicrotask(() => {
      if (!live || !isActive()) return;
      const result = readRevisionDraft(bound);
      offer(result.draft, false);
      setStatus(result.message || '');
    });
    return () => { live = false; mounted.current = false; };
    // The owning conversation is keyed by session, account and school.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-read before every explicit recovery action; storage is never authority. */
  function reviewedDraft(): RevisionDraft | null {
    if (!isActive() || !current.current) return null;
    const previous = current.current;
    const result = readRevisionDraft(bound);
    if (result.status === 'unavailable') {
      setStatus(result.message || STALE);
      return null;
    }
    // An explicitly restored editor may stay open after its last character is cleared.
    // It contains no persisted draft until the user types again.
    if (persistedId.current === null && result.status === 'empty' &&
      Date.now() - previous.savedAt < REVISION_DRAFT_TTL_MS) return previous;
    if (result.draft && result.draft.id === persistedId.current &&
      JSON.stringify(result.draft) === JSON.stringify(persistedSnapshot.current)) return result.draft;
    offer(result.draft, false);
    setStatus(result.message || STALE);
    return null;
  }

  useEffect(() => {
    if (!draft) return;
    const id = draft.id;
    const expire = () => {
      if (!isActive() || current.current?.id !== id) return;
      if (Date.now() >= draft.savedAt + REVISION_DRAFT_TTL_MS) {
        const result = readRevisionDraft(bound);
        // Even failed cleanup must not expose an expired recovery offer.
        if (!result.draft || result.draft.id === id) {
          offer(null, false);
          setStatus(result.message || '修改草稿已超過 30 分鐘，請重新編輯。');
        } else {
          offer(result.draft, false);
          setStatus(STALE);
        }
      }
    };
    const timer = window.setTimeout(expire, Math.max(0, draft.savedAt + REVISION_DRAFT_TTL_MS - Date.now()));
    document.addEventListener('visibilitychange', expire);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', expire); };
    // Do not renew expiry on reads, rerenders, or temporary login revalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.savedAt]);

  function clearSource(sourceKey: string, beforeDispatch = false) {
    const result = clearRevisionDraft(bound, isActive, { sourceKey });
    if (!isActive()) return { ok: false, message: '登入或校園已切換，這次草稿操作已停止。' };
    if (!result.ok) {
      editorStatus(sourceKey, result.message || '草稿尚未確認清除，這次操作尚未送出。');
      return { ok: false, message: result.message };
    }
    if (current.current?.source.key === sourceKey) offer(null, false);
    const message = beforeDispatch ? '修改草稿已清除；操作結果請依確認卡核對。' : '這份修改內容已清除，沒有取消或確認行程。';
    editorStatus(sourceKey, message);
    return { ok: true, message };
  }

  function saveEditor(source: RevisionDraftSource, content: RevisionDraftContent) {
    if (!isActive()) return;
    if (!content.instruction && !content.protectedIndices.length) {
      clearSource(source.key);
      return;
    }
    const previousOffer = current.current;
    const result = saveRevisionDraft(bound, source, content, isActive);
    if (!isActive()) return;
    if (!result.ok) {
      editorStatus(source.key, result.message || '這份修改尚未暫存，請保留目前頁面。');
      return;
    }
    // One scope keeps its most recently edited draft, never a history of conversations.
    offer(null, false);
    setStatus(previousOffer ? '已以目前編輯取代本分頁先前的修訂草稿。' : '');
    editorStatus(source.key, '已暫存於本分頁，30 分鐘內可恢復。');
  }

  function restore() {
    const value = reviewedDraft();
    if (!value) return;
    offer(value, true, persistedId.current);
    setStatus('草稿內容已恢復，尚未送出；請先取得並核對目前有效的行程提議。');
  }
  function discard() {
    if (!reviewedDraft()) return;
    const result = clearRevisionDraft(bound, isActive,
      persistedId.current ? { id: persistedId.current } : { sourceKey: current.current!.source.key });
    if (!isActive()) return;
    if (!result.ok) { setStatus(result.message || STALE); return; }
    offer(null, false);
    setStatus('已捨棄修訂草稿，沒有取消或確認任何行程。');
  }
  function changeRecovered(instruction: string) {
    const previous = current.current;
    const value = reviewedDraft();
    if (!value || !restored) {
      // A read failure cannot discard typing in the already restored local editor.
      // Do not resurrect content that validation expired, replaced, or hid.
      if (isActive() && restored && previous && current.current === previous)
        offer({ ...previous, instruction }, true, persistedId.current, persistedSnapshot.current);
      return;
    }
    const result = saveRevisionDraft(bound, value.source,
      { instruction, protectedIndices: value.protectedIndices }, isActive);
    if (!isActive()) return;
    if (!result.ok) {
      // Keep the user's current text in memory while retaining the last stored revision ID.
      offer({ ...value, instruction }, true, persistedId.current, persistedSnapshot.current);
      setStatus(result.message || '這份修改尚未暫存，請保留目前頁面。');
      return;
    }
    offer(result.draft || { ...value, instruction, savedAt: Date.now() }, true, result.draft?.id || null, result.draft);
    setStatus(result.draft ? '已更新本分頁草稿，尚未送出。' : '修改內容目前空白，沒有保存新的草稿。');
  }
  function apply(source: RevisionDraftSource) {
    const value = reviewedDraft();
    if (!value || !restored) return { ok: false, message: STALE };
    const sameContent = revisionDraftContentMatches(value, source);
    const content = { instruction: current.current?.instruction ?? value.instruction,
      protectedIndices: sameContent ? [...value.protectedIndices] : [] };
    if (!content.instruction && !content.protectedIndices.length)
      return { ok: false, message: '草稿目前沒有可套用的修改內容。' };
    const result = saveRevisionDraft(bound, source, content, isActive);
    if (!isActive()) return { ok: false, message: '登入或校園已切換，這次套用已停止。' };
    if (!result.ok) { setStatus(result.message || STALE); return { ok: false, message: result.message }; }
    offer(null, false);
    const message = sameContent
      ? '已套用修改文字與經逐欄核對的保留選項，尚未送出；請再檢查目前提議。'
      : '已帶入修改文字；目前提議與草稿來源不同，請重新選擇保留項目。';
    editorStatus(source.key, message);
    setStatus(message);
    return { ok: true, message, content };
  }

  const sameScope = scope.accountId === bound.accountId &&
    scope.schoolId === bound.schoolId && scope.context === bound.context;
  return {
    draft: sameScope ? draft : null, restored: sameScope && restored,
    status: sameScope ? status : '', editorStatuses,
    restore, discard, changeRecovered, saveEditor, clearSource, apply,
  };
}
