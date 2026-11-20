import { analyzeCreditPlan } from './creditPlanInsights';
import { creditPlanSummary, restoreCreditPlan, type CreditPlan } from './creditPlanner';

/** 比較方案只改未來課程是否排入及學期，不更動已確認學分或校務資料。 */
export type CreditScenarioChoice = { courseId: string; term: number | null };
export type CreditScenario = { baseline: string; choices: CreditScenarioChoice[] };
export type CreditScenarioPreset = 'all' | 'registered';

export function startCreditScenario(plan: CreditPlan, preset: CreditScenarioPreset = 'all'): CreditScenario {
  return {
    baseline: JSON.stringify(plan),
    choices: plan.courses.map((course) => ({
      courseId: course.id,
      term: preset === 'registered' && course.status !== 'registered' ? null : course.term,
    })),
  };
}

export function changeCreditScenario(
  scenario: CreditScenario,
  courseId: string,
  term: number | null,
): CreditScenario {
  return { ...scenario, choices: scenario.choices.map((choice) =>
    choice.courseId === courseId ? { ...choice, term } : choice) };
}

export type CreditScenarioComparison = {
  ok: true;
  plan: CreditPlan;
  before: ReturnType<typeof creditPlanSummary>;
  after: ReturnType<typeof creditPlanSummary>;
  beforeInsights: ReturnType<typeof analyzeCreditPlan>;
  afterInsights: ReturnType<typeof analyzeCreditPlan>;
  omitted: CreditPlan['courses'];
  moved: Array<{ id: string; name: string; from: number; to: number }>;
  terms: Array<{ term: number; before: number; after: number; delta: number }>;
  categories: Array<{ key: string; label: string; before: number | null; after: number | null }>;
  plannedDelta: number;
  remainingDelta: number | null;
  changed: boolean;
};
export type CreditScenarioResult = CreditScenarioComparison | {
  ok: false;
  reason: 'invalid-plan' | 'stale' | 'invalid-choice';
  message: string;
};

export function compareCreditScenario(plan: CreditPlan, scenario: CreditScenario): CreditScenarioResult {
  const serialized = JSON.stringify(plan);
  const baseline = restoreCreditPlan(serialized);
  if (!baseline) return { ok: false, reason: 'invalid-plan', message: '原規劃有尚未填妥或無效的欄位，請先修正再比較。' };
  if (scenario.baseline !== serialized) return { ok: false, reason: 'stale', message: '原規劃已更新，請以最新內容重新開始比較。' };
  if (!Array.isArray(scenario.choices) || scenario.choices.length !== baseline.courses.length) {
    return { ok: false, reason: 'invalid-choice', message: '比較課程與原規劃不一致，請重新開始。' };
  }
  const knownIds = new Set(baseline.courses.map((course) => course.id));
  const choices = new Map<string, number | null>();
  for (const choice of scenario.choices) {
    if (!choice || typeof choice !== 'object' || !knownIds.has(choice.courseId) ||
      choices.has(choice.courseId) || (choice.term !== null &&
      (!Number.isInteger(choice.term) || choice.term < 1 || choice.term > 8))) {
      return { ok: false, reason: 'invalid-choice', message: '比較學期須介於第 1 至第 8 學期，且每門課只能出現一次。' };
    }
    choices.set(choice.courseId, choice.term);
  }
  const before = creditPlanSummary(baseline);
  const omitted: CreditPlan['courses'] = [];
  const moved: CreditScenarioComparison['moved'] = [];
  const courses: CreditPlan['courses'] = [];
  for (const course of baseline.courses) {
    const term = choices.get(course.id);
    if (term === null) { omitted.push({ ...course }); continue; }
    if (term === undefined) return { ok: false, reason: 'invalid-choice', message: '缺少課程的比較安排。' };
    courses.push({ ...course, term });
    if (term !== course.term) moved.push({ id: course.id, name: course.name, from: course.term, to: term });
  }
  // 排除最後一學期的課，不應順便縮短使用者的規劃期間。
  const next: CreditPlan = {
    ...baseline,
    terms: Math.max(before.perTerm.length, ...courses.map((course) => course.term)),
    courses,
  };
  const after = creditPlanSummary(next);
  const terms = Array.from({ length: Math.max(before.perTerm.length, after.perTerm.length) }, (_, index) => {
    const from = before.perTerm[index]?.credits ?? 0;
    const to = after.perTerm[index]?.credits ?? 0;
    return { term: index + 1, before: from, after: to, delta: decimal(to - from) };
  });
  return {
    ok: true, plan: next, before, after,
    beforeInsights: analyzeCreditPlan(baseline), afterInsights: analyzeCreditPlan(next), omitted, moved, terms,
    categories: before.categoryGaps.map((category) => ({
      key: category.key, label: category.label, before: category.remaining,
      after: after.categoryGaps.find((item) => item.key === category.key)?.remaining ?? null,
    })),
    plannedDelta: decimal(after.courseCredits - before.courseCredits),
    remainingDelta: before.remaining === null || after.remaining === null ? null : decimal(after.remaining - before.remaining),
    changed: omitted.length > 0 || moved.length > 0,
  };
}

function decimal(value: number): number { return Number(value.toFixed(2)); }

export function creditScenarioTargetLabel(term: number | null, targetReady = true): string {
  if (!targetReady) return '目標尚未完整設定';
  return term === null ? '已排課程尚未達目標' : term === 0 ? '手填已確認學分已達目標' : `第 ${term} 學期`;
}

/** 課程名稱搜尋不影響整份方案的計算；原本資料也不會被重新排序。 */
export function filterCreditScenarioCourses(plan: CreditPlan, query: string, term: number | null) {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
  return plan.courses.filter((course) => (term === null || course.term === term) &&
    course.name.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(normalized))
    .sort((a, b) => a.term - b.term);
}
