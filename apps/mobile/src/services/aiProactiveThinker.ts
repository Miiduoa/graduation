/**
 * AI Proactive Thinker — 主動思考引擎
 * ═══════════════════════════════════════════════════════════════════════
 * 在背景定時掃描使用者當下情境，主動產生洞察卡片，不需等使用者開口。
 *
 * 整合：
 *   - AIAmbientAwarenessSnapshot（即時資料）
 *   - aiCrossModuleInference（深層跨模組推理）
 *   - aiRealtimeAnalytics（風險、GPA、出席）
 *   - aiContinualLearning（學到的偏好）
 *
 * 把結果集中為 `BrainInsight[]` 供 Brain Hub 與任何 Screen 訂閱。
 */

import {
  getAIAmbientAwarenessSnapshot,
  subscribeAIAmbientAwareness,
  type AIAmbientAwarenessSnapshot,
} from './aiAppContext';
import {
  computeCrossModuleInsights,
  type CrossModuleInsight,
} from './aiCrossModuleInference';
import type { RiskLevel } from './aiRealtimeAnalytics';
import { getSnapshot as getLearningSnapshot } from './aiContinualLearning';

export type InsightCategory =
  | 'next_action'
  | 'risk'
  | 'opportunity'
  | 'reminder'
  | 'recommendation'
  | 'observation';

export interface BrainInsight {
  id: string;
  category: InsightCategory;
  severity: RiskLevel;
  title: string;
  message: string;
  actionSuggestion?: string;
  relatedModules: string[];
  timestamp: number;
  /** 來自哪個推理 */
  source: 'cross_module' | 'pulse' | 'risk' | 'memory' | 'next_best_action';
  /** 可選：原始 insight payload */
  raw?: unknown;
}

type Listener = (insights: BrainInsight[]) => void;

const listeners = new Set<Listener>();
let currentInsights: BrainInsight[] = [];
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ambientUnsubscribe: (() => void) | null = null;
let lastRunAt = 0;
let inFlight = false;
const dismissed = new Set<string>();

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_BETWEEN_RUNS_MS = 90_000;

export function getProactiveInsights(): BrainInsight[] {
  return currentInsights;
}

export function subscribeProactiveInsights(listener: Listener): () => void {
  listeners.add(listener);
  if (currentInsights.length > 0) listener(currentInsights);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(currentInsights);
    } catch (e) {
      console.warn('[AIProactiveThinker] listener failed:', e);
    }
  }
}

export function dismissInsight(id: string): void {
  dismissed.add(id);
  currentInsights = currentInsights.filter((insight) => insight.id !== id);
  notify();
}

export function clearProactiveInsights(): void {
  currentInsights = [];
  notify();
}

export interface StartProactiveThinkerParams {
  /** 預設 5 分鐘掃描一次 */
  intervalMs?: number;
  /** 啟動時是否立刻跑一次 */
  runImmediately?: boolean;
}

/**
 * 啟動主動思考排程（在 App 啟動 + 登入後呼叫）。
 * 若已啟動，會 no-op；可呼叫 stopProactiveThinker 後再 start。
 */
export function startProactiveThinker(params: StartProactiveThinkerParams = {}): () => void {
  if (running) return stopProactiveThinker;
  running = true;
  const interval = params.intervalMs ?? DEFAULT_INTERVAL_MS;

  ambientUnsubscribe = subscribeAIAmbientAwareness(() => {
    if (Date.now() - lastRunAt > MIN_INTERVAL_BETWEEN_RUNS_MS) {
      void runOnce('ambient-update');
    }
  });

  timer = setInterval(() => {
    void runOnce('timer');
  }, interval);

  if (params.runImmediately !== false) {
    setTimeout(() => void runOnce('startup'), 4_000);
  }

  return stopProactiveThinker;
}

export function stopProactiveThinker(): void {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (ambientUnsubscribe) {
    ambientUnsubscribe();
    ambientUnsubscribe = null;
  }
}

export async function runOnce(reason: string): Promise<BrainInsight[]> {
  if (inFlight) return currentInsights;
  inFlight = true;
  lastRunAt = Date.now();
  try {
    const ambient = getAIAmbientAwarenessSnapshot();
    const next = await reasonOver(ambient, reason);
    const merged = mergeInsights(currentInsights, next);
    currentInsights = merged.filter((insight) => !dismissed.has(insight.id));
    notify();
    return currentInsights;
  } catch (e) {
    console.warn('[AIProactiveThinker] runOnce failed:', e);
    return currentInsights;
  } finally {
    inFlight = false;
  }
}

// ─── reasoning over ambient snapshot ──────────────────────────────────

async function reasonOver(
  ambient: AIAmbientAwarenessSnapshot,
  reason: string,
): Promise<BrainInsight[]> {
  const insights: BrainInsight[] = [];

  // 1) 跨模組推理 ─────────────────────────────────────
  let crossInsights: CrossModuleInsight[] = [];
  try {
    crossInsights = await computeCrossModuleInsights();
  } catch (e) {
    console.warn('[AIProactiveThinker] cross-module insights failed:', e);
  }
  for (const ci of crossInsights) {
    insights.push({
      id: `cm_${ci.id}`,
      category: ci.severity === 'critical' || ci.severity === 'danger' ? 'risk' : 'reminder',
      severity: ci.severity,
      title: ci.title,
      message: ci.message,
      actionSuggestion: ci.actionSuggestion,
      relatedModules: ci.relatedModules,
      timestamp: ci.timestamp,
      source: 'cross_module',
      raw: ci,
    });
  }

  // 2) NextBestActions ────────────────────────────────
  const nbActions = ambient.runtimeData.nextBestActions ?? [];
  for (const action of nbActions.slice(0, 5)) {
    insights.push({
      id: `nba_${action.id ?? `${action.title}_${action.priority}`}`,
      category: 'next_action',
      severity:
        action.urgency === 'critical' || action.urgency === 'high' ? 'danger' : 'watch',
      title: action.title,
      message: action.description ?? action.nextStep ?? action.actionLabel ?? '',
      actionSuggestion: action.actionLabel ?? action.nextStep,
      relatedModules: [action.source ?? 'inbox'],
      timestamp: Date.now(),
      source: 'next_best_action',
      raw: action,
    });
  }

  // 3) 校園脈動高擁擠地點 → opportunity
  const pulse = (ambient.runtimeData.pulseAggregates ?? [])
    .filter((p) => p.currentLevel >= 4)
    .slice(0, 3);
  for (const p of pulse) {
    insights.push({
      id: `pulse_${p.locationId ?? p.locationName}`,
      category: 'observation',
      severity: 'watch',
      title: `${p.locationName}人潮 ${p.currentLevel}/5`,
      message: `${p.locationName} 目前 ${p.currentLevel}/5${p.bestTimeToVisit ? `，最佳前往時段 ${p.bestTimeToVisit}` : ''}`,
      actionSuggestion: p.bestTimeToVisit ? `建議 ${p.bestTimeToVisit} 再去` : undefined,
      relatedModules: ['campus', 'pulse'],
      timestamp: Date.now(),
      source: 'pulse',
      raw: p,
    });
  }

  // 4) Risk snapshots → risk
  const risks = (ambient.runtimeData.riskSnapshots ?? [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  for (const risk of risks) {
    if (risk.score < 0.55) continue;
    insights.push({
      id: `risk_${risk.id ?? risk.summary?.slice(0, 16)}`,
      category: 'risk',
      severity: risk.score >= 0.85 ? 'critical' : risk.score >= 0.7 ? 'danger' : 'warning',
      title: `學習風險：${risk.level}`,
      message: risk.summary ?? '系統偵測到風險，請查看詳細頁面',
      actionSuggestion: '查看學習風險詳情',
      relatedModules: ['risk', 'academic'],
      timestamp: Date.now(),
      source: 'risk',
      raw: risk,
    });
  }

  // 5) 從學習到的偏好衍生建議
  const learning = getLearningSnapshot();
  if (learning) {
    const prefs = learning.memory.preferences;
    if (prefs.preferredCafeteria && new Date().getHours() >= 11 && new Date().getHours() <= 13) {
      insights.push({
        id: `pref_lunch_${prefs.preferredCafeteria}`,
        category: 'recommendation',
        severity: 'safe',
        title: '可能想吃午餐？',
        message: `你常去「${prefs.preferredCafeteria}」，需要我看看今天有什麼好選擇嗎？`,
        actionSuggestion: '推薦今日午餐',
        relatedModules: ['cafeteria'],
        timestamp: Date.now(),
        source: 'memory',
      });
    }
  }

  void reason; // reserved
  return insights;
}

function mergeInsights(prev: BrainInsight[], next: BrainInsight[]): BrainInsight[] {
  const map = new Map<string, BrainInsight>();
  for (const insight of prev) {
    if (Date.now() - insight.timestamp < 30 * 60_000) {
      map.set(insight.id, insight);
    }
  }
  for (const insight of next) {
    map.set(insight.id, insight);
  }
  return [...map.values()].sort((a, b) => severityScore(b.severity) - severityScore(a.severity));
}

function severityScore(level: RiskLevel): number {
  switch (level) {
    case 'critical':
      return 5;
    case 'danger':
      return 4;
    case 'warning':
      return 3;
    case 'watch':
      return 2;
    default:
      return 1;
  }
}
