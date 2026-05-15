/**
 * AI Skill Applicator — AI 學會後自動運用技能（含安全閥）
 *
 * 設計：AI 從 aiLearning 學到 pattern 後不直接 apply。應該：
 *  1. 套到 ranking 之前先過 guardrails
 *  2. 高影響動作要 user 確認
 *  3. 每天動作上限避免騷擾
 *  4. quiet hours 不打擾
 *  5. user 拒絕模式 → 自動煞車
 *  6. 所有自動動作都記 audit log
 *
 * 7 條 guardrail：
 *  G1: 每 24h 自動推送上限（預設 8 次）
 *  G2: 學到的 pattern 信心 < 60 → 不 apply
 *  G3: 高影響 (urgent_action / teacher_action) 永遠先問 user
 *  G4: 同一 suggestion id 4h 內不重推
 *  G5: 22:00 - 08:00 quiet hours 只推 critical
 *  G6: user 連續 3 次拒絕同 kind → 該 kind 24h 內不再推
 *  G7: 全域急停旗標：user 可一鍵關掉 AI 主動
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getScopedStorageKey } from './scopedStorage';
import type {
  ProactiveSuggestion,
  SuggestionKind,
} from './proactiveAIAgent';
import {
  adjustScore,
  discoverPatterns,
  loadInteractionHistory,
  computePreferenceProfile,
  type InteractionEvent,
  type DiscoveredPattern,
} from './aiLearning';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type GuardrailReason =
  | 'daily_cap_reached'
  | 'low_confidence_pattern'
  | 'high_impact_needs_confirm'
  | 'dedupe_window'
  | 'quiet_hours'
  | 'user_rejection_pattern'
  | 'global_kill_switch'
  | 'ok';

export interface GuardrailVerdict {
  /** 是否允許自動執行 */
  allow: boolean;
  /** 主要阻擋原因（最嚴重的） */
  reason: GuardrailReason;
  /** 完整失敗原因（多個 guardrail 可能同時觸發） */
  failedRules: GuardrailReason[];
  /** 如果 needsConfirm，UI 應該怎麼提示 user */
  needsConfirm: boolean;
  /** 給 audit log 的 explanation */
  explanation: string;
}

export interface SkillApplyInput {
  uid: string;
  suggestion: ProactiveSuggestion;
  now: string;
  /** user 在 settings 開啟的全域急停 */
  globalKillSwitch?: boolean;
  /** 過去 24h 已自動推送過幾次 */
  todayPushedCount: number;
  /** 之前推過的 suggestion id + time */
  recentPushes: Array<{ id: string; pushedAt: string; kind: SuggestionKind }>;
  /** 互動歷史（從 aiLearning 來） */
  history: InteractionEvent[];
}

export interface AppliedSkill {
  pattern: DiscoveredPattern;
  appliedAs: string;
  effect: string;
}

export interface AuditLogEntry {
  occurredAt: string;
  suggestionId: string;
  kind: SuggestionKind;
  decision: 'auto_pushed' | 'asked_user' | 'blocked';
  guardrail: GuardrailReason;
  baseConfidence: number;
  adjustedConfidence: number;
  appliedSkills: AppliedSkill[];
  explanation: string;
}

// ─────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────

const AUDIT_LOG_BASE = 'ai_skill_audit_log_v1';

export async function appendAuditLog(uid: string, entry: AuditLogEntry): Promise<void> {
  try {
    const key = getScopedStorageKey(AUDIT_LOG_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    const arr: AuditLogEntry[] = raw ? JSON.parse(raw) : [];
    arr.unshift(entry);
    await AsyncStorage.setItem(key, JSON.stringify(arr.slice(0, 200)));
  } catch {
    /* swallow */
  }
}

export async function loadAuditLog(uid: string): Promise<AuditLogEntry[]> {
  try {
    const key = getScopedStorageKey(AUDIT_LOG_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const DAILY_PUSH_CAP = 8;
const PATTERN_MIN_CONFIDENCE = 60;
const DEDUPE_WINDOW_HOURS = 4;
const QUIET_HOURS_START = 22;
const QUIET_HOURS_END = 8;
const REJECTION_THRESHOLD = 3;
const REJECTION_LOOKBACK_HOURS = 24;

const HIGH_IMPACT_KINDS: SuggestionKind[] = [
  'urgent_action',
  'teacher_action',
  'department_action',
];

// ─────────────────────────────────────────────────────────
// 1. Guardrail evaluation
// ─────────────────────────────────────────────────────────

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

export function evaluateGuardrails(input: SkillApplyInput): GuardrailVerdict {
  const failed: GuardrailReason[] = [];
  const now = input.now;
  const nowDate = new Date(now);
  const hour = nowDate.getHours();
  let needsConfirm = false;

  // G7: kill switch
  if (input.globalKillSwitch) {
    return {
      allow: false,
      reason: 'global_kill_switch',
      failedRules: ['global_kill_switch'],
      needsConfirm: false,
      explanation: 'AI 主動模式已被使用者關閉',
    };
  }

  // G1: daily cap
  if (input.todayPushedCount >= DAILY_PUSH_CAP) {
    failed.push('daily_cap_reached');
  }

  // G4: dedupe
  const recentPush = input.recentPushes.find((p) => p.id === input.suggestion.id);
  if (recentPush && hoursBetween(recentPush.pushedAt, now) < DEDUPE_WINDOW_HOURS) {
    failed.push('dedupe_window');
  }

  // G5: quiet hours
  const inQuietHours = hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
  if (inQuietHours && input.suggestion.severity !== 'critical') {
    failed.push('quiet_hours');
  }

  // G6: user rejection pattern — 同 kind 過去 24h 內被拒絕 ≥ REJECTION_THRESHOLD 次
  const cutoff = new Date(nowDate.getTime() - REJECTION_LOOKBACK_HOURS * 3_600_000);
  const recentRejections = input.history.filter((h) =>
    h.kind === input.suggestion.kind
    && new Date(h.occurredAt) >= cutoff
    && (h.reaction === 'dismissed' || h.reaction === 'ignored'),
  ).length;
  if (recentRejections >= REJECTION_THRESHOLD) {
    failed.push('user_rejection_pattern');
  }

  // G3: high impact → needs confirm
  if (HIGH_IMPACT_KINDS.includes(input.suggestion.kind)) {
    needsConfirm = true;
  }

  if (failed.length > 0) {
    return {
      allow: false,
      reason: failed[0],
      failedRules: failed,
      needsConfirm: false,
      explanation: `被 ${failed.length} 條 guardrail 阻擋：${failed.join('、')}`,
    };
  }

  return {
    allow: true,
    reason: 'ok',
    failedRules: [],
    needsConfirm,
    explanation: needsConfirm
      ? '通過 guardrail 但屬高影響動作 → 詢問 user'
      : '通過所有 guardrail → 自動推送',
  };
}

// ─────────────────────────────────────────────────────────
// 2. Skill application — 把學到的 pattern 套用到 suggestion 信心分
// ─────────────────────────────────────────────────────────

export function applySkills(
  suggestion: ProactiveSuggestion,
  history: InteractionEvent[],
  now: string,
): {
  adjustedConfidence: number;
  appliedSkills: AppliedSkill[];
  reason: string;
} {
  const profile = computePreferenceProfile(history);
  const patterns = discoverPatterns(history);

  const hour = new Date(now).getHours();

  // 先用 aiLearning.adjustScore 算基本 adjustment
  const adj = adjustScore(suggestion.confidence, suggestion.kind, hour, profile);

  // 再 layer 上 pattern（信心 ≥ 60 才 apply）
  const applied: AppliedSkill[] = [];
  let confidence = adj.adjustedConfidence;

  for (const p of patterns) {
    if (p.confidence < PATTERN_MIN_CONFIDENCE) continue;
    if (p.kind === 'rejected_kind' && p.pattern.includes(suggestion.kind)) {
      // 該 kind 被頻繁拒絕 → 大幅降低
      confidence = Math.max(0, Math.round(confidence * 0.4));
      applied.push({
        pattern: p,
        appliedAs: 'multiplier 0.4x',
        effect: '該 kind 過往被拒絕，大幅降低信心',
      });
    }
    if (p.kind === 'high_completion' && p.pattern.includes(suggestion.kind)) {
      // 該 kind 完成率高 → 拉高
      confidence = Math.min(100, Math.round(confidence * 1.3));
      applied.push({
        pattern: p,
        appliedAs: 'multiplier 1.3x',
        effect: '該 kind 完成率高，拉高信心',
      });
    }
    if (p.kind === 'preferred_time' && p.pattern.includes(`${hour}`)) {
      confidence = Math.min(100, Math.round(confidence * 1.15));
      applied.push({
        pattern: p,
        appliedAs: 'multiplier 1.15x',
        effect: '現在是偏好時段，提高信心',
      });
    }
    if (p.kind === 'frequent_snooze' && p.pattern.includes(suggestion.kind)) {
      confidence = Math.round(confidence * 0.7);
      applied.push({
        pattern: p,
        appliedAs: 'multiplier 0.7x',
        effect: '該 kind 常被 snooze，稍微降低',
      });
    }
  }

  return {
    adjustedConfidence: confidence,
    appliedSkills: applied,
    reason: adj.reason + (applied.length > 0 ? `；學到的 ${applied.length} 個技能也被套用` : ''),
  };
}

// ─────────────────────────────────────────────────────────
// 3. 主入口：自動決定該不該推 + audit log
// ─────────────────────────────────────────────────────────

export interface ApplySkillDecision {
  decision: 'auto_push' | 'ask_user' | 'block';
  adjustedConfidence: number;
  appliedSkills: AppliedSkill[];
  guardrailVerdict: GuardrailVerdict;
  explanation: string;
}

export async function applyAndDecide(
  input: SkillApplyInput,
): Promise<ApplySkillDecision> {
  const skillResult = applySkills(input.suggestion, input.history, input.now);
  const verdict = evaluateGuardrails(input);

  let decision: ApplySkillDecision['decision'];
  if (!verdict.allow) decision = 'block';
  else if (verdict.needsConfirm) decision = 'ask_user';
  else decision = 'auto_push';

  const explanation = [
    `信心：${input.suggestion.confidence} → ${skillResult.adjustedConfidence}（${skillResult.reason}）`,
    `guardrail：${verdict.explanation}`,
    `→ ${
      decision === 'auto_push' ? '自動推送'
      : decision === 'ask_user' ? '詢問 user'
      : '阻擋'
    }`,
  ].join('｜');

  // Audit log
  await appendAuditLog(input.uid, {
    occurredAt: input.now,
    suggestionId: input.suggestion.id,
    kind: input.suggestion.kind,
    decision: decision === 'auto_push'
      ? 'auto_pushed'
      : decision === 'ask_user'
        ? 'asked_user'
        : 'blocked',
    guardrail: verdict.reason,
    baseConfidence: input.suggestion.confidence,
    adjustedConfidence: skillResult.adjustedConfidence,
    appliedSkills: skillResult.appliedSkills,
    explanation,
  });

  return {
    decision,
    adjustedConfidence: skillResult.adjustedConfidence,
    appliedSkills: skillResult.appliedSkills,
    guardrailVerdict: verdict,
    explanation,
  };
}

// ─────────────────────────────────────────────────────────
// 4. 全域 kill switch state（per-uid）
// ─────────────────────────────────────────────────────────

const KILL_SWITCH_BASE = 'ai_skill_kill_switch_v1';

export async function getKillSwitch(uid: string): Promise<boolean> {
  try {
    const key = getScopedStorageKey(KILL_SWITCH_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function setKillSwitch(uid: string, on: boolean): Promise<void> {
  try {
    const key = getScopedStorageKey(KILL_SWITCH_BASE, { uid });
    await AsyncStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* swallow */
  }
}
