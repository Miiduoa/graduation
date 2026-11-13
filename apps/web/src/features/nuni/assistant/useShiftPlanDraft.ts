'use client';

import type { RevisionDraftScope } from '@/lib/assistantPlanRevisionDraft';
import {
  clearShiftPlanDraft, shiftPlanDraftSourceMatch, readShiftPlanDraft, saveShiftPlanDraft,
  SHIFT_PLAN_DRAFT_TTL_MS, type ShiftPlanDraftContent,
} from '@/lib/assistantShiftPlanDraft';
import { usePlanDraft, type PlanDraftHookPolicy } from './usePlanDraft';

const policy: PlanDraftHookPolicy<ShiftPlanDraftContent, [number[]]> = {
  storage: { read: readShiftPlanDraft, save: saveShiftPlanDraft, clear: clearShiftPlanDraft },
  ttl: SHIFT_PLAN_DRAFT_TTL_MS, isEmpty: () => false,
  messages: {
    stale: '整組時間草稿已更新或失效，請重新核對目前可恢復的內容。',
    choice: '本分頁已有整組時間草稿，請先恢復或捨棄；若要保留目前欄位，請明確選擇改存目前平移設定。',
    inactive: '帳號、登入狀態或校園已切換，這次整組時間草稿操作已停止。',
    empty: '目前沒有可套用的平移設定。',
    expired: '整組時間草稿已超過 30 分鐘，請重新編輯。',
    saveFailure: '平移設定尚未暫存，請保留目前頁面。',
    replaced: '已明確改存目前平移設定，尚未送出。',
    saved: '已暫存於本分頁，30 分鐘內可恢復。',
    emptySaved: '目前沒有保留整組時間草稿。',
    restored: '整組時間草稿已恢復，尚未套用或送出；請核對目前提議及保留項目。',
    discarded: '已捨棄整組時間草稿，沒有取消或確認任何行程。',
    clearFailure: '整組時間草稿尚未確認清除，這次操作尚未送出。',
    clearedForDispatch: '整組時間草稿已清除；操作結果請依確認卡核對。',
    cleared: '這份平移設定已清除，沒有取消或確認行程。',
    restoreFirst: '請先恢復並核對整組時間草稿。',
  },
  prepare(draft, source, currentProtectedIndices) {
    const exact = shiftPlanDraftSourceMatch(draft, source, currentProtectedIndices) === 'exact';
    return { ok: true, content: {
      mode: 'shift', direction: draft.direction, minutes: draft.minutes,
      selectedIndices: exact ? draft.selectedIndices : [], protectedIndices: currentProtectedIndices,
    }, message: exact
      ? '已帶入原來源的平移設定，尚未送出；請再次核對選取與保留項目。'
      : '只帶入方向與分鐘數；提議或保留項目已改變，請重新選擇要平移的行程。' };
  },
};
export function useShiftPlanDraft(scope: RevisionDraftScope, active: () => boolean) {
  return usePlanDraft(scope, active, policy);
}
