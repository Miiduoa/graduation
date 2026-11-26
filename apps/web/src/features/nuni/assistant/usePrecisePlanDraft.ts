'use client';

import type { RevisionDraftScope } from '@/lib/assistantPlanRevisionDraft';
import {
  clearPrecisePlanDraft, precisePlanDraftSourceMatch, readPrecisePlanDraft, savePrecisePlanDraft,
  PRECISE_PLAN_DRAFT_TTL_MS, type PrecisePlanDraftContent,
} from '@/lib/assistantPrecisePlanDraft';
import { usePlanDraft, type PlanDraftHookPolicy } from './usePlanDraft';

const policy: PlanDraftHookPolicy<PrecisePlanDraftContent, []> = {
  storage: { read: readPrecisePlanDraft, save: savePrecisePlanDraft, clear: clearPrecisePlanDraft },
  ttl: PRECISE_PLAN_DRAFT_TTL_MS, isEmpty: content => content.edits.length === 0,
  messages: {
    stale: '時間草稿已更新或失效，請重新核對目前可恢復的內容。',
    choice: '本分頁已有時間草稿，請先恢復或捨棄；若要保留目前欄位，請明確選擇改存目前時間欄位。',
    inactive: '帳號、登入狀態或校園已切換，這次時間草稿操作已停止。',
    empty: '目前沒有可套用的時間修改內容。',
    expired: '時間草稿已超過 30 分鐘，請重新編輯。',
    saveFailure: '時間欄位尚未暫存，請保留目前頁面。',
    replaced: '已明確改存目前時間欄位，尚未送出。',
    saved: '已暫存於本分頁，30 分鐘內可恢復。',
    emptySaved: '時間修改目前空白，沒有保留草稿。',
    restored: '時間草稿已恢復，尚未套用或送出；請核對目前提議後再決定是否帶入欄位。',
    discarded: '已捨棄時間草稿，沒有取消或確認任何行程。',
    clearFailure: '時間草稿尚未確認清除，這次操作尚未送出。',
    clearedForDispatch: '時間草稿已清除；操作結果請依確認卡核對。',
    cleared: '這份時間修改已清除，沒有取消或確認行程。',
    restoreFirst: '請先恢復並核對時間草稿。',
  },
  prepare(draft, source) {
    const match = precisePlanDraftSourceMatch(draft, source);
    if (match === 'mismatch' || match === 'ambiguous') return { ok: false, message: match === 'ambiguous'
      ? '草稿來源有完全相同的行程，無法可靠對應新提議；請保留草稿供核對並重新選擇項目。'
      : '目前提議與草稿來源不同，沒有帶入時間欄位；請保留草稿供核對並重新選擇項目。' };
    if (!draft.edits.length) return { ok: false, message: '目前沒有可套用的時間修改內容。' };
    return { ok: true, content: { selectedIndex: draft.selectedIndex, edits: draft.edits },
      message: '已帶入經逐欄核對的時間草稿，尚未送出；請再次檢查日期與時間。' };
  },
};
export function usePrecisePlanDraft(scope: RevisionDraftScope, active: () => boolean) {
  return usePlanDraft(scope, active, policy);
}
