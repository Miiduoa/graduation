/**
 * Student Risk Engine — 計算學生風險分數的純函式引擎
 *
 * 從 demo 課程資料（出席率、缺繳率、平均分數、AI 採納率）合成 0-100 風險分。
 *
 * 算式：
 *   risk = (1 - 出席率) * 30
 *        + 缺繳率 * 30
 *        + max(0, 60 - 平均分) * 0.7
 *        + (1 - AI 採納率) * 10
 *   上限 100。
 *
 * 分檔：
 *   ≥ 70 critical（要立刻聯絡）
 *   50-69 high（要關注）
 *   30-49 medium（觀察）
 *   < 30 low（健康）
 */

export interface StudentRiskInput {
  uid: string;
  name: string;
  /** 出席率 0-1 */
  attendanceRate: number;
  /** 缺繳率 0-1（未繳 / 總作業數） */
  missingHomeworkRate: number;
  /** 平均成績 0-100，未評分視為 60 */
  averageScore: number;
  /** AI 採納率 0-1，缺資料視為 0.5 */
  aiAcceptRate: number;
  /** 修課數 */
  enrolledCourseCount: number;
}

export type RiskTier = 'critical' | 'high' | 'medium' | 'low';

export interface StudentRiskResult {
  uid: string;
  name: string;
  score: number;
  tier: RiskTier;
  /** 拆解：哪幾個因子貢獻最多 */
  contributors: Array<{ factor: string; contribution: number; note: string }>;
  /** 建議動作 */
  suggestedActions: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function computeStudentRisk(input: StudentRiskInput): StudentRiskResult {
  const att = clamp(input.attendanceRate, 0, 1);
  const miss = clamp(input.missingHomeworkRate, 0, 1);
  const avg = clamp(input.averageScore, 0, 100);
  const ai = clamp(input.aiAcceptRate, 0, 1);

  const attendanceFactor = Math.round((1 - att) * 30);
  const missingFactor = Math.round(miss * 30);
  const gradeFactor = Math.round(Math.max(0, 60 - avg) * 0.7);
  const aiFactor = Math.round((1 - ai) * 10);

  const total = clamp(attendanceFactor + missingFactor + gradeFactor + aiFactor, 0, 100);

  const tier: RiskTier =
    total >= 70 ? 'critical' : total >= 50 ? 'high' : total >= 30 ? 'medium' : 'low';

  const contributors = [
    {
      factor: '出席',
      contribution: attendanceFactor,
      note: `出席率 ${Math.round(att * 100)}%`,
    },
    {
      factor: '缺繳',
      contribution: missingFactor,
      note: `缺繳率 ${Math.round(miss * 100)}%`,
    },
    {
      factor: '成績',
      contribution: gradeFactor,
      note: `平均 ${Math.round(avg)} 分`,
    },
    {
      factor: 'AI 互動',
      contribution: aiFactor,
      note: `採納率 ${Math.round(ai * 100)}%`,
    },
  ].sort((a, b) => b.contribution - a.contribution);

  const suggestedActions: string[] = [];
  if (missingFactor >= 15) suggestedActions.push('發批量提醒給導師');
  if (attendanceFactor >= 15) suggestedActions.push('確認是否需要請假或輔導');
  if (gradeFactor >= 10) suggestedActions.push('安排補救教學 / 學伴配對');
  if (suggestedActions.length === 0) suggestedActions.push('持續觀察，不需主動介入');

  return {
    uid: input.uid,
    name: input.name,
    score: total,
    tier,
    contributors,
    suggestedActions,
  };
}

export function rankStudentsByRisk(inputs: StudentRiskInput[]): StudentRiskResult[] {
  return inputs
    .map(computeStudentRisk)
    .sort((a, b) => b.score - a.score);
}

export const TIER_LABEL: Record<RiskTier, string> = {
  critical: '🔴 緊急',
  high: '🟠 高風險',
  medium: '🟡 中等',
  low: '🟢 健康',
};
