import { makeScopedStorageKey } from './tenant';
import { formatTaipeiDateTime, type SenseCard } from './todaySense';

export const AGENT_CONSENT_VERSION = 1 as const;
export const AGENT_MODEL_ID = 'onnx-community/Qwen3-4B-ONNX';
export const AGENT_MODEL_DTYPE = 'q4f16';
export const AGENT_MODEL_ONNX_BYTES = 2_832_918_673;
export const AGENT_DOWNLOAD_NOTE =
  '可下載裝置端模型，用來判斷今天先處理哪一件。約 2.8 GB，請用 Wi-Fi。課名、時間與截止仍由程式照原樣顯示。';
export const AGENT_DOWNLOAD_ACTION = '下載並使用';
export const AGENT_DECLINE_ACTION = '不用';
export const AGENT_LOADING_TEXT = '正在準備裝置端模型…';
export const AGENT_PLAN_TITLE = '建議處理順序';
export const AGENT_PLAN_NOTE = '課名與時間未改；只是判斷先後。動作仍要你確認。';

export const AGENT_REASON_CODES = [
  'happening_now',
  'due_soon_hard_stop',
  'already_overdue',
  'can_wait',
] as const;
export type AgentReasonCode = (typeof AGENT_REASON_CODES)[number];

export const AGENT_STEP_ACTIONS = ['open', 'snooze'] as const;
export type AgentStepAction = (typeof AGENT_STEP_ACTIONS)[number];

export const AGENT_EXTRACT_KINDS = ['assignment', 'quiz', 'live', 'info'] as const;
export type AgentExtractKind = (typeof AGENT_EXTRACT_KINDS)[number];

export type AgentConsent = 'unset' | 'accepted' | 'refused';

export type AgentCatalogCourse = { id: string; name: string };

export type AgentExtract = {
  hasActionableTask: boolean;
  courseId: string | null;
  titleSpan: string;
  dueSpan: string;
  kind: AgentExtractKind;
  quote: string;
};

export type AgentStep = {
  cardId: string;
  action: AgentStepAction;
  reasonCode: AgentReasonCode;
};

export type AgentJudgement = {
  order: string[];
  steps: AgentStep[];
};

export type AgentPlanRow = {
  card: SenseCard;
  reasonCode: AgentReasonCode;
  reasonText: string;
};

export type AgentValidation<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const HARD_STOP_MS = 6 * 60 * 60 * 1000;

export function agentConsentStorageKey(uid: string, schoolId?: string | null): string {
  return makeScopedStorageKey('todaySenseAgent', { uid, schoolId: schoolId || undefined });
}

export function parseAgentConsent(raw: string | null | undefined): AgentConsent {
  if (!raw || !raw.trim()) return 'unset';
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; value?: unknown };
    if (parsed?.version !== AGENT_CONSENT_VERSION) return 'unset';
    if (parsed.value === 'accepted' || parsed.value === 'refused') return parsed.value;
    return 'unset';
  } catch {
    return 'unset';
  }
}

export function serializeAgentConsent(value: Exclude<AgentConsent, 'unset'>): string {
  return JSON.stringify({ version: AGENT_CONSENT_VERSION, value });
}

export function canOfferOnDeviceAgent(
  gpu: unknown,
  cardCount: number,
): boolean {
  return Boolean(gpu) && cardCount >= 2;
}

export function reasonCodeForCard(card: SenseCard, now: Date): AgentReasonCode {
  if (card.kind === 'live_now') return 'happening_now';
  if (card.kind === 'overdue') return 'already_overdue';
  const dueMs = card.dueAt ? Date.parse(card.dueAt) : Number.NaN;
  if (Number.isFinite(dueMs) && dueMs - now.getTime() <= HARD_STOP_MS) {
    return 'due_soon_hard_stop';
  }
  return 'can_wait';
}

export function reasonTextForCard(card: SenseCard, reasonCode: AgentReasonCode): string {
  const dueLabel = card.dueAt ? formatTaipeiDateTime(card.dueAt) : '';
  if (reasonCode === 'happening_now') return '進行中，錯過就無法補。';
  if (reasonCode === 'already_overdue') {
    return dueLabel ? `已經過截止（${dueLabel}），仍可能補交。` : '已經過截止，仍可能補交。';
  }
  if (reasonCode === 'due_soon_hard_stop') {
    return dueLabel
      ? `幾小時內截止（${dueLabel}），過了就不能再交或再考。`
      : '幾小時內截止，過了就不能再交或再考。';
  }
  return dueLabel ? `還沒到截止（${dueLabel}），可以排後面。` : '還沒到截止，可以排後面。';
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripThink(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validateExtract(
  raw: string,
  input: { sourceText: string; catalog: AgentCatalogCourse[] },
): AgentValidation<AgentExtract> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return { ok: false, reason: '不是可解析的 JSON' };
  const hasActionableTask = parsed.hasActionableTask;
  if (hasActionableTask !== true && hasActionableTask !== false) {
    return { ok: false, reason: 'hasActionableTask 不是布林' };
  }
  const catalogIds = new Set(input.catalog.map((row) => row.id));
  let courseId: string | null = null;
  if (parsed.courseId != null && parsed.courseId !== '') {
    if (typeof parsed.courseId !== 'string' || !catalogIds.has(parsed.courseId)) {
      return { ok: false, reason: 'courseId 不在課程表' };
    }
    courseId = parsed.courseId;
  }
  const kind = parsed.kind;
  if (typeof kind !== 'string' || !isExtractKind(kind)) {
    return { ok: false, reason: 'kind 不在允許清單' };
  }
  const titleSpan = typeof parsed.titleSpan === 'string' ? parsed.titleSpan : '';
  const dueSpan = typeof parsed.dueSpan === 'string' ? parsed.dueSpan : '';
  const quote = typeof parsed.quote === 'string' ? parsed.quote : '';
  if (quote && !input.sourceText.includes(quote)) {
    return { ok: false, reason: 'quote 不是原文連續字' };
  }
  if (titleSpan && !input.sourceText.includes(titleSpan)) {
    return { ok: false, reason: 'titleSpan 不是原文連續字' };
  }
  if (dueSpan && !input.sourceText.includes(dueSpan)) {
    return { ok: false, reason: 'dueSpan 不是原文連續字' };
  }
  if (!hasActionableTask) {
    if (courseId) return { ok: false, reason: '沒有待辦卻填了課程' };
    if (kind !== 'info') return { ok: false, reason: '沒有待辦時 kind 不是 info' };
    if (titleSpan.trim() || dueSpan.trim()) {
      return { ok: false, reason: '沒有待辦卻填了標題或截止' };
    }
  } else if (!titleSpan.trim()) {
    return { ok: false, reason: '有待辦卻沒有 titleSpan' };
  }
  return {
    ok: true,
    value: { hasActionableTask, courseId, titleSpan, dueSpan, kind, quote },
  };
}

export function validateJudgement(
  raw: string,
  cards: SenseCard[],
  now: Date,
): AgentValidation<AgentJudgement> {
  const parsed = parseJsonObject(raw);
  if (!parsed) return { ok: false, reason: '不是可解析的 JSON' };
  const order = parsed.order;
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
    return { ok: false, reason: 'order 不是字串陣列' };
  }
  const ids = cards.map((card) => card.id);
  if (ids.length === 0) return { ok: false, reason: '沒有可排序的卡' };
  if (order.length !== ids.length || new Set(order).size !== ids.length) {
    return { ok: false, reason: 'order 不是輸入卡片的完整排列' };
  }
  if (ids.some((id) => !order.includes(id))) {
    return { ok: false, reason: 'order 含了不存在的卡或漏了卡' };
  }
  const liveIds = cards.filter((card) => card.kind === 'live_now').map((card) => card.id);
  if (liveIds.length > 0 && !liveIds.includes(order[0])) {
    return { ok: false, reason: '進行中點名沒有排第一' };
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const stepsFromModel = Array.isArray(parsed.steps) ? parsed.steps : null;
  const steps: AgentStep[] = [];
  if (stepsFromModel) {
    for (const step of stepsFromModel) {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        return { ok: false, reason: 'steps 含了無法驗證的項目' };
      }
      const row = step as Record<string, unknown>;
      if (typeof row.cardId !== 'string' || !byId.has(row.cardId)) {
        return { ok: false, reason: 'steps 含了不存在的卡' };
      }
      if (typeof row.action !== 'string' || !isStepAction(row.action)) {
        return { ok: false, reason: 'action 不在允許清單' };
      }
      const card = byId.get(row.cardId);
      if (!card) return { ok: false, reason: 'steps 含了不存在的卡' };
      steps.push({
        cardId: row.cardId,
        action: row.action,
        reasonCode: reasonCodeForCard(card, now),
      });
    }
  }
  if (steps.length === 0) {
    for (const id of order) {
      const card = byId.get(id);
      if (!card) return { ok: false, reason: 'order 含了不存在的卡' };
      steps.push({
        cardId: id,
        action: 'open',
        reasonCode: reasonCodeForCard(card, now),
      });
    }
  }
  if (liveIds.length > 0) {
    const first = steps[0];
    if (!first || first.cardId !== order[0] || first.action !== 'open') {
      return { ok: false, reason: '第一步不是前往進行中點名' };
    }
  }
  return { ok: true, value: { order, steps } };
}

export function assembleAgentPlan(
  cards: SenseCard[],
  judgement: AgentJudgement,
  now: Date,
): AgentPlanRow[] | null {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const rows: AgentPlanRow[] = [];
  for (const id of judgement.order) {
    const card = byId.get(id);
    if (!card) return null;
    const reasonCode = reasonCodeForCard(card, now);
    rows.push({
      card,
      reasonCode,
      reasonText: reasonTextForCard(card, reasonCode),
    });
  }
  return rows;
}

export function orderedSenseCards(
  cards: SenseCard[],
  judgement: AgentJudgement | null,
): SenseCard[] {
  if (!judgement) return cards;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const next: SenseCard[] = [];
  for (const id of judgement.order) {
    const card = byId.get(id);
    if (!card) return cards;
    next.push(card);
  }
  return next.length === cards.length ? next : cards;
}

export function buildOrderPrompt(cards: SenseCard[]): string {
  const locked = cards.map((card) => ({
    id: card.id,
    kind: card.kind,
    courseName: card.courseName,
    title: card.title,
    dueLabel: card.dueAt ? formatTaipeiDateTime(card.dueAt) : null,
  }));
  return [
    '你是校園待辦 agent，只能排序已存在的卡片，不准改卡片欄位。',
    '只輸出一個 JSON 物件：{"order":["卡片id",...]}',
    'order 必須包含輸入的每一張卡、不准多、不准少、不准改 id。',
    '進行中點名（live_now）必須排第一：錯過就補不了。',
    '幾小時內截止的測驗，要排在已經過期但仍可補交的作業前面。',
    '不准輸出 title、why 或其他欄位。',
    `卡片：${JSON.stringify(locked)}`,
    '/no_think',
  ].join('\n');
}

function stripThink(raw: string): string {
  return String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
}

function isExtractKind(value: string): value is AgentExtractKind {
  return (AGENT_EXTRACT_KINDS as readonly string[]).includes(value);
}

function isStepAction(value: string): value is AgentStepAction {
  return (AGENT_STEP_ACTIONS as readonly string[]).includes(value);
}
