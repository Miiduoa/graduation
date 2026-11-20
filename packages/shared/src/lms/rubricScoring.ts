/**
 * Rubric Scoring Engine — TronClass parity P1-6
 *
 * 教師建立 rubric：N 個 criterion，每個 criterion 有 M 個 level（分數階梯）
 * 學生作業依 criteria 一條一條打分 → 加總（可加權）
 *
 * 純函式。
 */

export interface RubricLevel {
  /** 例如 'excellent' | 'good' | 'fair' | 'poor' */
  id: string;
  label: string;
  points: number;
  description?: string;
}

export interface RubricCriterion {
  id: string;
  title: string;
  description?: string;
  /** 加權（0-100），總和 ≠ 100 會自動正規化 */
  weight: number;
  levels: RubricLevel[];
}

export interface Rubric {
  id: string;
  title: string;
  criteria: RubricCriterion[];
  /** 總滿分，預設 100 */
  maxScore?: number;
}

export interface RubricScore {
  criterionId: string;
  levelId: string;
  comment?: string;
}

export interface RubricEvaluation {
  totalScore: number;
  perCriterion: Array<{
    criterionId: string;
    title: string;
    levelId: string | null;
    levelLabel: string | null;
    rawPoints: number;
    weight: number;
    normalizedWeight: number;
    weightedScore: number;
    comment?: string;
  }>;
  /** 各 criterion 的人工評語合併（給學生看） */
  feedbackSummary: string;
}

function normalizeWeights(c: RubricCriterion[]): Array<RubricCriterion & { normalizedWeight: number }> {
  const sum = c.reduce((acc, x) => acc + Math.max(0, x.weight), 0);
  if (sum <= 0) {
    const equal = c.length > 0 ? 100 / c.length : 0;
    return c.map((x) => ({ ...x, normalizedWeight: equal }));
  }
  return c.map((x) => ({ ...x, normalizedWeight: (Math.max(0, x.weight) / sum) * 100 }));
}

export function evaluateRubric(rubric: Rubric, scores: RubricScore[]): RubricEvaluation {
  const normalized = normalizeWeights(rubric.criteria);
  const byId = new Map(normalized.map((c) => [c.id, c]));
  const scoreById = new Map(scores.map((s) => [s.criterionId, s]));

  const perCriterion: RubricEvaluation['perCriterion'] = [];
  let totalScore = 0;
  for (const c of normalized) {
    const s = scoreById.get(c.id);
    const level = s ? c.levels.find((lv) => lv.id === s.levelId) : null;
    const levelMaxPoints = c.levels.reduce((acc, lv) => Math.max(acc, lv.points), 0);
    const rawPoints = level?.points ?? 0;
    const weightedScore =
      levelMaxPoints > 0 ? (rawPoints / levelMaxPoints) * c.normalizedWeight : 0;
    totalScore += weightedScore;
    perCriterion.push({
      criterionId: c.id,
      title: c.title,
      levelId: level?.id ?? null,
      levelLabel: level?.label ?? null,
      rawPoints,
      weight: c.weight,
      normalizedWeight: Math.round(c.normalizedWeight * 100) / 100,
      weightedScore: Math.round(weightedScore * 100) / 100,
      comment: s?.comment,
    });
    void byId;
  }

  // 將 0-100 比例轉成 rubric 的滿分（預設 100）
  const maxScore = rubric.maxScore ?? 100;
  const final = (totalScore / 100) * maxScore;

  const feedback = perCriterion
    .filter((p) => p.comment && p.comment.trim().length > 0)
    .map((p) => `【${p.title}】${p.comment}`)
    .join('\n');

  return {
    totalScore: Math.round(final * 100) / 100,
    perCriterion,
    feedbackSummary: feedback,
  };
}

/**
 * 取得 rubric 的滿分（後端用於把 RubricEvaluation 寫入 gradebookEntries）
 */
export function rubricMaxScore(rubric: Rubric): number {
  return rubric.maxScore ?? 100;
}
