import { compareCreditScenario } from './creditPlanScenarios';
import { restoreCreditPlan, type CreditPlan } from './creditPlanner';

/** Only the owning workspace may persist a proposed replacement. */
export type CreditScenarioWriter = (expected: CreditPlan, next: CreditPlan) => Promise<CreditPlan | null>;
export type ScenarioAdoption = {
  before: CreditPlan;
  after: CreditPlan;
  removed: Array<{ id: string; name: string; credits: number; term: number }>;
  moved: Array<{ id: string; name: string; from: number; to: number }>;
};
export type AdoptionResult = { ok: true; value: ScenarioAdoption } | { ok: false; message: string };

/** A comparison can move or omit existing future courses, never change earned credits. */
export function prepareCreditScenarioAdoption(before: CreditPlan, after: CreditPlan): AdoptionResult {
  try {
    const source = restoreCreditPlan(JSON.stringify(before));
    const candidate = restoreCreditPlan(JSON.stringify(after));
    if (!source || !candidate) return { ok: false, message: '規劃格式無效，請先修正再採用。' };
    const terms = new Map(candidate.courses.map((course) => [course.id, course.term]));
    const comparison = compareCreditScenario(source, {
      baseline: JSON.stringify(source),
      choices: source.courses.map((course) => ({ courseId: course.id, term: terms.get(course.id) ?? null })),
    });
    if (comparison.ok === false) return { ok: false, message: comparison.message };
    // Exact compare is deliberately conservative: changed metadata, course values,
    // order, targets or academic evidence cannot be hidden inside an adoption.
    if (JSON.stringify(comparison.plan) !== JSON.stringify(candidate)) {
      return { ok: false, message: '方案不只變更修課安排，請重新比較，未更新原規劃。' };
    }
    if (!comparison.changed) return { ok: false, message: '方案與原規劃相同，無須採用。' };
    return { ok: true, value: {
      before: source, after: candidate,
      removed: comparison.omitted.map(({ id, name, credits, term }) => ({ id, name, credits, term })),
      moved: comparison.moved.map((course) => ({ ...course })),
    } };
  } catch {
    return { ok: false, message: '無法驗證這份比較方案，原規劃不變。' };
  }
}

/** Undo is exact replacement, not a merge that could erase a later edit. */
export function prepareCreditScenarioUndo(current: CreditPlan, receipt: ScenarioAdoption): CreditPlan | null {
  const checked = prepareCreditScenarioAdoption(receipt.before, receipt.after);
  if (checked.ok === false || JSON.stringify(current) !== JSON.stringify(checked.value.after)) return null;
  return checked.value.before;
}

export function creditScenarioChangeSummary(value: ScenarioAdoption): string {
  return `改期 ${value.moved.length} 門、不再安排 ${value.removed.length} 門。已確認學分、目標與非學分條件不變。`;
}
