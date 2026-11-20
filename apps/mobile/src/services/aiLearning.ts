/**
 * AI Learning Engine — 主動式 AI 的學習 + 自我擴展能力
 *
 * 設計：AI 不只主動推送，還要根據使用者回應 **學習** 並 **拓展** 自己：
 *
 *  ┌────────────────────────────┐
 *  │ 1. 記錄每次互動             │  recordInteraction()
 *  │    (kind, hour, dayOfWeek, │
 *  │     reaction, deltaMs)      │
 *  └─────────────┬──────────────┘
 *                ▼
 *  ┌────────────────────────────┐
 *  │ 2. 計算 preference weight  │  computePreferenceProfile()
 *  │    per kind × time-bucket  │
 *  │    → acceptance rate       │
 *  └─────────────┬──────────────┘
 *                ▼
 *  ┌────────────────────────────┐
 *  │ 3. 影響下次 ranking         │  adjustScore()
 *  │    boost / suppress         │
 *  └─────────────┬──────────────┘
 *                ▼
 *  ┌────────────────────────────┐
 *  │ 4. 發現新 pattern           │  discoverPatterns()
 *  │    (時段偏好 / 拒絕模式)    │
 *  │    → 自我擴展 rule           │
 *  └────────────────────────────┘
 *
 * 純函式 + AsyncStorage 友善（contextual bandit 簡化版）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getScopedStorageKey } from './scopedStorage';
import type { SuggestionKind } from './proactiveAIAgent';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type UserReaction =
  | 'accepted'    // 點擊 / 執行了建議
  | 'dismissed'   // 主動關閉 / 滑掉
  | 'snoozed'     // 暫時稍後
  | 'ignored'     // N 分鐘內沒互動
  | 'completed';  // 完成了建議的任務

export interface InteractionEvent {
  /** suggestion id (kind + key) */
  suggestionId: string;
  kind: SuggestionKind;
  /** 推送時的 hour 0-23 */
  hour: number;
  /** 0 = 週日, 6 = 週六 */
  dayOfWeek: number;
  /** 用戶反應 */
  reaction: UserReaction;
  /** 從推送到反應的毫秒數（用於 ignored 偵測） */
  deltaMs: number;
  /** ISO 時間 */
  occurredAt: string;
}

export interface PreferenceProfile {
  /** 按 kind 統計：accept rate 0-1 */
  byKind: Record<string, { samples: number; accepted: number; acceptRate: number }>;
  /** 按 hourBucket（每 3 小時一段）統計 */
  byHourBucket: Record<string, { samples: number; accepted: number; acceptRate: number }>;
  /** 按 (kind × hourBucket) 細部統計 */
  byKindHour: Record<string, { samples: number; accepted: number; acceptRate: number }>;
  /** 整體 accept rate */
  overall: { samples: number; accepted: number; acceptRate: number };
  /** 最後更新時間 */
  lastUpdated: string;
}

export interface DiscoveredPattern {
  /** Pattern 名稱（人類可讀） */
  pattern: string;
  /** Pattern 類型 */
  kind: 'preferred_time' | 'rejected_kind' | 'frequent_snooze' | 'high_completion';
  /** 信心 0-100 */
  confidence: number;
  /** 建議的 rule 變動 */
  ruleChange: string;
  /** 支援這個 pattern 的 sample 數 */
  evidenceCount: number;
}

// ─────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────

const LEARNING_HISTORY_BASE = 'ai_learning_history_v1';

function hourBucket(hour: number): string {
  if (hour < 6) return '0-6';
  if (hour < 12) return '6-12';
  if (hour < 18) return '12-18';
  return '18-24';
}

export async function recordInteraction(
  uid: string,
  event: Omit<InteractionEvent, 'occurredAt'>,
): Promise<void> {
  try {
    const key = getScopedStorageKey(LEARNING_HISTORY_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    const list: InteractionEvent[] = raw ? JSON.parse(raw) : [];
    list.unshift({ ...event, occurredAt: new Date().toISOString() });
    // 限制 500 筆
    await AsyncStorage.setItem(key, JSON.stringify(list.slice(0, 500)));
  } catch {
    /* swallow */
  }
}

export async function loadInteractionHistory(uid: string): Promise<InteractionEvent[]> {
  try {
    const key = getScopedStorageKey(LEARNING_HISTORY_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearLearningHistory(uid: string): Promise<void> {
  try {
    const key = getScopedStorageKey(LEARNING_HISTORY_BASE, { uid });
    await AsyncStorage.removeItem(key);
  } catch {
    /* swallow */
  }
}

// ─────────────────────────────────────────────────────────
// 1. 從 history 算 preference profile
// ─────────────────────────────────────────────────────────

export function computePreferenceProfile(history: InteractionEvent[]): PreferenceProfile {
  const byKind: PreferenceProfile['byKind'] = {};
  const byHourBucket: PreferenceProfile['byHourBucket'] = {};
  const byKindHour: PreferenceProfile['byKindHour'] = {};
  let overallSamples = 0;
  let overallAccepted = 0;

  const isAcceptLike = (r: UserReaction) => r === 'accepted' || r === 'completed';

  for (const e of history) {
    const accepted = isAcceptLike(e.reaction);
    overallSamples += 1;
    if (accepted) overallAccepted += 1;

    // kind
    const kEntry = byKind[e.kind] ?? { samples: 0, accepted: 0, acceptRate: 0 };
    kEntry.samples += 1;
    if (accepted) kEntry.accepted += 1;
    kEntry.acceptRate = Math.round((kEntry.accepted / kEntry.samples) * 100) / 100;
    byKind[e.kind] = kEntry;

    // hour bucket
    const bucket = hourBucket(e.hour);
    const hEntry = byHourBucket[bucket] ?? { samples: 0, accepted: 0, acceptRate: 0 };
    hEntry.samples += 1;
    if (accepted) hEntry.accepted += 1;
    hEntry.acceptRate = Math.round((hEntry.accepted / hEntry.samples) * 100) / 100;
    byHourBucket[bucket] = hEntry;

    // kind × hour
    const khKey = `${e.kind}::${bucket}`;
    const khEntry = byKindHour[khKey] ?? { samples: 0, accepted: 0, acceptRate: 0 };
    khEntry.samples += 1;
    if (accepted) khEntry.accepted += 1;
    khEntry.acceptRate = Math.round((khEntry.accepted / khEntry.samples) * 100) / 100;
    byKindHour[khKey] = khEntry;
  }

  return {
    byKind,
    byHourBucket,
    byKindHour,
    overall: {
      samples: overallSamples,
      accepted: overallAccepted,
      acceptRate: overallSamples > 0
        ? Math.round((overallAccepted / overallSamples) * 100) / 100
        : 0,
    },
    lastUpdated: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────
// 2. 根據 profile 調整 suggestion 分數
// ─────────────────────────────────────────────────────────

export function adjustScore(
  baseConfidence: number,
  kind: SuggestionKind,
  hour: number,
  profile: PreferenceProfile,
): { adjustedConfidence: number; multiplier: number; reason: string } {
  // sample 太少 → 不調整
  const kindEntry = profile.byKind[kind];
  if (!kindEntry || kindEntry.samples < 3) {
    return {
      adjustedConfidence: baseConfidence,
      multiplier: 1,
      reason: 'sample 不足，先沿用 baseline',
    };
  }

  const khKey = `${kind}::${hourBucket(hour)}`;
  const khEntry = profile.byKindHour[khKey];

  // 優先用 (kind × hour) 的 acceptRate；若不夠 sample，退用 kind only
  let rate: number;
  let basis: string;
  if (khEntry && khEntry.samples >= 5) {
    rate = khEntry.acceptRate;
    basis = `${kind} 在 ${hourBucket(hour)} 時段（${khEntry.samples} 次樣本）`;
  } else {
    rate = kindEntry.acceptRate;
    basis = `${kind}（${kindEntry.samples} 次樣本）`;
  }

  // 接受率 0-1 線性映射成 multiplier 0.5x ~ 1.5x
  const multiplier = 0.5 + rate;
  const adjustedConfidence = Math.max(0, Math.min(100, Math.round(baseConfidence * multiplier)));
  const direction = rate > 0.6 ? '優先' : rate < 0.3 ? '抑制' : '中性';
  return {
    adjustedConfidence,
    multiplier: Math.round(multiplier * 100) / 100,
    reason: `${basis} 接受率 ${Math.round(rate * 100)}% → ${direction}`,
  };
}

// ─────────────────────────────────────────────────────────
// 3. 自我擴展：從 history 找新 pattern
// ─────────────────────────────────────────────────────────

export function discoverPatterns(history: InteractionEvent[]): DiscoveredPattern[] {
  const profile = computePreferenceProfile(history);
  const patterns: DiscoveredPattern[] = [];

  // 偏好時段：找出 accept rate 顯著高於均值的 hourBucket
  const overallRate = profile.overall.acceptRate;
  for (const [bucket, entry] of Object.entries(profile.byHourBucket)) {
    if (entry.samples < 10) continue;
    if (entry.acceptRate > overallRate + 0.2) {
      patterns.push({
        pattern: `${bucket} 時段最容易接受提醒（${Math.round(entry.acceptRate * 100)}% vs 整體 ${Math.round(overallRate * 100)}%）`,
        kind: 'preferred_time',
        confidence: Math.min(95, 60 + entry.samples),
        ruleChange: `把 study_plan / mistake_practice 等高 leverage 建議優先排在 ${bucket}`,
        evidenceCount: entry.samples,
      });
    }
  }

  // 拒絕 kind：找出 accept rate 明顯偏低的 kind
  for (const [kind, entry] of Object.entries(profile.byKind)) {
    if (entry.samples < 5) continue;
    if (entry.acceptRate < 0.15) {
      patterns.push({
        pattern: `${kind} 類型建議幾乎都被忽略（${entry.samples} 次有 ${entry.accepted} 次接受）`,
        kind: 'rejected_kind',
        confidence: Math.min(95, 60 + entry.samples * 2),
        ruleChange: `降低 ${kind} 推送頻率到 1/4，或改變呈現方式`,
        evidenceCount: entry.samples,
      });
    }
  }

  // 頻繁 snooze：某 kind snooze 比率 > 50%
  const snoozeByKind = new Map<string, { total: number; snoozed: number }>();
  for (const e of history) {
    const k = snoozeByKind.get(e.kind) ?? { total: 0, snoozed: 0 };
    k.total += 1;
    if (e.reaction === 'snoozed') k.snoozed += 1;
    snoozeByKind.set(e.kind, k);
  }
  for (const [kind, stats] of snoozeByKind) {
    if (stats.total < 5) continue;
    const rate = stats.snoozed / stats.total;
    if (rate > 0.5) {
      patterns.push({
        pattern: `${kind} 經常被 snooze（${stats.snoozed}/${stats.total}）— 推送時機可能不對`,
        kind: 'frequent_snooze',
        confidence: Math.min(90, 50 + stats.total * 3),
        ruleChange: `${kind} 改成晚 1-2 小時後再推`,
        evidenceCount: stats.total,
      });
    }
  }

  // 高完成率 kind：accept 後 completed 比率高 → 是高價值 kind
  const completionByKind = new Map<string, { accepted: number; completed: number }>();
  for (const e of history) {
    const k = completionByKind.get(e.kind) ?? { accepted: 0, completed: 0 };
    if (e.reaction === 'accepted' || e.reaction === 'completed') k.accepted += 1;
    if (e.reaction === 'completed') k.completed += 1;
    completionByKind.set(e.kind, k);
  }
  for (const [kind, stats] of completionByKind) {
    if (stats.accepted < 5) continue;
    const rate = stats.completed / stats.accepted;
    if (rate > 0.7) {
      patterns.push({
        pattern: `${kind} 一旦接受就有 ${Math.round(rate * 100)}% 完成率 — 高價值`,
        kind: 'high_completion',
        confidence: Math.min(95, 60 + stats.accepted * 2),
        ruleChange: `${kind} 推送頻率拉高 1.5 倍`,
        evidenceCount: stats.accepted,
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

// ─────────────────────────────────────────────────────────
// 4. 整合：自我反思 + 報告
// ─────────────────────────────────────────────────────────

export interface SelfReflection {
  totalInteractions: number;
  acceptRate: number;
  topPatterns: DiscoveredPattern[];
  /** AI 給自己的下一步調整 */
  selfAdjustment: string;
}

export function selfReflect(history: InteractionEvent[]): SelfReflection {
  const profile = computePreferenceProfile(history);
  const patterns = discoverPatterns(history);

  let selfAdjustment: string;
  if (history.length < 10) {
    selfAdjustment = '互動 sample 還不夠，先繼續觀察 + 推送多元 suggestion';
  } else if (profile.overall.acceptRate < 0.2) {
    selfAdjustment = '整體接受率偏低，可能推太頻繁或時機不對；自動降頻 50%';
  } else if (profile.overall.acceptRate > 0.7) {
    selfAdjustment = '整體接受率很高，可以放心擴大 coverage';
  } else if (patterns.length > 0) {
    selfAdjustment = `學到 ${patterns.length} 個 pattern；下次 scan 套用 ${patterns[0].ruleChange}`;
  } else {
    selfAdjustment = '節奏穩定，繼續維持當前策略';
  }

  return {
    totalInteractions: history.length,
    acceptRate: profile.overall.acceptRate,
    topPatterns: patterns.slice(0, 3),
    selfAdjustment,
  };
}
