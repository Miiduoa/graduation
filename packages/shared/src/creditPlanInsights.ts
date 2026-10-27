import {
  creditPlanSummary,
  formatCredits,
  type CreditPlan,
} from './creditPlanner';

export type ProjectedTerm = {
  term: number;
  plannedCredits: number;
  cumulativeIfPassed: number | null;
  remainingIfPassed: number | null;
};

export type CreditPlanFeasibility = {
  /** Minimum average across the remaining planned terms before any future course passes. */
  averageNeededPerTerm: number | null;
  /** Still not assigned to a specific semester, including the unassigned "extra" estimate. */
  creditsWithoutSemester: number | null;
  /** Hypothetical gap even if all scheduled courses and other planned credits pass. */
  remainingAfterAllPlans: number | null;
  /** Earliest semester to hit the overall target using semester-assigned courses alone. */
  earliestTargetTerm: number | null;
  terms: ProjectedTerm[];
  categoryGaps: Array<{ key: string; label: string; remaining: number }>;
  pendingMilestones: string[];
  possibleRetakes: Array<{ name: string; semesters: number[] }>;
  workloadCautions: Array<{ term: number; credits: number }>;
  guidance: string[];
};

function decimal(value: number): number {
  return Number(value.toFixed(2));
}

function ceilingToHundredth(value: number): number {
  return Math.ceil(value * 100 - 1e-8) / 100;
}

/**
 * Explain a personally entered plan; never infer school-issued credit recognition
 * or a verified graduation date. All projections require all future courses to
 * pass and be accepted. "Extra" credits have no semester and are NOT placed on
 * the per-term timeline.
 */
export function analyzeCreditPlan(plan: CreditPlan): CreditPlanFeasibility {
  const summary = creditPlanSummary(plan);
  const count = summary.perTerm.length;
  const validTarget = summary.recognized !== null && summary.target !== null &&
    summary.extra !== null;
  const missingBefore = validTarget ? summary.missingBefore : null;

  const averageNeededPerTerm = missingBefore === null
    ? null
    : ceilingToHundredth(missingBefore / count);
  const creditsWithoutSemester = missingBefore === null
    ? null
    : decimal(Math.max(0, missingBefore - summary.courseCredits));
  const remainingAfterAllPlans = validTarget ? summary.remaining : null;

  let running = summary.recognized ?? 0;
  let earliestTargetTerm: number | null =
    validTarget && summary.recognized! >= summary.target! ? 0 : null;
  const terms = summary.perTerm.map(({ term, credits }): ProjectedTerm => {
    running = decimal(running + credits);
    if (
      earliestTargetTerm === null && validTarget && running >= summary.target!
    ) earliestTargetTerm = term;
    return {
      term,
      plannedCredits: credits,
      cumulativeIfPassed: validTarget ? running : null,
      remainingIfPassed: validTarget ? decimal(Math.max(0, summary.target! - running)) : null,
    };
  });

  const categoryGaps = summary.categoryGaps
    .filter((row) => row.remaining !== null && row.remaining > 0)
    .map((row) => ({ key: row.key, label: row.label, remaining: row.remaining! }));
  const pendingMilestones = plan.milestones
    .filter((item) => !item.done)
    .map((item) => item.label);

  const byNormalizedName = new Map<string, { name: string; semesters: Set<number> ; occurrences: number }>();
  for (const course of plan.courses) {
    const normalized = course.name.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
    if (!normalized) continue;
    const existing = byNormalizedName.get(normalized);
    if (existing) {
      existing.semesters.add(course.term);
      existing.occurrences += 1;
    } else {
      byNormalizedName.set(normalized, {
        name: course.name.trim(),
        semesters: new Set([course.term]),
        occurrences: 1,
      });
    }
  }
  const possibleRetakes = [...byNormalizedName.values()]
    .filter((item) => item.occurrences > 1)
    .map(({ name, semesters }) => ({
      name,
      semesters: [...semesters].sort((a, b) => a - b),
    }));

  // 25 credits is a UX workload caution only. It is not a university-imposed cap.
  const workloadCautions = summary.perTerm
    .filter((term) => term.credits > 25)
    .map(({ term, credits }) => ({ term, credits }));

  const guidance: string[] = [];
  if (!validTarget) {
    guidance.push('先輸入已由學校確認可採計的學分、你的目標與有效的額外規劃學分，才能試算。');
  } else {
    if (remainingAfterAllPlans! > 0) {
      guidance.push(
        `即使所有規劃都通過且獲採計，仍需安排 ${formatCredits(remainingAfterAllPlans!)} 學分。`,
      );
    }
    if (creditsWithoutSemester! > 0) {
      guidance.push(
        `還有 ${formatCredits(creditsWithoutSemester!)} 學分未分配到任何未來學期（包含「其他預計學分」）。`,
      );
    }
  }
  if (summary.categoryOvercount) {
    guidance.push('各分類已確認學分加總超過總已確認學分，請先排除重複採計。');
  }
  if (possibleRetakes.length) {
    guidance.push('發現可能重複安排的同名課程；重修是否採計必須以校方認定為準。');
  }
  if (workloadCautions.length) {
    guidance.push('部分學期排課超過 25 學分，請自行核對該校實際修課上限。');
  }
  if (categoryGaps.length) {
    const category = categoryGaps[0];
    guidance.push(
      `以你填寫的分類門檻估算，「${category.label}」仍有 ${formatCredits(category.remaining)} 學分缺口。`,
    );
  }
  if (pendingMilestones.length) {
    guidance.push(
      `還有 ${pendingMilestones.length} 項自行列出的非學分條件尚未標記完成。`,
    );
  }
  if (!guidance.length) {
    guidance.push('目前個人試算未發現缺口；請另行確認必修、抵免、入學年度及學校正式畢業審查。');
  }
  return {
    averageNeededPerTerm,
    creditsWithoutSemester,
    remainingAfterAllPlans,
    earliestTargetTerm,
    terms,
    categoryGaps,
    pendingMilestones,
    possibleRetakes,
    workloadCautions,
    guidance: guidance.slice(0, 6),
  };
}
