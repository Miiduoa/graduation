/**
 * Gradebook Compute — TronClass parity 成績簿加權計算
 *
 * 設計目標：
 *  - 純函式，無 I/O 依賴
 *  - 支援多項作業 / 測驗 / 期中 / 期末加權
 *  - weight 自動正規化到 100%（若教師輸入總和 ≠ 100，依比例縮放，不報錯）
 *  - 未繳交 / 0 分缺考視為 0 分但計入計算
 *  - 教師可以選擇「免修」（excused）→ 排除該項，重新計算其他加權
 *  - 通過門檻可設（預設 60）
 *  - 回傳每個學生的 finalScore、是否通過、是否發布
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface GradeItem {
  id: string;
  title: string;
  /** 0–100 範圍的權重；若全部加總 ≠ 100 會自動依比例縮放 */
  weight: number;
  /** 該項滿分（預設 100） */
  maxScore?: number;
}

export interface StudentScore {
  /** 對應 GradeItem.id */
  gradeItemId: string;
  /** 該學生在該項的原始分數（0 ~ maxScore） */
  score: number | null;
  /** 是否免修；true 時不計入分母 */
  excused?: boolean;
  /** 是否逾期 */
  isLate?: boolean;
}

export interface StudentGradeInput {
  uid: string;
  displayName: string;
  scores: StudentScore[];
}

export interface ComputeGradebookOptions {
  /** 通過分數，預設 60 */
  passingScore?: number;
  /** 是否已發布最終成績；若未發布，回傳 finalScore 仍計算但 published=false */
  published?: boolean;
  publishedAt?: string | null;
}

export interface StudentGradebookRow {
  uid: string;
  displayName: string;
  finalScore: number | null;
  passingScore: number;
  passed: boolean;
  published: boolean;
  publishedAt: string | null;
  gradedItemCount: number;
  totalItemCount: number;
  breakdown: Array<{
    gradeItemId: string;
    title: string;
    weight: number;
    normalizedWeight: number;
    score: number | null;
    contribution: number;
    excused: boolean;
    isLate: boolean;
  }>;
}

export interface GradebookComputeResult {
  items: Array<GradeItem & { normalizedWeight: number }>;
  rows: StudentGradebookRow[];
  classAverage: number | null;
  passRate: number | null;
  published: boolean;
  publishedAt: string | null;
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function normalizeItemWeights(items: GradeItem[]): Array<GradeItem & { normalizedWeight: number }> {
  const sum = items.reduce((acc, it) => acc + Math.max(0, Number(it.weight) || 0), 0);
  if (sum <= 0) {
    // 若教師沒設 weight，平均分配
    const equal = items.length > 0 ? 100 / items.length : 0;
    return items.map((it) => ({ ...it, normalizedWeight: equal }));
  }
  return items.map((it) => ({
    ...it,
    normalizedWeight: (Math.max(0, Number(it.weight) || 0) / sum) * 100,
  }));
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

// ─────────────────────────────────────────────────────────
// Compute
// ─────────────────────────────────────────────────────────

export function computeGradebook(
  items: GradeItem[],
  students: StudentGradeInput[],
  options: ComputeGradebookOptions = {},
): GradebookComputeResult {
  const passingScore = options.passingScore ?? 60;
  const published = options.published ?? false;
  const publishedAt = published ? options.publishedAt ?? new Date().toISOString() : null;

  const normalizedItems = normalizeItemWeights(items);
  const itemById = new Map(normalizedItems.map((it) => [it.id, it]));

  const rows: StudentGradebookRow[] = students.map((stu) => {
    // 過濾出該學生未 excused 的項目，重新分配剩餘權重
    const nonExcusedItems = normalizedItems.filter((it) => {
      const found = stu.scores.find((s) => s.gradeItemId === it.id);
      return !(found && found.excused === true);
    });
    const remainingWeightSum = nonExcusedItems.reduce((acc, it) => acc + it.normalizedWeight, 0);
    const scale = remainingWeightSum > 0 ? 100 / remainingWeightSum : 0;

    let earnedTotal = 0;
    let gradedCount = 0;
    const breakdown = normalizedItems.map((it) => {
      const s = stu.scores.find((x) => x.gradeItemId === it.id);
      const excused = !!s?.excused;
      const isLate = !!s?.isLate;
      const maxScore = it.maxScore ?? 100;
      const score = s?.score ?? null;
      const normalizedWeight = excused ? 0 : it.normalizedWeight * scale;
      let contribution = 0;
      if (!excused && score !== null && Number.isFinite(score) && maxScore > 0) {
        contribution = (clamp(score, 0, maxScore) / maxScore) * normalizedWeight;
        earnedTotal += contribution;
        gradedCount += 1;
      }
      return {
        gradeItemId: it.id,
        title: it.title,
        weight: it.weight,
        normalizedWeight: Math.round(normalizedWeight * 100) / 100,
        score,
        contribution: Math.round(contribution * 100) / 100,
        excused,
        isLate,
      };
    });

    const finalScore = gradedCount > 0 ? Math.round(earnedTotal * 100) / 100 : null;
    const passed = finalScore !== null && finalScore >= passingScore;
    return {
      uid: stu.uid,
      displayName: stu.displayName,
      finalScore,
      passingScore,
      passed,
      published,
      publishedAt,
      gradedItemCount: gradedCount,
      totalItemCount: normalizedItems.length,
      breakdown,
    };
  });

  // 班級統計
  const scored = rows.map((r) => r.finalScore).filter((n): n is number => n !== null);
  const classAverage =
    scored.length > 0 ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100) / 100 : null;
  const passCount = rows.filter((r) => r.passed).length;
  const passRate = rows.length > 0 ? Math.round((passCount / rows.length) * 10000) / 100 : null;

  return {
    items: normalizedItems.map((it) => ({
      ...it,
      normalizedWeight: Math.round(it.normalizedWeight * 100) / 100,
    })),
    rows,
    classAverage,
    passRate,
    published,
    publishedAt,
  };
}

// 對外便利方法：把 quizAttempt 結果寫成 StudentScore
export function quizAttemptToStudentScore(
  gradeItemId: string,
  attempt: { earnedPoints: number; totalPoints: number; submittedAt?: string },
  options: { isLate?: boolean; excused?: boolean } = {},
): StudentScore {
  // 將 quiz 得分換算成 100 分制
  const score =
    attempt.totalPoints > 0
      ? Math.round((attempt.earnedPoints / attempt.totalPoints) * 10000) / 100
      : 0;
  return {
    gradeItemId,
    score,
    isLate: options.isLate ?? false,
    excused: options.excused ?? false,
  };
}
