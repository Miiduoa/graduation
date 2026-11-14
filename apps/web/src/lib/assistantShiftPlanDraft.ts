'use client';

import { REVISION_DRAFT_TTL_MS, type RevisionDraftSource } from './assistantPlanRevisionDraft';
import {
  createPlanDraftStorage, draftDataArray, draftDataObject, draftRawContent, draftSourceValue, invalidPlanDraft,
  type PlanDraft, type PlanDraftReadResult, type PlanDraftSaveResult, type PlanDraftClearResult,
  type PlanDraftSaveOptions, type PlanDraftClearMatch,
} from './assistantPlanDraftStorage';

export type ShiftPlanDraftContent = {
  mode: 'shift'; direction: 'later' | 'earlier'; minutes: string;
  selectedIndices: number[]; protectedIndices: number[];
};
export type ShiftPlanDraft = PlanDraft<ShiftPlanDraftContent>;
export type ShiftPlanDraftReadResult = PlanDraftReadResult<ShiftPlanDraft>;
export type ShiftPlanDraftSaveResult = PlanDraftSaveResult<ShiftPlanDraft>;
export type ShiftPlanDraftClearResult = PlanDraftClearResult;
export type ShiftPlanDraftSaveOptions = PlanDraftSaveOptions<ShiftPlanDraft>;
export type ShiftPlanDraftClearMatch = PlanDraftClearMatch<ShiftPlanDraft>;
export type ShiftPlanDraftSourceMatch = 'exact' | 'reselect';
export const SHIFT_PLAN_DRAFT_TTL_MS = REVISION_DRAFT_TTL_MS;
export const SHIFT_PLAN_DRAFT_MAX_BYTES = 16 * 1024;

function indices(raw: unknown, source: RevisionDraftSource): number[] {
  const seen = new Set<number>();
  for (const index of draftDataArray(raw, 16)) {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 ||
      index >= source.events.length || seen.has(index)) return invalidPlanDraft();
    seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}
function contentValue(raw: unknown, source: RevisionDraftSource): ShiftPlanDraftContent {
  const value = draftDataObject(raw, ['mode', 'direction', 'minutes', 'selectedIndices', 'protectedIndices']);
  if (value.mode !== 'shift' || (value.direction !== 'later' && value.direction !== 'earlier') ||
    typeof value.minutes !== 'string' || value.minutes.length > 16) return invalidPlanDraft();
  const selectedIndices = indices(value.selectedIndices, source), protectedIndices = indices(value.protectedIndices, source);
  if (selectedIndices.some(index => source.events[index].allDay || protectedIndices.includes(index))) return invalidPlanDraft();
  // Empty selection and unfinished/invalid minute strings remain unsent editor intent.
  return { mode: 'shift', direction: value.direction, minutes: value.minutes, selectedIndices, protectedIndices };
}
const storage = createPlanDraftStorage<ShiftPlanDraftContent>({
  prefix: 'campus.assistant-shift-draft.v1:', ttl: SHIFT_PLAN_DRAFT_TTL_MS, maxBytes: SHIFT_PLAN_DRAFT_MAX_BYTES,
  contentFields: ['mode', 'direction', 'minutes', 'selectedIndices', 'protectedIndices'], contentValue,
  isEmpty: () => false,
  messages: {
    invalid: '整組時間草稿內容無法核對，請重新編輯。',
    inactive: '帳號、登入狀態或校園已切換，這次草稿儲存已停止。',
    storage: '瀏覽器無法存取整組時間草稿；目前輸入仍需由此頁保留，重新載入後可能遺失。',
    read: '瀏覽器無法讀取整組時間草稿，請保留目前頁面並稍後再試。',
    save: '整組時間草稿尚未確認儲存，請保留目前頁面並確認瀏覽器儲存空間。',
    remove: '整組時間草稿尚未確認清除，請保留目前頁面並稍後再試。',
    changed: '整組時間草稿已有更新，這次沒有覆蓋或清除較新的內容。',
    expired: '整組時間草稿已超過 30 分鐘，請重新編輯。',
  },
});

/** Selection belongs to exact signed source content and current locks, never merely to matching names. */
export function shiftPlanDraftSourceMatch(
  draft: ShiftPlanDraft, source: RevisionDraftSource, currentProtectedIndices: number[],
): ShiftPlanDraftSourceMatch {
  try {
    const saved = storage.validate(draft), current = draftSourceValue(source);
    const protectedIndices = indices(currentProtectedIndices, current);
    return saved.source.key === current.key && draftRawContent(saved.source.events) === draftRawContent(current.events) &&
      JSON.stringify(saved.protectedIndices) === JSON.stringify(protectedIndices) ? 'exact' : 'reselect';
  } catch { return 'reselect'; }
}
export const readShiftPlanDraft = storage.read;
export const saveShiftPlanDraft = storage.save;
export const clearShiftPlanDraft = storage.clear;
