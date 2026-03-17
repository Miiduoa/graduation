export type CreditCategory = "required" | "elective" | "general" | "english" | "other";

export type Department = {
  id: string;
  schoolId: string;
  name: string;
  programType: "university" | "junior_college"; // 大學 / 五專
};

export type GradRuleTemplate = {
  id: string;
  name: string;
  version: string;
  description?: string;
  categories: Array<{ key: CreditCategory; label: string }>;
  requirements: {
    totalCreditsRequired: number;
    minByCategory: Partial<Record<CreditCategory, number>>;
  };
  meta?: {
    // for future expansion
    notes?: string;
  };
};

export type GradRule = {
  id: string;
  departmentId: string;
  templateId: string;
  name: string;
  // override numbers from template
  override?: {
    totalCreditsRequired?: number;
    minByCategory?: Partial<Record<CreditCategory, number>>;
  };
};

export type Course = {
  id: string;
  departmentId: string;
  code?: string;
  name: string;
  credits: number;
  category: CreditCategory;
};

export type Enrollment = {
  id: string;
  uid: string;
  courseId: string;
  term?: string; // e.g. 2025-1
  status: "planned" | "enrolled" | "completed";
  // Pass/fail logic:
  passed?: boolean;
  grade?: number; // 0-100
};

export type CreditAuditResult = {
  total: { earned: number; required: number; remaining: number };
  byCategory: Record<CreditCategory, { earned: number; required: number; remaining: number }>;
  satisfied: boolean;
  missingCourseIds: string[];
};

export function calculateCredits(input: {
  template: GradRuleTemplate;
  rule?: GradRule;
  coursesById: Record<string, Course>;
  enrollments: Enrollment[];
  passingGrade?: number; // default 60
}): CreditAuditResult {
  const passingGrade = input.passingGrade ?? 60;

  const rawTotal = input.rule?.override?.totalCreditsRequired ?? input.template.requirements.totalCreditsRequired;
  const requiredTotal = Number.isFinite(Number(rawTotal)) && Number(rawTotal) >= 0 ? Number(rawTotal) : 0;

  const requiredByCategory: Partial<Record<CreditCategory, number>> = {};
  const mergeSource = [
    input.template.requirements.minByCategory,
    input.rule?.override?.minByCategory,
  ].filter(Boolean) as Partial<Record<CreditCategory, number>>[];
  for (const src of mergeSource) {
    for (const k of Object.keys(src) as CreditCategory[]) {
      const v = Number(src[k]);
      if (Number.isFinite(v) && v >= 0) requiredByCategory[k] = v;
    }
  }

  const earnedByCategory: Record<CreditCategory, number> = {
    required: 0,
    elective: 0,
    general: 0,
    english: 0,
    other: 0,
  };

  const missingCourseIds: string[] = [];

  const validCategories: CreditCategory[] = ["required", "elective", "general", "english", "other"];

  for (const e of input.enrollments) {
    if (e.status !== "completed") continue;

    const course = input.coursesById[e.courseId];
    if (!course) {
      missingCourseIds.push(e.courseId);
      continue;
    }

    const passed = e.passed ?? (typeof e.grade === "number" ? e.grade >= passingGrade : true);
    if (!passed) continue;

    const cred = Number(course.credits);
    const creditsToAdd = Number.isFinite(cred) && cred >= 0 ? cred : 0;
    const category = validCategories.includes(course.category as CreditCategory) ? (course.category as CreditCategory) : "other";
    earnedByCategory[category] += creditsToAdd;
  }

  const totalEarned = Object.values(earnedByCategory).reduce((a, b) => a + b, 0);

  const byCategory: CreditAuditResult["byCategory"] = {
    required: { earned: earnedByCategory.required, required: requiredByCategory.required ?? 0, remaining: 0 },
    elective: { earned: earnedByCategory.elective, required: requiredByCategory.elective ?? 0, remaining: 0 },
    general: { earned: earnedByCategory.general, required: requiredByCategory.general ?? 0, remaining: 0 },
    english: { earned: earnedByCategory.english, required: requiredByCategory.english ?? 0, remaining: 0 },
    other: { earned: earnedByCategory.other, required: requiredByCategory.other ?? 0, remaining: 0 },
  };

  (Object.keys(byCategory) as CreditCategory[]).forEach((k) => {
    byCategory[k].remaining = Math.max(0, byCategory[k].required - byCategory[k].earned);
  });

  const remainingTotal = Math.max(0, requiredTotal - totalEarned);
  const satisfiedByCategory = (Object.keys(requiredByCategory) as CreditCategory[]).every((k) => {
    const req = requiredByCategory[k] ?? 0;
    return earnedByCategory[k] >= req;
  });

  const satisfied = totalEarned >= requiredTotal && satisfiedByCategory;

  return {
    total: { earned: totalEarned, required: requiredTotal, remaining: remainingTotal },
    byCategory,
    satisfied,
    missingCourseIds: Array.from(new Set(missingCourseIds)),
  };
}
