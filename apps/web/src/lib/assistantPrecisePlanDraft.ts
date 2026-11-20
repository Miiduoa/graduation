'use client';

import { REVISION_DRAFT_TTL_MS, type RevisionDraftSource } from './assistantPlanRevisionDraft';

import { createPlanDraftStorage, draftDataObject as dataObject, draftDataArray as dataArray,
  draftSourceValue as sourceValue, draftRawContent as rawContent, invalidPlanDraft as invalid,
} from './assistantPlanDraftStorage';

export type PrecisePlanEdit = {
  index: number;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
};
export type PrecisePlanDraftContent = { selectedIndex: number; edits: PrecisePlanEdit[] };
export type PrecisePlanDraft = PrecisePlanDraftContent & {
  version: 1;
  id: string;
  scopeKey: string;
  source: RevisionDraftSource;
  savedAt: number;
};
export type PrecisePlanDraftReadResult = {
  draft: PrecisePlanDraft | null;
  status: 'empty' | 'ready' | 'expired' | 'invalid' | 'unavailable';
  message?: string;
};
export type PrecisePlanDraftSaveResult = { ok: boolean; draft: PrecisePlanDraft | null; message?: string };
export type PrecisePlanDraftClearResult = { ok: boolean; cleared: boolean; message?: string };
export type PrecisePlanDraftSourceMatch = 'exact' | 'fresh' | 'ambiguous' | 'mismatch';
export type PrecisePlanDraftSaveOptions = { expected?: PrecisePlanDraft | null; savedAt?: number };
export type PrecisePlanDraftClearMatch = { sourceKey?: string; id?: string; snapshot?: PrecisePlanDraft | null };

export const PRECISE_PLAN_DRAFT_TTL_MS = REVISION_DRAFT_TTL_MS;
export const PRECISE_PLAN_DRAFT_MAX_BYTES = 16 * 1024;
const MAX_EDITS = 16;
const EDIT_FIELDS = ['index', 'date', 'endDate', 'startTime', 'endTime'] as const;
function timedIndex(raw: unknown, source: RevisionDraftSource): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 ||
    raw >= source.events.length || source.events[raw].allDay !== false) return invalid();
  return raw;
}
function contentValue(content: unknown, source: RevisionDraftSource): PrecisePlanDraftContent {
  const value = dataObject(content, ['selectedIndex', 'edits']);
  const selectedIndex = timedIndex(value.selectedIndex, source), seen = new Set<number>();
  const edits = dataArray(value.edits, MAX_EDITS).map(raw => {
    const row = dataObject(raw, EDIT_FIELDS), index = timedIndex(row.index, source);
    if (seen.has(index)) return invalid();
    seen.add(index);
    for (const field of ['date', 'endDate', 'startTime', 'endTime'] as const) {
      if (typeof row[field] !== 'string' || row[field].length > (field.endsWith('Time') ? 5 : 10)) return invalid();
    }
    // Unfinished editor input is data, not a proposed event or execution authority.
    return { index, date: row.date as string, endDate: row.endDate as string,
      startTime: row.startTime as string, endTime: row.endTime as string };
  });
  return { selectedIndex, edits };
}
const storage = createPlanDraftStorage<PrecisePlanDraftContent>({
  prefix: 'campus.assistant-time-draft.v1:', ttl: PRECISE_PLAN_DRAFT_TTL_MS, maxBytes: PRECISE_PLAN_DRAFT_MAX_BYTES,
  contentFields: ['selectedIndex', 'edits'], contentValue, isEmpty: content => content.edits.length === 0,
  messages: {
    invalid: '日期與時間草稿內容無法核對，請重新編輯。',
    inactive: '帳號、登入狀態或校園已切換，這次草稿儲存已停止。',
    storage: '瀏覽器無法存取日期與時間草稿；目前輸入仍需由此頁保留，重新載入後可能遺失。',
    read: '瀏覽器無法讀取日期與時間草稿，請保留目前頁面並稍後再試。',
    save: '日期與時間草稿尚未確認儲存，請保留目前頁面並確認瀏覽器儲存空間。',
    remove: '日期與時間草稿尚未確認清除，請保留目前頁面並稍後再試。',
    changed: '日期與時間草稿已有更新，這次沒有覆蓋或清除較新的內容。',
    expired: '日期與時間草稿已超過 30 分鐘，請重新編輯。',
  },
});
/** Only exact ordered raw content can be rebound; duplicate edited rows need their original source. */
export function precisePlanDraftSourceMatch(
  draft: PrecisePlanDraft, source: RevisionDraftSource,
): PrecisePlanDraftSourceMatch {
  try {
    const saved = storage.validate(draft), current = sourceValue(source);
    if (rawContent(saved.source.events) !== rawContent(current.events)) return 'mismatch';
    if (saved.source.key === current.key) return 'exact';
    const counts = new Map<string, number>();
    for (const event of current.events) {
      const raw = rawContent([event]);
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
    return saved.edits.some(edit => counts.get(rawContent([current.events[edit.index]])) !== 1) ? 'ambiguous' : 'fresh';
  } catch { return 'mismatch'; }
}

export const readPrecisePlanDraft = storage.read;
export const savePrecisePlanDraft = storage.save;
export const clearPrecisePlanDraft = storage.clear;
