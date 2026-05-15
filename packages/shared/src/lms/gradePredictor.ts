/**
 * Grade Predictor — what-if 成績試算引擎（TronClass 沒有）
 *
 * 三大能力：
 *  1. `predictCurrent`：把已批改 + 已繳但未批改 + 未繳交 分開算，
 *      給出「現況最佳/最差預估」邊界。
 *  2. `simulateWhatIf`：把某幾項分數換成假設值 → 重新算總成績。
 *      ex.「如果期末考 80 分，總分多少？」
 *  3. `requiredToReach`：給定目標總分，計算剩下未交項目最少要平均拿幾分。
 *      ex.「想拿 85 分，期末考最少要幾分？」
 *
 * 設計：
 *  - 純函式，無 I/O 依賴；可在 mobile / cloud / web 共用。
 *  - weight 自動正規化（與 gradebookCompute 一致）。
 *  - 未指定分數的項目：currentBest 假設拿滿分、currentWorst 假設拿 0、
 *      currentLikely 用 published 項目的平均分數推估。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface PredictorItem {
  /** 任意 id；用於 simulateWhatIf 的 override map */
  id: string;
  title: string;
  /** 0-100 的權重；超過會自動 normalize */
  weight: number;
  /** 該項滿分，預設 100 */
  maxScore?: number;
  /** 學生在該項的分數；null 表示尚未批改/未繳交 */
  score: number | null;
  /** 是否已批改（影響 currentLikely 估計） */
  graded: boolean;
  /** 是否免修 (excused)；true 時不計入分母 */
  excused?: boolean;
}

export interface PredictionSnapshot {
  /** 將每個 item normalize 後的 weight (加總 = 100) */
  totalWeight: number;
  /** 已批改項目的加權累積分數（百分制，0-100） */
  earnedSoFar: number;
  /** 已批改項目用掉的 weight */
  weightUsed: number;
  /** 剩下沒批改的 weight */
  weightRemaining: number;
  /** 已批改項目平均分數（百分制）。若 0 項，回 null */
  averageGradedPercent: number | null;
  /** 樂觀情境：未批改全拿滿分 → 總成績預估（百分制） */
  bestCase: number;
  /** 悲觀情境：未批改全 0 分 → 總成績預估 */
  worstCase: number;
  /** 中性情境：未批改假設拿目前平均分數 */
  likelyCase: number | null;
  /** 期末等級提示 (A+/A/B+/B/...) — 用 likelyCase */
  letterGrade: string | null;
}

export interface WhatIfOverride {
  itemId: string;
  /** 假設拿到的分數（不是百分比；和 maxScore 同單位） */
  assumedScore: number;
}

export interface WhatIfResult extends PredictionSnapshot {
  overrides: WhatIfOverride[];
  /** 與原始 currentLikely 相比的變化 */
  delta: number | null;
}

export interface RequiredScoreInput {
  /** 想達到的總分（百分制 0-100） */
  targetPercent: number;
  /** 哪些 item 算「未來可控」(未批改)；其他項目 freeze 為現況 */
  futureItemIds: string[];
}

export interface RequiredScoreResult {
  /** 在 futureItemIds 上平均要拿幾分（百分制）才能達到 target */
  requiredAveragePercent: number | null;
  /** 可達性：'easy' / 'doable' / 'hard' / 'impossible' */
  feasibility: 'easy' | 'doable' | 'hard' | 'impossible';
  /** 簡短 explainer */
  explanation: string;
  /** 假設未來項全拿滿能達到的上限 */
  ceiling: number;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function normalizeWeights(items: PredictorItem[]): { items: PredictorItem[]; factor: number } {
  const eligible = items.filter((it) => !it.excused);
  const sum = eligible.reduce((s, it) => s + (Number.isFinite(it.weight) ? it.weight : 0), 0);
  if (sum <= 0) return { items: eligible.map((it) => ({ ...it, weight: 0 })), factor: 0 };
  const factor = 100 / sum;
  return { items: eligible.map((it) => ({ ...it, weight: it.weight * factor })), factor };
}

function asPercent(score: number | null | undefined, maxScore: number | undefined): number | null {
  if (score === null || score === undefined) return null;
  const max = maxScore ?? 100;
  if (max <= 0) return null;
  return Math.max(0, Math.min(100, (score / max) * 100));
}

function letterFromPercent(p: number): string {
  if (p >= 90) return 'A+';
  if (p >= 85) return 'A';
  if (p >= 80) return 'A-';
  if (p >= 77) return 'B+';
  if (p >= 73) return 'B';
  if (p >= 70) return 'B-';
  if (p >= 67) return 'C+';
  if (p >= 63) return 'C';
  if (p >= 60) return 'C-';
  if (p >= 50) return 'D';
  return 'F';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────
// 1. predictCurrent — 把現況算成 best / worst / likely
// ─────────────────────────────────────────────────────────

export function predictCurrent(items: PredictorItem[]): PredictionSnapshot {
  const { items: norm } = normalizeWeights(items);

  let earned = 0;
  let weightUsed = 0;
  let weightRemaining = 0;
  let gradedSum = 0;
  let gradedCount = 0;
  let totalWeight = 0;

  for (const it of norm) {
    totalWeight += it.weight;
    const pct = asPercent(it.score, it.maxScore);
    if (it.graded && pct !== null) {
      earned += (pct * it.weight) / 100;
      weightUsed += it.weight;
      gradedSum += pct;
      gradedCount += 1;
    } else {
      weightRemaining += it.weight;
    }
  }

  const average = gradedCount > 0 ? gradedSum / gradedCount : null;
  const bestCase = round1(earned + weightRemaining);
  const worstCase = round1(earned + 0);
  const likelyCase = average !== null
    ? round1(earned + (average * weightRemaining) / 100)
    : null;

  return {
    totalWeight: round1(totalWeight),
    earnedSoFar: round1(earned),
    weightUsed: round1(weightUsed),
    weightRemaining: round1(weightRemaining),
    averageGradedPercent: average !== null ? round1(average) : null,
    bestCase,
    worstCase,
    likelyCase,
    letterGrade: likelyCase !== null ? letterFromPercent(likelyCase) : null,
  };
}

// ─────────────────────────────────────────────────────────
// 2. simulateWhatIf — 把某幾項換成假設分數重新算
// ─────────────────────────────────────────────────────────

export function simulateWhatIf(
  items: PredictorItem[],
  overrides: WhatIfOverride[],
): WhatIfResult {
  const baseline = predictCurrent(items);
  const overrideMap = new Map(overrides.map((o) => [o.itemId, o.assumedScore]));

  const simulated: PredictorItem[] = items.map((it) => {
    if (overrideMap.has(it.id)) {
      return { ...it, score: overrideMap.get(it.id)!, graded: true };
    }
    return it;
  });

  const snapshot = predictCurrent(simulated);
  const delta =
    baseline.likelyCase !== null && snapshot.likelyCase !== null
      ? round1(snapshot.likelyCase - baseline.likelyCase)
      : null;

  return { ...snapshot, overrides, delta };
}

// ─────────────────────────────────────────────────────────
// 3. requiredToReach — 想拿 target 分，未來項要平均幾分
// ─────────────────────────────────────────────────────────

export function requiredToReach(
  items: PredictorItem[],
  input: RequiredScoreInput,
): RequiredScoreResult {
  const { items: norm } = normalizeWeights(items);

  let earned = 0;
  let futureWeight = 0;

  for (const it of norm) {
    const pct = asPercent(it.score, it.maxScore);
    const isFuture = input.futureItemIds.includes(it.id);
    if (isFuture) {
      futureWeight += it.weight;
    } else if (it.graded && pct !== null) {
      earned += (pct * it.weight) / 100;
    }
    // 既非未來、又沒批改 → 視為 0 分
  }

  const ceiling = round1(earned + futureWeight); // 未來項全拿滿
  const target = Math.max(0, Math.min(100, input.targetPercent));

  if (futureWeight === 0) {
    return {
      requiredAveragePercent: null,
      feasibility: earned >= target ? 'easy' : 'impossible',
      explanation:
        earned >= target
          ? `現有成績已達 ${round1(earned)}% ≥ ${target}%。`
          : `已沒有可控制的未來項目；現況為 ${round1(earned)}%，無法再提升到 ${target}%。`,
      ceiling,
    };
  }

  const neededWeightedPoints = target - earned; // 還缺多少加權分數
  if (neededWeightedPoints <= 0) {
    return {
      requiredAveragePercent: 0,
      feasibility: 'easy',
      explanation: `現有成績已達 ${round1(earned)}% ≥ ${target}%；剩下隨意。`,
      ceiling,
    };
  }

  const requiredAvg = (neededWeightedPoints / futureWeight) * 100;

  let feasibility: RequiredScoreResult['feasibility'];
  if (requiredAvg <= 60) feasibility = 'easy';
  else if (requiredAvg <= 80) feasibility = 'doable';
  else if (requiredAvg <= 100) feasibility = 'hard';
  else feasibility = 'impossible';

  const explanation =
    feasibility === 'impossible'
      ? `就算未來項全拿滿分（上限 ${ceiling}%）也無法達到 ${target}%。`
      : `未來 ${input.futureItemIds.length} 項平均要拿 ${round1(requiredAvg)}% 才能達到 ${target}%。`;

  return {
    requiredAveragePercent: round1(requiredAvg),
    feasibility,
    explanation,
    ceiling,
  };
}

// ─────────────────────────────────────────────────────────
// 4. 便利包裝：直接拉常用的「我想拿 60/70/80/90 各要幾分」
// ─────────────────────────────────────────────────────────

export function commonTargets(
  items: PredictorItem[],
): Array<{ target: number; result: RequiredScoreResult }> {
  const futureItemIds = items.filter((it) => !it.graded && !it.excused).map((it) => it.id);
  return [60, 70, 80, 90].map((target) => ({
    target,
    result: requiredToReach(items, { targetPercent: target, futureItemIds }),
  }));
}
