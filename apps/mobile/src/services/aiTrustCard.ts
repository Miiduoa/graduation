/**
 * AI Trust Card — 期末 AI 信任卡
 *
 * 設計動機（見 docs/REALITY_AUDIT_2026_05_15.md D.2）：
 *   行業裡沒有人這樣做。學期末給每位學生一張總結卡：
 *     「本學期 AI 主動推送 38 次，你採納 23 次（60%）。
 *      AI 為了不打擾你，自動擋下 17 次推送（含夜間 12、上課中 5）。」
 *
 *   讓 AI 從「黑盒」變成可審計、可分享的「透明工具」。學生會分享到 IG。
 *
 * 純函式：接 audit log + interaction history → 算 trust metrics + 摘要。
 */

import type { AuditLogEntry } from './aiSkillApplicator';
import type { InteractionEvent } from './aiLearning';

export interface TrustCardData {
  /** 卡片所屬時間範圍 */
  periodLabel: string;
  /** 時間 range（unix ms） */
  fromMs: number;
  toMs: number;

  /** 推送總數 */
  totalSuggested: number;
  /** AI 自動推送 */
  autoPushed: number;
  /** AI 先問使用者 */
  askedUser: number;
  /** AI 自己擋下（guardrail 阻擋） */
  blocked: number;

  /** 使用者採納次數 */
  accepted: number;
  /** 使用者忽略/拒絕 */
  dismissed: number;
  /** 採納率 0-1 */
  acceptRate: number;

  /** Guardrail 觸發分布 */
  guardrailBreakdown: Record<string, number>;

  /** AI 守住的承諾 */
  highlights: string[];

  /** 整體信任分 0-100（演算法綜合採納率 + AI 自律比例 + guardrail 觸發頻率） */
  trustScore: number;

  /** 可分享文案（適合貼到 IG / Threads） */
  shareableSummary: string;
}

const REASON_LABEL: Record<string, string> = {
  daily_cap_reached: '每日上限',
  low_confidence_pattern: '信心不足',
  high_impact_needs_confirm: '高影響先問',
  dedupe_window: '4h 內已推過',
  quiet_hours: '安靜時段',
  user_rejection_pattern: '連 3 拒煞車',
  global_kill_switch: '使用者全停',
};

/**
 * 計算 trust score 0-100。
 * 演算法直覺：
 *   - 採納率 50-80% 是「健康」（兩端都不健康，太低 = AI 沒幫上忙；太高 = 缺乏批判）
 *   - 自律比例（blocked/total）≥ 25% = 加分（AI 知道何時該收手）
 *   - 高影響先問比例 ≥ 80% = 加分（不擅自做主）
 */
export function computeTrustScore(d: {
  acceptRate: number;
  blocked: number;
  askedUser: number;
  totalSuggested: number;
  highImpactKindsCount: number;
}): number {
  const acceptScore = (() => {
    const rate = d.acceptRate;
    // 50-80 → 100；越遠扣分
    if (rate >= 0.5 && rate <= 0.8) return 100;
    if (rate < 0.5) return Math.round(rate * 200); // 0 → 0；0.5 → 100
    return Math.round(Math.max(0, 100 - (rate - 0.8) * 250)); // 0.8 → 100；1.0 → 50
  })();

  const restraintScore = d.totalSuggested === 0
    ? 60
    : Math.min(100, Math.round((d.blocked / d.totalSuggested) * 400)); // 25% blocked = 100

  const confirmScore = d.highImpactKindsCount === 0
    ? 80
    : Math.min(100, Math.round((d.askedUser / d.highImpactKindsCount) * 100));

  return Math.round(acceptScore * 0.4 + restraintScore * 0.35 + confirmScore * 0.25);
}

export interface BuildTrustCardInput {
  uid: string;
  displayName?: string;
  auditLog: AuditLogEntry[];
  history: InteractionEvent[];
  periodLabel?: string;
  /** filter 範圍，預設不限 */
  fromMs?: number;
  toMs?: number;
}

const HIGH_IMPACT_KINDS = ['urgent_action', 'teacher_action', 'department_action'];

export function buildTrustCard(input: BuildTrustCardInput): TrustCardData {
  const fromMs = input.fromMs ?? 0;
  const toMs = input.toMs ?? Date.now();
  const periodLabel = input.periodLabel ?? '本學期';

  const log = input.auditLog.filter((e) => {
    const t = new Date(e.occurredAt).getTime();
    return t >= fromMs && t <= toMs;
  });
  const hist = input.history.filter((e) => {
    const t = new Date(e.occurredAt).getTime();
    return t >= fromMs && t <= toMs;
  });

  const autoPushed = log.filter((e) => e.decision === 'auto_pushed').length;
  const askedUser = log.filter((e) => e.decision === 'asked_user').length;
  const blocked = log.filter((e) => e.decision === 'blocked').length;
  const totalSuggested = log.length;

  const accepted = hist.filter((h) => h.reaction === 'accepted').length;
  const dismissed = hist.filter(
    (h) => h.reaction === 'dismissed' || h.reaction === 'ignored',
  ).length;
  const interactedCount = accepted + dismissed;
  const acceptRate = interactedCount === 0 ? 0 : accepted / interactedCount;

  const guardrailBreakdown: Record<string, number> = {};
  for (const e of log) {
    if (e.guardrail && e.guardrail !== 'ok') {
      guardrailBreakdown[e.guardrail] = (guardrailBreakdown[e.guardrail] ?? 0) + 1;
    }
  }

  const highImpactKindsCount = log.filter((e) => HIGH_IMPACT_KINDS.includes(e.kind)).length;

  const trustScore = computeTrustScore({
    acceptRate,
    blocked,
    askedUser,
    totalSuggested,
    highImpactKindsCount,
  });

  const highlights: string[] = [];
  const quietHoursBlocked = guardrailBreakdown.quiet_hours ?? 0;
  const dailyCapBlocked = guardrailBreakdown.daily_cap_reached ?? 0;
  const rejectionLearned = guardrailBreakdown.user_rejection_pattern ?? 0;

  if (quietHoursBlocked > 0) {
    highlights.push(`為了不打擾你，AI 在安靜時段擋下 ${quietHoursBlocked} 次推送`);
  }
  if (dailyCapBlocked > 0) {
    highlights.push(`AI 守住「每天最多 8 次」上限，超過時自動擋下 ${dailyCapBlocked} 次`);
  }
  if (rejectionLearned > 0) {
    highlights.push(`AI 觀察到你拒絕某類建議後，自動煞車 ${rejectionLearned} 次`);
  }
  if (askedUser > 0) {
    highlights.push(`${askedUser} 次高影響動作先問你，沒擅自決定`);
  }
  if (highlights.length === 0) {
    highlights.push('本期間 AI 行動量不大，沒有特別的守門紀錄');
  }

  const shareableSummary = [
    `🎓 ${periodLabel}的 AI 信任卡`,
    `📊 推送總數 ${totalSuggested}（採納 ${accepted}）`,
    `🛡 AI 自律擋下 ${blocked} 次`,
    `🌙 安靜時段 ${quietHoursBlocked} 次`,
    `⭐ 信任分數 ${trustScore}/100`,
  ].join('\n');

  return {
    periodLabel,
    fromMs,
    toMs,
    totalSuggested,
    autoPushed,
    askedUser,
    blocked,
    accepted,
    dismissed,
    acceptRate,
    guardrailBreakdown,
    highlights,
    trustScore,
    shareableSummary,
  };
}

export { REASON_LABEL };
