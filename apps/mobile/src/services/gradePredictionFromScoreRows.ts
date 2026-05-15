import type { PredictorItem } from '@campus/shared';

/** 與 CourseScoresScreen 的 ScoreRow 對齊的最小欄位 */
export type ScoreRowForPrediction = {
  id: string;
  title: string;
  score: number | null;
  totalScore: number | null;
  weight: number | null;
  status: 'graded' | 'pending' | 'missing';
};

/**
 * 將課程成績列轉成 gradePredictor 輸入。
 * - 無權重時：各列均分 100%。
 * - 混合時：已填權重保留，其餘均分剩餘配額（若剩餘為 0 則那些列為 0，交由 predictor 正規化）。
 */
export function scoreRowsToPredictorItems(rows: ScoreRowForPrediction[]): PredictorItem[] {
  if (rows.length === 0) return [];

  const explicit = rows.filter((r) => r.weight !== null && r.weight > 0);
  const implicit = rows.filter((r) => r.weight === null || r.weight <= 0);

  const weightById = new Map<string, number>();

  if (explicit.length === rows.length) {
    for (const r of rows) weightById.set(r.id, r.weight!);
  } else if (explicit.length === 0) {
    const w = 100 / rows.length;
    for (const r of rows) weightById.set(r.id, w);
  } else {
    const sumKnown = explicit.reduce((s, r) => s + (r.weight ?? 0), 0);
    const remainder = Math.max(0, 100 - sumKnown);
    const perImplicit = implicit.length > 0 ? remainder / implicit.length : 0;
    for (const r of explicit) weightById.set(r.id, r.weight!);
    for (const r of implicit) weightById.set(r.id, perImplicit);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    weight: weightById.get(r.id) ?? 0,
    maxScore: r.totalScore && r.totalScore > 0 ? r.totalScore : 100,
    score: r.score,
    graded: r.status === 'graded' && r.score !== null,
  }));
}
