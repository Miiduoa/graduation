/**
 * AI Continual Learning — 持續學習引擎
 * ═══════════════════════════════════════════════════════════════════════
 * 把使用者每一次互動（接受/拒絕建議、改寫、修正、回饋、執行動作）
 * 統一寫入 AgentMemory + LocalTrainingDB，並從動作歷史推斷偏好。
 *
 * 此模組為「AI Brain Hub」的學習子系統，所有學習資料皆與 userId 綁定，
 * 透過 AsyncStorage 持久化於裝置端。
 *
 * 核心 API：
 *   - load/save(userId)
 *   - observeInteraction(payload)
 *   - recordFeedback({ positive, edited })
 *   - recordToolOutcome(tool, args, success, error?)
 *   - inferPreferencesFromHistory()  ← 從動作模式推斷飲食、地點偏好
 */

import {
  AgentMemory,
  LocalTrainingDB,
  LearnedFact,
  LearnedSkill,
  RecentAction,
  addRecentAction,
  getDefaultMemory,
  getDefaultTrainingDB,
  getMemoryStorageKey,
  getTrainingDBStorageKey,
  mergeLearnedFacts,
  mergeLearnedSkill,
  normalizeLocalTrainingDB,
} from '../data/puAIAgentData';
import { loadPersistedValue, savePersistedValue } from './persistedStorage';

// ─── Types ───────────────────────────────────────────────────────────

export type LearningInteractionKind =
  | 'tool_success'
  | 'tool_failure'
  | 'suggestion_accepted'
  | 'suggestion_rejected'
  | 'user_correction'
  | 'manual_feedback'
  | 'navigation'
  | 'observation';

export interface LearningInteraction {
  kind: LearningInteractionKind;
  tool?: string;
  args?: Record<string, unknown>;
  outcome?: 'success' | 'failure';
  error?: string;
  /** 自然語言敘述（用於建立 LearnedFact 或 conversationPatterns） */
  summary?: string;
  /** 使用者原始輸入（讓我們建立 skill key） */
  userMessage?: string;
  /** 使用者編輯後的版本（若 AI 草稿被修正） */
  editedVersion?: string;
  /** 標籤，用於分類 */
  tags?: string[];
  timestamp?: number;
}

export interface FeedbackPayload {
  qaId?: string;
  positive: boolean;
  edited?: string;
  comment?: string;
  tool?: string;
}

export interface LearningSnapshot {
  userId: string;
  memory: AgentMemory;
  trainingDB: LocalTrainingDB;
  lastUpdatedAt: number;
}

// ─── State (in-memory mirror)──────────────────────────────────────────

let currentUserId: string | null = null;
let currentMemory: AgentMemory | null = null;
let currentTrainingDB: LocalTrainingDB | null = null;
let lastUpdatedAt = 0;
const listeners = new Set<(snap: LearningSnapshot) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  if (!currentUserId || !currentMemory || !currentTrainingDB) return;
  const snap: LearningSnapshot = {
    userId: currentUserId,
    memory: currentMemory,
    trainingDB: currentTrainingDB,
    lastUpdatedAt,
  };
  listeners.forEach((listener) => {
    try {
      listener(snap);
    } catch (e) {
      console.warn('[AIContinualLearning] listener failed:', e);
    }
  });
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistNow();
  }, 800);
}

async function persistNow(): Promise<void> {
  if (!currentUserId || !currentMemory || !currentTrainingDB) return;
  try {
    await Promise.all([
      savePersistedValue(getMemoryStorageKey(currentUserId), currentMemory),
      savePersistedValue(getTrainingDBStorageKey(currentUserId), currentTrainingDB),
    ]);
  } catch (e) {
    console.warn('[AIContinualLearning] persist failed:', e);
  }
}

// ─── Public API ───────────────────────────────────────────────────────

export async function initLearningForUser(userId: string): Promise<LearningSnapshot> {
  if (currentUserId === userId && currentMemory && currentTrainingDB) {
    return getSnapshot()!;
  }
  if (currentUserId && currentUserId !== userId) {
    await persistNow();
  }
  currentUserId = userId;
  const [memory, trainingDB] = await Promise.all([
    loadPersistedValue<AgentMemory>({
      storageKey: getMemoryStorageKey(userId),
      fallback: getDefaultMemory(userId),
    }),
    loadPersistedValue<LocalTrainingDB>({
      storageKey: getTrainingDBStorageKey(userId),
      fallback: getDefaultTrainingDB(),
    }),
  ]);
  currentMemory = memory;
  currentTrainingDB = normalizeLocalTrainingDB(trainingDB);
  lastUpdatedAt = Date.now();
  notify();
  return getSnapshot()!;
}

export function getSnapshot(): LearningSnapshot | null {
  if (!currentUserId || !currentMemory || !currentTrainingDB) return null;
  return {
    userId: currentUserId,
    memory: currentMemory,
    trainingDB: currentTrainingDB,
    lastUpdatedAt,
  };
}

export function subscribeLearning(listener: (snap: LearningSnapshot) => void): () => void {
  listeners.add(listener);
  const snap = getSnapshot();
  if (snap) listener(snap);
  return () => {
    listeners.delete(listener);
  };
}

export async function clearLearningForUser(userId: string): Promise<void> {
  if (currentUserId === userId) {
    currentMemory = getDefaultMemory(userId);
    currentTrainingDB = getDefaultTrainingDB();
    lastUpdatedAt = Date.now();
    notify();
    await persistNow();
  }
}

// ─── Interaction recording ────────────────────────────────────────────

export function observeInteraction(interaction: LearningInteraction): void {
  if (!currentMemory || !currentTrainingDB) return;
  const now = interaction.timestamp ?? Date.now();
  let nextMemory = currentMemory;
  let nextTrainingDB = currentTrainingDB;

  if (interaction.tool && interaction.outcome) {
    const action: RecentAction = {
      toolId: interaction.tool,
      params: (interaction.args as Record<string, unknown>) ?? {},
      timestamp: new Date(now).toISOString(),
      wasSuccessful: interaction.outcome === 'success',
    };
    nextMemory = addRecentAction(nextMemory, action);
  }

  // 把使用者鎖定的「事實」記下來（rejection / correction / explicit fact）
  if (interaction.summary && interaction.summary.length > 4) {
    const fact: LearnedFact = {
      id: `fact_${now}_${Math.random().toString(36).slice(2, 8)}`,
      fact: interaction.summary.slice(0, 200),
      source:
        interaction.kind === 'user_correction' || interaction.kind === 'manual_feedback'
          ? 'explicit'
          : 'inferred',
      confidence:
        interaction.kind === 'user_correction'
          ? 0.95
          : interaction.kind === 'manual_feedback'
            ? 0.9
            : 0.6,
      learnedAt: new Date(now).toISOString(),
      category: inferFactCategory(interaction),
    };
    nextMemory = mergeLearnedFacts(nextMemory, [fact]);
  }

  // 若有對話樣式，記入 conversationPatterns
  if (interaction.userMessage && interaction.userMessage.length > 2) {
    const pattern = compactPattern(interaction.userMessage);
    if (pattern && !nextMemory.conversationPatterns.includes(pattern)) {
      nextMemory = {
        ...nextMemory,
        conversationPatterns: [...nextMemory.conversationPatterns, pattern].slice(-30),
      };
    }
  }

  // 成功的工具呼叫，蒸餾為 LearnedSkill
  if (interaction.kind === 'tool_success' && interaction.tool && interaction.userMessage) {
    const argSummary = formatArgs(interaction.args);
    const skill: LearnedSkill = {
      id: `skill_${now}_${Math.random().toString(36).slice(2, 8)}`,
      title: shortTitle(interaction.userMessage),
      procedure:
        interaction.summary ??
        `當使用者說類似「${interaction.userMessage.slice(0, 32)}」時，呼叫 ${interaction.tool}${argSummary ? `，參數：${argSummary}` : ''}。`,
      triggers: deriveTriggers(interaction),
      source: 'distilled',
      learnedAt: new Date(now).toISOString(),
      lastUsedAt: new Date(now).toISOString(),
      useCount: 1,
    };
    nextTrainingDB = mergeLearnedSkill(nextTrainingDB, skill);
  }

  currentMemory = nextMemory;
  currentTrainingDB = nextTrainingDB;
  lastUpdatedAt = now;
  notify();
  scheduleSave();
}

export function recordFeedback(feedback: FeedbackPayload): void {
  if (!currentMemory || !currentTrainingDB) return;
  observeInteraction({
    kind: feedback.positive ? 'suggestion_accepted' : 'suggestion_rejected',
    tool: feedback.tool,
    summary: feedback.comment
      ? `回饋（${feedback.positive ? '正面' : '負面'}）：${feedback.comment}`
      : feedback.edited
        ? `使用者修正為：${feedback.edited.slice(0, 120)}`
        : feedback.positive
          ? '使用者接受 AI 建議'
          : '使用者拒絕 AI 建議',
    editedVersion: feedback.edited,
  });
}

export function recordToolOutcome(
  tool: string,
  args: Record<string, unknown>,
  outcome: 'success' | 'failure',
  error?: string,
  userMessage?: string,
): void {
  observeInteraction({
    kind: outcome === 'success' ? 'tool_success' : 'tool_failure',
    tool,
    args,
    outcome,
    error,
    userMessage,
    summary:
      outcome === 'success'
        ? `「${tool}」執行成功`
        : `「${tool}」執行失敗：${(error ?? '').slice(0, 100)}`,
  });
}

// ─── Preference inference ─────────────────────────────────────────────

/**
 * 從 recentActions 推斷使用者偏好：
 * - 多次點同一家餐廳 → preferredCafeteria
 * - 多次選同一類餐點 → foodPreferences
 * - 多次去同地點 → frequentLocations
 */
export function inferPreferencesFromHistory(): void {
  if (!currentMemory) return;
  const recent = currentMemory.recentActions ?? [];
  if (recent.length < 3) return;

  const cafeteriaCount = new Map<string, number>();
  const locationCount = new Map<string, number>();
  const foodCount = new Map<string, number>();

  for (const action of recent) {
    const params = (action.params ?? {}) as Record<string, unknown>;
    if (action.toolId === 'order_meal' || action.toolId === 'recommend_lunch') {
      const cafe = String(params.cafeteria ?? params.vendorId ?? '').trim();
      if (cafe) cafeteriaCount.set(cafe, (cafeteriaCount.get(cafe) ?? 0) + 1);
      const food = String(params.keyword ?? params.itemName ?? '').trim();
      if (food && food.length >= 2)
        foodCount.set(food, (foodCount.get(food) ?? 0) + 1);
    }
    const loc = String(params.location ?? params.placeName ?? '').trim();
    if (loc && loc.length >= 2)
      locationCount.set(loc, (locationCount.get(loc) ?? 0) + 1);
  }

  let nextPrefs = currentMemory.preferences;
  const topCafe = topEntry(cafeteriaCount, 3);
  if (topCafe && topCafe !== nextPrefs.preferredCafeteria) {
    nextPrefs = { ...nextPrefs, preferredCafeteria: topCafe };
  }

  const topLocs = topNEntries(locationCount, 5, 2);
  if (topLocs.length > 0) {
    const merged = mergeUnique(nextPrefs.frequentLocations, topLocs, 8);
    if (merged.length !== nextPrefs.frequentLocations.length) {
      nextPrefs = { ...nextPrefs, frequentLocations: merged };
    }
  }

  const topFoods = topNEntries(foodCount, 5, 2);
  if (topFoods.length > 0) {
    const merged = mergeUnique(nextPrefs.foodPreferences, topFoods, 10);
    if (merged.length !== nextPrefs.foodPreferences.length) {
      nextPrefs = { ...nextPrefs, foodPreferences: merged };
    }
  }

  if (nextPrefs !== currentMemory.preferences) {
    currentMemory = { ...currentMemory, preferences: nextPrefs };
    lastUpdatedAt = Date.now();
    notify();
    scheduleSave();
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

function inferFactCategory(
  interaction: LearningInteraction,
): LearnedFact['category'] {
  const txt = `${interaction.summary ?? ''} ${interaction.userMessage ?? ''}`.toLowerCase();
  if (/吃|餐|飯|食|過敏|素食|蔬菜|肉|麵/.test(txt)) return 'dietary';
  if (/課|成績|gpa|學分|作業|考試|教授/.test(txt)) return 'academic';
  if (/掛號|看[診病]|不舒服|藥|身體|過敏|生病/.test(txt)) return 'health';
  if (/朋友|社團|活動|群組|聊天/.test(txt)) return 'social';
  if (/早|晚|作息|時間|提醒|鬧鐘/.test(txt)) return 'schedule';
  return 'personal';
}

function compactPattern(message: string): string {
  return message.trim().slice(0, 60).replace(/\s+/g, ' ');
}

function shortTitle(message: string): string {
  return message.trim().split(/[，。！？.!?\n]/)[0].slice(0, 32);
}

function topEntry(map: Map<string, number>, threshold: number): string | null {
  let best: string | null = null;
  let bestCount = threshold - 1;
  for (const [k, v] of map) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

function topNEntries(map: Map<string, number>, n: number, threshold: number): string[] {
  return [...map.entries()]
    .filter(([, v]) => v >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function mergeUnique(existing: string[], next: string[], cap: number): string[] {
  const set = new Set(existing);
  for (const x of next) set.add(x);
  return [...set].slice(0, cap);
}

function deriveTriggers(interaction: LearningInteraction): string[] {
  const out = new Set<string>();
  const tokens = (interaction.userMessage ?? '')
    .toLowerCase()
    .split(/[\s，。！？.!?,;:]+/)
    .filter((t) => t.length >= 2);
  for (const tok of tokens.slice(0, 6)) out.add(tok);
  for (const tag of interaction.tags ?? []) out.add(tag);
  if (interaction.tool) out.add(interaction.tool);
  return [...out].slice(0, 8);
}

function formatArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  try {
    const entries = Object.entries(args).slice(0, 5);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}=${String(v).slice(0, 32)}`).join(', ');
  } catch {
    return '';
  }
}
