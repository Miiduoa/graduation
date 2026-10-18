import { makeScopedStorageKey } from './tenant';

export const SENSE_STATE_VERSION = 1 as const;
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 60 * 60 * 1000;
export const SENSE_CARD_LIMIT = 8;

export const SENSE_SECTION_TITLE = '現在可處理';
export const SENSE_SECTION_NOTE =
  '依現在時間與已讀到的課程待辦即時計算。沒有接模型，也不會在背景持續感知。';
export const SENSE_UNSIGNED_TEXT = '登入後才會依你已讀到的待辦顯示可處理事項。';
export const SENSE_EMPTY_TEXT =
  '目前沒有需要立即處理的事項。這是依現在時間與已讀到的待辦算出來的，不是範例。';
export const SENSE_HANDLE_PREVIEW =
  '只從今天這份處理清單移出，不會幫你繳交作業、作答測驗或完成點名。';
export const SENSE_SNOOZE_PREVIEW =
  '一小時內不再顯示這張卡。到期後若條件仍成立會再出現。不會改作業、測驗或點名狀態。';
export const SENSE_HANDLE_ACTION = '從清單移出';
export const SENSE_SNOOZE_ACTION = '稍後一小時';
export const SENSE_HANDLE_CONFIRM = '確認移出';
export const SENSE_SNOOZE_CONFIRM = '確認稍後';
export const SENSE_UNDO_ACTION = '撤銷上次操作';
export const SENSE_CANCEL_ACTION = '取消';
export const SENSE_RECORD_NOT_REVERSIBLE = '此筆紀錄不能再撤銷。';
export const SENSE_SAVE_FAILED_TEXT = '這次沒有存成功，清單維持原樣。';
export const SENSE_MOBILE_SAVE_FAILED_TEXT = '沒存成功，已恢復原來的清單。';

export type SenseItemKind = 'live' | 'assignment' | 'quiz';
export type SenseKind = 'live_now' | 'overdue' | 'due_soon';
export type SenseActionId = 'open' | 'handle' | 'snooze' | 'undo';
export type SenseActionPermission = 'direct' | 'preview_confirm' | 'never';
export type SensePhase = 'hidden' | 'unsigned' | 'loading' | 'error' | 'ready';

export type SenseInputItem = {
  id: string;
  kind: SenseItemKind;
  courseId: string;
  courseName: string;
  title: string;
  dueAt?: string | null;
  href?: string;
};

export type SenseAction = {
  id: SenseActionId;
  label: string;
  permission: SenseActionPermission;
  preview?: string;
  reversible: boolean;
};

export type SenseCard = {
  id: string;
  kind: SenseKind;
  title: string;
  why: string;
  courseName: string;
  itemId: string;
  courseId: string;
  itemKind: SenseItemKind;
  href?: string;
  dueAt?: string | null;
  triggeredAt: string;
  actions: SenseAction[];
};

export type SenseRecord = {
  at: string;
  action: 'handle' | 'snooze' | 'undo';
  cardId: string;
  title: string;
  summary: string;
  reversible: boolean;
  restore?: {
    handledAt: string | null;
    snoozedUntil: string | null;
  };
};

export type SenseState = {
  version: typeof SENSE_STATE_VERSION;
  handled: Record<string, { at: string }>;
  snoozedUntil: Record<string, string>;
  lastRecord: SenseRecord | null;
};

export function emptySenseState(): SenseState {
  return { version: SENSE_STATE_VERSION, handled: {}, snoozedUntil: {}, lastRecord: null };
}

export function senseStorageKey(uid: string, schoolId?: string | null): string {
  return makeScopedStorageKey('todaySense', { uid, schoolId: schoolId || undefined });
}

export function parseSenseState(raw: string | null | undefined): SenseState {
  if (!raw || !raw.trim()) return emptySenseState();
  try {
    const parsed = JSON.parse(raw) as Partial<SenseState>;
    if (!parsed || parsed.version !== SENSE_STATE_VERSION || typeof parsed !== 'object') {
      return emptySenseState();
    }
    return {
      version: SENSE_STATE_VERSION,
      handled: isRecord(parsed.handled) ? sanitizeHandled(parsed.handled) : {},
      snoozedUntil: isRecord(parsed.snoozedUntil) ? sanitizeSnoozed(parsed.snoozedUntil) : {},
      lastRecord: parseRecord(parsed.lastRecord),
    };
  } catch {
    return emptySenseState();
  }
}

export function serializeSenseState(state: SenseState): string {
  return JSON.stringify(state);
}

export function formatTaipeiDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間不明';
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function openSenseLabel(kind: SenseItemKind): string {
  if (kind === 'live') return '前往簽到';
  if (kind === 'quiz') return '前往這份測驗';
  return '前往這份作業';
}

export function senseTruncationNote(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  return `另有 ${hiddenCount} 則符合條件未列出，先處理時間最早的。`;
}

export function formatSenseRecord(record: SenseRecord | null): string {
  if (!record) return '';
  const undo = record.reversible ? '可撤銷。' : SENSE_RECORD_NOT_REVERSIBLE;
  return `${formatTaipeiDateTime(record.at)} ${record.summary} ${undo}`;
}

export function selectSenseCards(input: {
  now: Date;
  items: SenseInputItem[];
  state: SenseState;
}): { cards: SenseCard[]; hiddenCount: number } {
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) return { cards: [], hiddenCount: 0 };
  const triggeredAt = input.now.toISOString();
  const ranked: Array<{ card: SenseCard; rank: number; dueMs: number }> = [];

  for (const item of input.items) {
    const kind = classifyItem(item, nowMs);
    if (!kind) continue;
    const cardId = makeSenseCardId(kind, item);
    if (input.state.handled[cardId]) continue;
    const snoozeUntil = Date.parse(input.state.snoozedUntil[cardId] || '');
    if (Number.isFinite(snoozeUntil) && snoozeUntil > nowMs) continue;
    const card = buildCard(kind, item, triggeredAt);
    ranked.push({
      card,
      rank: kind === 'live_now' ? 0 : kind === 'overdue' ? 1 : 2,
      dueMs: item.dueAt ? Date.parse(item.dueAt) : 0,
    });
  }

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    return left.dueMs - right.dueMs;
  });
  return {
    cards: ranked.slice(0, SENSE_CARD_LIMIT).map((row) => row.card),
    hiddenCount: Math.max(0, ranked.length - SENSE_CARD_LIMIT),
  };
}

export function applySenseAction(
  state: SenseState,
  action: 'handle' | 'snooze',
  card: Pick<SenseCard, 'id' | 'title'>,
  now: Date,
): SenseState {
  const at = now.toISOString();
  const handledAt = state.handled[card.id]?.at ?? null;
  const snoozedUntil = state.snoozedUntil[card.id] ?? null;
  const handled = { ...state.handled };
  const snoozed = { ...state.snoozedUntil };
  if (action === 'handle') {
    handled[card.id] = { at };
    delete snoozed[card.id];
  } else {
    snoozed[card.id] = new Date(now.getTime() + SNOOZE_MS).toISOString();
  }
  const summary =
    action === 'handle' ? `已從清單移出「${card.title}」。` : `已將「${card.title}」稍後一小時。`;
  return {
    version: SENSE_STATE_VERSION,
    handled,
    snoozedUntil: snoozed,
    lastRecord: {
      at,
      action,
      cardId: card.id,
      title: card.title,
      summary,
      reversible: true,
      restore: { handledAt, snoozedUntil },
    },
  };
}

export function undoLastSenseAction(
  state: SenseState,
  now: Date,
): { ok: true; state: SenseState } | { ok: false; state: SenseState } {
  const record = state.lastRecord;
  if (!record?.reversible || !record.restore) {
    return { ok: false, state };
  }
  const handled = { ...state.handled };
  const snoozed = { ...state.snoozedUntil };
  if (record.restore.handledAt) {
    handled[record.cardId] = { at: record.restore.handledAt };
  } else {
    delete handled[record.cardId];
  }
  if (record.restore.snoozedUntil) {
    snoozed[record.cardId] = record.restore.snoozedUntil;
  } else {
    delete snoozed[record.cardId];
  }
  return {
    ok: true,
    state: {
      version: SENSE_STATE_VERSION,
      handled,
      snoozedUntil: snoozed,
      lastRecord: {
        at: now.toISOString(),
        action: 'undo',
        cardId: record.cardId,
        title: record.title,
        summary: `已撤銷對「${record.title}」的操作。`,
        reversible: false,
      },
    },
  };
}

export function makeSenseCardId(
  kind: SenseKind,
  item: Pick<SenseInputItem, 'courseId' | 'id'>,
): string {
  return `${kind}:${item.courseId}:${item.id}`;
}

function classifyItem(item: SenseInputItem, nowMs: number): SenseKind | null {
  if (item.kind === 'live') return 'live_now';
  const dueMs = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  if (!Number.isFinite(dueMs)) return null;
  if (dueMs < nowMs) return 'overdue';
  if (dueMs - nowMs <= DUE_SOON_MS) return 'due_soon';
  return null;
}

function buildCard(kind: SenseKind, item: SenseInputItem, triggeredAt: string): SenseCard {
  const dueLabel = item.dueAt ? formatTaipeiDateTime(item.dueAt) : '';
  const when = formatTaipeiDateTime(triggeredAt);
  const signal =
    kind === 'live_now'
      ? `依據課程「${item.courseName}」進行中的點名時段`
      : kind === 'overdue'
        ? `依據${item.kind === 'quiz' ? '測驗' : '作業'}「${item.title}」已過截止時間（${dueLabel}）`
        : `依據${item.kind === 'quiz' ? '測驗' : '作業'}「${item.title}」將於 24 小時內截止（${dueLabel}）`;
  return {
    id: makeSenseCardId(kind, item),
    kind,
    title: item.title,
    why: `${signal}，於 ${when}（台灣時間）觸發。`,
    courseName: item.courseName,
    itemId: item.id,
    courseId: item.courseId,
    itemKind: item.kind,
    href: item.href,
    dueAt: item.dueAt ?? null,
    triggeredAt,
    actions: [
      {
        id: 'open',
        label: openSenseLabel(item.kind),
        permission: 'direct',
        reversible: false,
      },
      {
        id: 'snooze',
        label: SENSE_SNOOZE_ACTION,
        permission: 'preview_confirm',
        preview: SENSE_SNOOZE_PREVIEW,
        reversible: true,
      },
      {
        id: 'handle',
        label: SENSE_HANDLE_ACTION,
        permission: 'preview_confirm',
        preview: SENSE_HANDLE_PREVIEW,
        reversible: true,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeHandled(value: Record<string, unknown>): Record<string, { at: string }> {
  const next: Record<string, { at: string }> = {};
  for (const [key, entry] of Object.entries(value)) {
    const at = isRecord(entry) && typeof entry.at === 'string' ? entry.at : '';
    if (key && at) next[key] = { at };
  }
  return next;
}

function sanitizeSnoozed(value: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, until] of Object.entries(value)) {
    if (key && typeof until === 'string' && Number.isFinite(Date.parse(until))) next[key] = until;
  }
  return next;
}

function parseRecord(value: unknown): SenseRecord | null {
  if (!isRecord(value)) return null;
  if (value.action !== 'handle' && value.action !== 'snooze' && value.action !== 'undo')
    return null;
  if (typeof value.at !== 'string' || typeof value.cardId !== 'string') return null;
  const restore = isRecord(value.restore)
    ? {
        handledAt: typeof value.restore.handledAt === 'string' ? value.restore.handledAt : null,
        snoozedUntil:
          typeof value.restore.snoozedUntil === 'string' ? value.restore.snoozedUntil : null,
      }
    : undefined;
  return {
    at: value.at,
    action: value.action,
    cardId: value.cardId,
    title: typeof value.title === 'string' ? value.title : '',
    summary: typeof value.summary === 'string' ? value.summary : '',
    reversible: value.reversible === true,
    restore,
  };
}
