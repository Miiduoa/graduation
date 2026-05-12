/**
 * AI Active Learning — 主動學習未知概念
 * ═══════════════════════════════════════════════════════════════════════
 * 「跟你一樣聰明」的核心：不再被動接受成功 case，而是
 *   1. 失敗時主動記住「我不會這個詞」
 *   2. 從上下文推測可能意思（hypothesis）
 *   3. 反問使用者求證
 *   4. 求證後寫入 LearnedConcept，下次「就會了」
 *
 * 持久化到 AsyncStorage：`aiBrain.activeLearning.v1.{userId}`
 *
 * 與 aiContinualLearning 的差異：
 *  - aiContinualLearning 學「使用者的偏好」（喜歡什麼、常做什麼）
 *  - aiActiveLearning 學「詞彙的意義」（這個詞是什麼）
 */

import { loadPersistedValue, savePersistedValue } from './persistedStorage';

// ─── Types ───────────────────────────────────────────────────────────

export interface LearnedConcept {
  /** 原始詞 */
  term: string;
  /** 解析後的意義（人類可讀） */
  meaning: string;
  /** 如果可以映射成具體餐點 / 工具參數 */
  itemName?: string;
  /** 同義詞 */
  aliases: string[];
  /** 出現次數 */
  occurrences: number;
  /** 學會方式 */
  source: 'user_clarified' | 'inferred' | 'cross_reference';
  /** 學會時間 */
  learnedAt: string;
  /** 上次使用 */
  lastUsedAt: string;
  /** 信心 0-1（user_clarified=1, inferred 視證據） */
  confidence: number;
}

export interface UnknownConcept {
  term: string;
  /** 出現次數 */
  occurrences: number;
  /** 上下文（最近幾次出現的對話片段） */
  recentContexts: Array<{
    message: string;
    timestamp: string;
    conversationPreview?: string;
  }>;
  /** 已嘗試的推測 */
  hypotheses: Array<{ guess: string; reason: string; confidence: number }>;
  /** 是否已透過反問取得使用者答案 */
  resolved: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ActiveLearningSnapshot {
  userId: string;
  concepts: LearnedConcept[];
  unknowns: UnknownConcept[];
  lastUpdatedAt: number;
}

// ─── State ───────────────────────────────────────────────────────────

let currentUserId: string | null = null;
let concepts: Map<string, LearnedConcept> = new Map();
let unknowns: Map<string, UnknownConcept> = new Map();
let lastUpdatedAt = 0;
const listeners = new Set<(snap: ActiveLearningSnapshot) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  if (!currentUserId) return;
  const snap = getSnapshot();
  if (!snap) return;
  for (const cb of listeners) {
    try {
      cb(snap);
    } catch (err) {
      console.warn('[ActiveLearning] listener threw:', err);
    }
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!currentUserId) return;
    void savePersistedValue(`aiBrain.activeLearning.v1.${currentUserId}`, {
      concepts: [...concepts.values()],
      unknowns: [...unknowns.values()],
      version: 1,
    });
  }, 1500);
}

function normalize(term: string): string {
  return (term ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

// ─── Public API ──────────────────────────────────────────────────────

export async function initActiveLearning(userId: string): Promise<ActiveLearningSnapshot> {
  if (currentUserId === userId && concepts.size + unknowns.size > 0) {
    return getSnapshot()!;
  }
  currentUserId = userId;
  concepts = new Map();
  unknowns = new Map();
  try {
    const stored = await loadPersistedValue<{
      concepts?: LearnedConcept[];
      unknowns?: UnknownConcept[];
    } | null>({
      storageKey: `aiBrain.activeLearning.v1.${userId}`,
      fallback: null,
    });
    if (stored?.concepts) {
      for (const c of stored.concepts) concepts.set(normalize(c.term), c);
    }
    if (stored?.unknowns) {
      for (const u of stored.unknowns) unknowns.set(normalize(u.term), u);
    }
  } catch (err) {
    console.warn('[ActiveLearning] load failed:', err);
  }
  lastUpdatedAt = Date.now();
  notify();
  return getSnapshot()!;
}

export function subscribeActiveLearning(
  cb: (snap: ActiveLearningSnapshot) => void,
): () => void {
  listeners.add(cb);
  const snap = getSnapshot();
  if (snap) {
    try {
      cb(snap);
    } catch (err) {
      console.warn('[ActiveLearning] initial cb threw:', err);
    }
  }
  return () => listeners.delete(cb);
}

export function getSnapshot(): ActiveLearningSnapshot | null {
  if (!currentUserId) return null;
  return {
    userId: currentUserId,
    concepts: [...concepts.values()],
    unknowns: [...unknowns.values()],
    lastUpdatedAt,
  };
}

/**
 * 查詢已學會的概念。回傳 null 代表不認識。
 */
export function lookupLearnedConcept(term: string): LearnedConcept | null {
  const key = normalize(term);
  if (!key) return null;
  // 1. 直接命中
  const direct = concepts.get(key);
  if (direct) {
    direct.occurrences += 1;
    direct.lastUsedAt = new Date().toISOString();
    scheduleSave();
    return direct;
  }
  // 2. 從 aliases 查
  for (const c of concepts.values()) {
    if (c.aliases.some((a) => normalize(a) === key)) {
      c.occurrences += 1;
      c.lastUsedAt = new Date().toISOString();
      scheduleSave();
      return c;
    }
  }
  return null;
}

/**
 * 主動記錄一個「不會的詞」。
 * 嘗試從上下文做出推測，但不會直接寫成 LearnedConcept（要使用者確認才升級）。
 */
export function recordUnknownConcept(
  term: string,
  ctx: {
    message?: string;
    context?: Array<{ role: 'user' | 'assistant'; content: string }>;
    hypothesis?: { guess: string; reason: string; confidence: number };
  } = {},
): UnknownConcept {
  const key = normalize(term);
  const now = new Date().toISOString();
  const existing = unknowns.get(key);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeenAt = now;
    if (ctx.message) {
      existing.recentContexts.unshift({
        message: ctx.message,
        timestamp: now,
        conversationPreview: ctx.context?.map((t) => `${t.role}:${t.content.slice(0, 40)}`).join(' | '),
      });
      existing.recentContexts = existing.recentContexts.slice(0, 5);
    }
    if (ctx.hypothesis) existing.hypotheses.push(ctx.hypothesis);
    scheduleSave();
    notify();
    return existing;
  }
  const created: UnknownConcept = {
    term,
    occurrences: 1,
    recentContexts: ctx.message
      ? [
          {
            message: ctx.message,
            timestamp: now,
            conversationPreview: ctx.context?.map((t) => `${t.role}:${t.content.slice(0, 40)}`).join(' | '),
          },
        ]
      : [],
    hypotheses: ctx.hypothesis ? [ctx.hypothesis] : [],
    resolved: false,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  unknowns.set(key, created);
  scheduleSave();
  notify();
  return created;
}

/**
 * 使用者「澄清」了一個詞 → 直接升級成已學會概念。
 *   linkConceptToMeaning('午餐', { meaning: '用餐時段', itemName: '川福美食｜酸辣粉' })
 */
export function linkConceptToMeaning(
  term: string,
  payload: {
    meaning: string;
    itemName?: string;
    aliases?: string[];
    source?: LearnedConcept['source'];
    confidence?: number;
  },
): LearnedConcept {
  const key = normalize(term);
  const now = new Date().toISOString();
  const existing = concepts.get(key);
  const aliases = payload.aliases ?? existing?.aliases ?? [];
  const merged: LearnedConcept = {
    term,
    meaning: payload.meaning,
    itemName: payload.itemName ?? existing?.itemName,
    aliases: [...new Set([...(existing?.aliases ?? []), ...aliases])],
    occurrences: (existing?.occurrences ?? 0) + 1,
    source: payload.source ?? 'user_clarified',
    learnedAt: existing?.learnedAt ?? now,
    lastUsedAt: now,
    confidence: payload.confidence ?? (payload.source === 'user_clarified' ? 1 : 0.6),
  };
  concepts.set(key, merged);
  // 移除 unknowns
  if (unknowns.has(key)) {
    const u = unknowns.get(key)!;
    u.resolved = true;
    unknowns.delete(key);
  }
  scheduleSave();
  notify();
  return merged;
}

/**
 * 嘗試從歷史對話、學過的概念與類似失敗紀錄，自動推測 term 的意思。
 * 用於背景填補 unknownConcepts.hypotheses。
 */
export function inferHypothesisFor(
  term: string,
  ctx: {
    similarKnownItems?: Array<{ name: string; category?: string }>;
  } = {},
): { guess: string; reason: string; confidence: number } | null {
  // 1. 字元交集：term 有大量字元與某 known item 重疊 → 可能是別名
  if (ctx.similarKnownItems && ctx.similarKnownItems.length > 0) {
    const termChars = new Set([...term]);
    let bestMatch: { name: string; overlap: number } | null = null;
    for (const item of ctx.similarKnownItems) {
      const itemChars = new Set([...item.name]);
      let overlap = 0;
      termChars.forEach((c) => {
        if (itemChars.has(c)) overlap++;
      });
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { name: item.name, overlap };
      }
    }
    if (bestMatch && bestMatch.overlap >= Math.ceil(term.length * 0.5)) {
      return {
        guess: bestMatch.name,
        reason: `字面 ${bestMatch.overlap}/${term.length} 個字與「${bestMatch.name}」重疊`,
        confidence: Math.min(0.7, bestMatch.overlap / term.length),
      };
    }
  }
  return null;
}

/**
 * 把所有 unknown concepts 主動嘗試 hypothesise 一遍。
 * 通常在背景跑（aiProactiveThinker 排程裡）。
 */
export function backgroundInferAllUnknowns(
  similarKnownItemsProvider: () => Array<{ name: string; category?: string }>,
): number {
  if (!currentUserId) return 0;
  let updated = 0;
  const known = similarKnownItemsProvider();
  for (const u of unknowns.values()) {
    if (u.hypotheses.length >= 3) continue;
    const h = inferHypothesisFor(u.term, { similarKnownItems: known });
    if (h) {
      u.hypotheses.push(h);
      updated++;
    }
  }
  if (updated > 0) {
    scheduleSave();
    notify();
  }
  return updated;
}

/** 列出最近 N 個還沒解決的 unknowns（用於主動反問使用者） */
export function listOpenUnknowns(limit = 5): UnknownConcept[] {
  return [...unknowns.values()]
    .filter((u) => !u.resolved && u.occurrences >= 1)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, limit);
}

/** 列出所有已學會概念 */
export function listConcepts(): LearnedConcept[] {
  return [...concepts.values()].sort((a, b) => b.occurrences - a.occurrences);
}

/** 清空（登出時呼叫） */
export async function clearActiveLearning(userId: string): Promise<void> {
  await savePersistedValue(`aiBrain.activeLearning.v1.${userId}`, null);
  if (currentUserId === userId) {
    concepts.clear();
    unknowns.clear();
    notify();
  }
}
