// ---------------------------------------------------------------------------
// Legacy simple categories (kept for backward compat)
// ---------------------------------------------------------------------------
export type CreditCategory = 'required' | 'elective' | 'general' | 'english' | 'other';

export type Department = {
  id: string;
  schoolId: string;
  name: string;
  college?: string; // 所屬學院
  programType: 'university' | 'junior_college'; // 大學 / 五專
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
    notes?: string;
  };
};

export type GradRule = {
  id: string;
  departmentId: string;
  templateId: string;
  name: string;
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
  /** Maps to DetailedCreditCategory.key + sub key for detailed audit */
  detailedCategoryKey?: string;
  detailedSubKey?: string;
};

export type Enrollment = {
  id: string;
  uid: string;
  courseId: string;
  term?: string; // e.g. 2025-1
  status: 'planned' | 'enrolled' | 'completed';
  passed?: boolean;
  grade?: number; // 0-100
};

export type CreditAuditResult = {
  total: { earned: number; required: number; remaining: number };
  byCategory: Record<CreditCategory, { earned: number; required: number; remaining: number }>;
  satisfied: boolean;
  missingCourseIds: string[];
};

// ---------------------------------------------------------------------------
// Detailed graduation rules — mirrors E校園 課程架構圖
// ---------------------------------------------------------------------------

/** A single course in the official curriculum */
export type CourseRequirement = {
  code?: string;
  name: string;
  credits: number;
  required: boolean; // true = 必修, false = 選修
  suggestedYear?: number; // 建議修課年級 1-4
  suggestedSemester?: 1 | 2; // 建議修課學期
  notes?: string;
};

/** Sub-category within a main category (e.g. 通識-永續與在地) */
export type CreditSubCategory = {
  key: string;
  label: string;
  minCredits: number;
  maxCredits?: number; // cap (e.g. 外系 max 20)
  courses?: CourseRequirement[];
  notes?: string;
};

/** Top-level category in the graduation structure */
export type DetailedCreditCategory = {
  key: string; // e.g. "university_core", "college_required"
  label: string; // e.g. "校訂課程", "院共同必修"
  minCredits: number; // minimum total for this category
  maxCredits?: number;
  color?: string; // for UI display
  subCategories?: CreditSubCategory[];
  courses?: CourseRequirement[];
  notes?: string;
};

/** Non-credit graduation condition (e.g. 英文能力檢定) */
export type NonCreditRequirement = {
  key: string;
  label: string;
  type: 'certification' | 'course_substitute' | 'service' | 'other';
  description: string;
  alternatives?: string[]; // 替代方案
};

/** Complete detailed graduation template for a department+year */
export type DetailedGradTemplate = {
  id: string;
  schoolId: string;
  schoolName: string;
  departmentId: string;
  departmentName: string;
  college?: string; // 學院
  academicYear: string; // 入學學年度 e.g. "115"
  programType: 'university' | 'junior_college';
  division?: string; // 組別 (不分組 / A組 / B組)
  studentType?: string; // 一般生 / 轉學生
  totalCreditsRequired: number;
  categories: DetailedCreditCategory[];
  nonCreditRequirements: NonCreditRequirement[];
  otherRules?: string[]; // 其他附註 (e.g. 外系學分上限)
};

/** Result of a detailed credit audit */
export type DetailedCreditAuditResult = {
  total: { earned: number; required: number; remaining: number };
  byCategory: Array<{
    key: string;
    label: string;
    earned: number;
    required: number;
    remaining: number;
    subCategories?: Array<{
      key: string;
      label: string;
      earned: number;
      required: number;
      remaining: number;
    }>;
  }>;
  nonCreditStatus: Array<{
    key: string;
    label: string;
    satisfied: boolean;
  }>;
  satisfied: boolean;
  warnings: string[];
};

export function calculateCredits(input: {
  template: GradRuleTemplate;
  rule?: GradRule;
  coursesById: Record<string, Course>;
  enrollments: Enrollment[];
  passingGrade?: number; // default 60
}): CreditAuditResult {
  const passingGrade = input.passingGrade ?? 60;

  const rawTotal =
    input.rule?.override?.totalCreditsRequired ?? input.template.requirements.totalCreditsRequired;
  const requiredTotal =
    Number.isFinite(Number(rawTotal)) && Number(rawTotal) >= 0 ? Number(rawTotal) : 0;

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

  const validCategories: CreditCategory[] = ['required', 'elective', 'general', 'english', 'other'];

  for (const e of input.enrollments) {
    if (e.status !== 'completed') continue;

    const course = input.coursesById[e.courseId];
    if (!course) {
      missingCourseIds.push(e.courseId);
      continue;
    }

    const passed = e.passed ?? (typeof e.grade === 'number' ? e.grade >= passingGrade : true);
    if (!passed) continue;

    const cred = Number(course.credits);
    const creditsToAdd = Number.isFinite(cred) && cred >= 0 ? cred : 0;
    const category = validCategories.includes(course.category as CreditCategory)
      ? (course.category as CreditCategory)
      : 'other';
    earnedByCategory[category] += creditsToAdd;
  }

  const totalEarned = Object.values(earnedByCategory).reduce((a, b) => a + b, 0);

  const byCategory: CreditAuditResult['byCategory'] = {
    required: {
      earned: earnedByCategory.required,
      required: requiredByCategory.required ?? 0,
      remaining: 0,
    },
    elective: {
      earned: earnedByCategory.elective,
      required: requiredByCategory.elective ?? 0,
      remaining: 0,
    },
    general: {
      earned: earnedByCategory.general,
      required: requiredByCategory.general ?? 0,
      remaining: 0,
    },
    english: {
      earned: earnedByCategory.english,
      required: requiredByCategory.english ?? 0,
      remaining: 0,
    },
    other: {
      earned: earnedByCategory.other,
      required: requiredByCategory.other ?? 0,
      remaining: 0,
    },
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

// ---------------------------------------------------------------------------
// Detailed credit audit — uses DetailedGradTemplate
// ---------------------------------------------------------------------------

export function calculateDetailedCredits(input: {
  template: DetailedGradTemplate;
  courses: Array<{
    name: string;
    credits: number;
    categoryKey: string; // matches DetailedCreditCategory.key
    subCategoryKey?: string; // matches CreditSubCategory.key
    passed: boolean;
  }>;
  nonCreditSatisfied?: Record<string, boolean>;
}): DetailedCreditAuditResult {
  const { template, courses, nonCreditSatisfied = {} } = input;
  const warnings: string[] = [];

  // Tally earned credits per category & sub-category
  const earnedMap: Record<string, number> = {};
  const subEarnedMap: Record<string, Record<string, number>> = {};

  for (const c of courses) {
    if (!c.passed) continue;
    const cred = Number(c.credits);
    if (!Number.isFinite(cred) || cred < 0) continue;

    earnedMap[c.categoryKey] = (earnedMap[c.categoryKey] ?? 0) + cred;

    if (c.subCategoryKey) {
      if (!subEarnedMap[c.categoryKey]) subEarnedMap[c.categoryKey] = {};
      subEarnedMap[c.categoryKey][c.subCategoryKey] =
        (subEarnedMap[c.categoryKey]?.[c.subCategoryKey] ?? 0) + cred;
    }
  }

  // Apply maxCredits caps (e.g. 外系上限 20)
  for (const cat of template.categories) {
    if (cat.maxCredits != null && (earnedMap[cat.key] ?? 0) > cat.maxCredits) {
      const excess = (earnedMap[cat.key] ?? 0) - cat.maxCredits;
      warnings.push(
        `「${cat.label}」已修 ${earnedMap[cat.key]} 學分，超過上限 ${cat.maxCredits} 學分，超出 ${excess} 學分不計入畢業學分`,
      );
      earnedMap[cat.key] = cat.maxCredits;
    }
    for (const sub of cat.subCategories ?? []) {
      if (sub.maxCredits != null) {
        const subEarned = subEarnedMap[cat.key]?.[sub.key] ?? 0;
        if (subEarned > sub.maxCredits) {
          subEarnedMap[cat.key]![sub.key] = sub.maxCredits;
        }
      }
    }
  }

  // Build per-category results
  const byCategory: DetailedCreditAuditResult['byCategory'] = template.categories.map((cat) => {
    const earned = earnedMap[cat.key] ?? 0;
    const required = cat.minCredits;
    return {
      key: cat.key,
      label: cat.label,
      earned,
      required,
      remaining: Math.max(0, required - earned),
      subCategories: cat.subCategories?.map((sub) => {
        const subEarned = subEarnedMap[cat.key]?.[sub.key] ?? 0;
        return {
          key: sub.key,
          label: sub.label,
          earned: subEarned,
          required: sub.minCredits,
          remaining: Math.max(0, sub.minCredits - subEarned),
        };
      }),
    };
  });

  // Total
  const totalEarned = Object.values(earnedMap).reduce((a, b) => a + b, 0);
  const totalRequired = template.totalCreditsRequired;

  // Non-credit requirements
  const nonCreditStatus = template.nonCreditRequirements.map((req) => ({
    key: req.key,
    label: req.label,
    satisfied: nonCreditSatisfied[req.key] ?? false,
  }));

  // Overall satisfaction
  const creditsSatisfied =
    totalEarned >= totalRequired &&
    byCategory.every((cat) => cat.earned >= cat.required) &&
    byCategory.every(
      (cat) => !cat.subCategories || cat.subCategories.every((sub) => sub.earned >= sub.required),
    );
  const allNonCreditSatisfied = nonCreditStatus.every((n) => n.satisfied);
  const satisfied = creditsSatisfied && allNonCreditSatisfied;

  return {
    total: {
      earned: totalEarned,
      required: totalRequired,
      remaining: Math.max(0, totalRequired - totalEarned),
    },
    byCategory,
    nonCreditStatus,
    satisfied,
    warnings,
  };
}
