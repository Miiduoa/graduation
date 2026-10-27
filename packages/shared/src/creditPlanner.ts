export const PLANNER_CATEGORIES = [
  { key: 'required', label: '必修' },
  { key: 'elective', label: '選修' },
  { key: 'general', label: '通識' },
  { key: 'other', label: '其他' },
] as const;

export type PlannerCategory = (typeof PLANNER_CATEGORIES)[number]['key'];
export type PlannerCourseStatus = 'considering' | 'registered';

export interface PlannedCourse {
  id: string;
  name: string;
  credits: number;
  term: number;
  category: PlannerCategory;
  status: PlannerCourseStatus;
}

export interface CreditPlan {
  version: 1;
  recognized: string;
  target: string;
  extra: string;
  terms: number;
  courses: PlannedCourse[];
  categoryGoals: Record<PlannerCategory, CreditCategoryGoal>;
  milestones: CreditMilestone[];
}

export const MAX_PLANNED_COURSES = 120;
export const MAX_MILESTONES = 24;

export interface CreditCategoryGoal {
  recognized: string;
  target: string;
}

export interface CreditMilestone {
  id: string;
  label: string;
  done: boolean;
}

function emptyCategoryGoals(): Record<PlannerCategory, CreditCategoryGoal> {
  return { required: { recognized: '', target: '' }, elective: { recognized: '', target: '' }, general: { recognized: '', target: '' }, other: { recognized: '', target: '' } };
}

export function emptyCreditPlan(): CreditPlan {
  return {
    version: 1,
    recognized: '',
    target: '',
    extra: '',
    terms: 4,
    courses: [],
    categoryGoals: emptyCategoryGoals(),
    milestones: [],
  };
}

/** 空白與零不同；不接受科學記號或過高精度的輸入。 */
export function parseCredits(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : null;
}

export function formatCredits(value: number): string {
  return String(Number(value.toFixed(2)));
}

function sumCredits(values: readonly number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(2));
}

export function creditPlanSummary(plan: CreditPlan) {
  const recognized = parseCredits(plan.recognized);
  const target = parseCredits(plan.target);
  const extra = plan.extra.trim() ? parseCredits(plan.extra) : 0;
  const candidate = sumCredits(
    plan.courses.filter((course) => course.status === 'considering').map((course) => course.credits),
  );
  const registered = sumCredits(
    plan.courses.filter((course) => course.status === 'registered').map((course) => course.credits),
  );
  const courseCredits = sumCredits([candidate, registered]);
  const planned = extra === null ? null : sumCredits([courseCredits, extra]);
  const projected = recognized === null || planned === null ? null : sumCredits([recognized, planned]);
  const missingBefore = recognized === null || target === null ? null : Math.max(0, target - recognized);
  const remaining =
    projected === null || target === null ? null : Number(Math.max(0, target - projected).toFixed(2));
  const progress =
    projected === null || target === null || target <= 0
      ? 0
      : Math.min(100, Math.round((projected / target) * 100));
  const termCount = Math.max(1, Math.min(8, plan.terms), ...plan.courses.map((c) => c.term));
  const perTerm = Array.from({ length: termCount }, (_, index) => {
    const term = index + 1;
    const courses = plan.courses.filter((course) => course.term === term);
    return { term, courses, credits: sumCredits(courses.map((course) => course.credits)) };
  });
  const byCategory = PLANNER_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    credits: sumCredits(plan.courses.filter((course) => course.category === key).map((c) => c.credits)),
  }));
  const categoryGaps = byCategory.map(({ key, label, credits }) => {
    const entry = plan.categoryGoals[key];
    const recognizedCategory = parseCredits(entry.recognized);
    const targetCategory = entry.target.trim() ? parseCredits(entry.target) : null;
    const estimated = recognizedCategory === null ? null : sumCredits([recognizedCategory, credits]);
    const remainingCategory = targetCategory === null || estimated === null ? null : Number(Math.max(0, targetCategory - estimated).toFixed(2));
    return { key, label, planned: credits, recognized: recognizedCategory, target: targetCategory, estimated, remaining: remainingCategory };
  });
  const categorizedRecognized = sumCredits(categoryGaps.map((c) => c.recognized ?? 0));
  const categoryOvercount = recognized !== null && categorizedRecognized > recognized;
  const milestonesComplete = plan.milestones.filter((milestone) => milestone.done).length;
  return {
    categoryGaps,
    categoryOvercount,
    milestonesComplete,
    recognized,
    target,
    extra,
    candidate,
    registered,
    courseCredits,
    planned,
    projected,
    missingBefore,
    remaining,
    progress,
    perTerm,
    byCategory,
  };
}

/** 本機資料格式不對就拒絕，不要露出或計算不可信的部分規劃。 */
export function restoreCreditPlan(raw: string | null): CreditPlan | null {
  if (!raw || raw.length > 90_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const plan = value as Partial<CreditPlan>;
    if (
      plan.version !== 1 ||
      typeof plan.recognized !== 'string' ||
      typeof plan.target !== 'string' ||
      typeof plan.extra !== 'string' ||
      !Number.isInteger(plan.terms) ||
      plan.terms! < 1 ||
      plan.terms! > 8 ||
      !Array.isArray(plan.courses) ||
      plan.courses.length > MAX_PLANNED_COURSES ||
      !plan.categoryGoals || typeof plan.categoryGoals !== 'object' ||
      !Array.isArray(plan.milestones) || plan.milestones.length > MAX_MILESTONES
    ) {
      return null;
    }
    if (
      [plan.recognized, plan.target, plan.extra].some(
        (item) => item.length > 12 || (item.trim() !== '' && parseCredits(item) === null),
      )
    ) {
      return null;
    }
    for (const { key } of PLANNER_CATEGORIES) {
      const entry = plan.categoryGoals?.[key];
      if (
        !entry || typeof entry.recognized !== 'string' || typeof entry.target !== 'string' ||
        [entry.recognized, entry.target].some((number) => number.length > 12 ||
          (number.trim() && parseCredits(number) === null))
      ) return null;
    }
    const milestoneIds = new Set<string>();
    for (const item of plan.milestones) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 ||
        milestoneIds.has(item.id) || typeof item.label !== 'string' ||
        !item.label.trim() || item.label.length > 80 || typeof item.done !== 'boolean') return null;
      milestoneIds.add(item.id);
    }
    const ids = new Set<string>();
    for (const course of plan.courses) {
      if (
        !course ||
        typeof course !== 'object' ||
        typeof course.id !== 'string' ||
        course.id.length > 100 ||
        !course.id ||
        ids.has(course.id) ||
        typeof course.name !== 'string' ||
        !course.name.trim() ||
        course.name.length > 80 ||
        typeof course.credits !== 'number' ||
        !Number.isFinite(course.credits) ||
        course.credits <= 0 ||
        course.credits > 30 ||
        Math.abs(Math.round(course.credits * 100) - course.credits * 100) > 1e-6 ||
        !Number.isInteger(course.term) ||
        course.term < 1 ||
        course.term > 8 ||
        !PLANNER_CATEGORIES.some((category) => category.key === course.category) ||
        (course.status !== 'considering' && course.status !== 'registered')
      ) {
        return null;
      }
      ids.add(course.id);
    }
    return plan as CreditPlan;
  } catch {
    return null;
  }
}

/** 帳號與校區不共用瀏覽器端草稿，也不存放成績資料。 */
export function creditPlanStorageKey(userId: string | null, schoolId: string | null): string {
  return 'campus:credit-planner:v1:' +
    encodeURIComponent(userId ?? 'guest') + ':' + encodeURIComponent(schoolId ?? 'personal');
}

function csvCell(value: string | number): string {
  const source = String(value);
  const safe = /^[\s]*[=+\-@]/.test(source) ? "'" + source : source;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function exportCreditPlanCsv(plan: CreditPlan): string {
  const rows: Array<Array<string | number>> = [
    ['學期', '課程', '學分', '類別', '狀態'],
    ...plan.courses.map((course) => [
      '未來第 ' + course.term + ' 學期',
      course.name,
      course.credits,
      PLANNER_CATEGORIES.find((category) => category.key === course.category)?.label ?? '其他',
      course.status === 'registered' ? '已選課（尚未取得）' : '候選課程',
    ]),
  ];
  rows.push(['', '已確認可採計學分（自行輸入）', plan.recognized, '', '']);
  rows.push(['', '希望累計的學分', plan.target, '', '']);
  rows.push(['', '其他預計再修學分（未列成課程）', plan.extra, '', '']);
  for (const { key, label } of PLANNER_CATEGORIES) {
    const entry = plan.categoryGoals[key];
    rows.push(['分類門檻', label + '已確認', entry.recognized, '', '']);
    rows.push(['分類門檻', label + '目標', entry.target, '', '']);
  }
  for (const milestone of plan.milestones) {
    rows.push(['非學分條件', milestone.label, '', '', milestone.done ? '自行勾選完成' : '尚未完成']);
  }
  rows.push(['', '說明', '', '', '個人規劃，不代表學校正式審查或保證通過']);
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
