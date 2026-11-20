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
    categoryKey: string;
    subCategoryKey?: string;
    passed: boolean;
  }>;
  nonCreditSatisfied?: Record<string, boolean>;
}): DetailedCreditAuditResult {
  const { template, courses, nonCreditSatisfied = {} } = input;
  const warnings: string[] = [];
  const categories = new Map(template.categories.map((category) => [category.key, category]));
  const rawEarned = new Map<string, number>();
  const rawSubEarned = new Map<string, Map<string, number>>();
  const seenCourses = new Set<string>();

  for (const course of courses) {
    if (course.passed !== true) continue;
    const category = categories.get(course.categoryKey);
    if (!category) {
      warnings.push(`「${course.name}」分類不在目前參考規則中，未列入試算。`);
      continue;
    }
    if (
      typeof course.credits !== 'number' ||
      !Number.isFinite(course.credits) ||
      course.credits <= 0 ||
      course.credits > 30
    ) {
      warnings.push(`「${course.name}」學分格式不正確，未列入試算。`);
      continue;
    }
    const sub = course.subCategoryKey
      ? category.subCategories?.find((item) => item.key === course.subCategoryKey)
      : undefined;
    if (course.subCategoryKey && !sub) {
      warnings.push(`「${course.name}」的細分類別與目前參考規則不符，未列入試算。`);
      continue;
    }
    const name = course.name.trim();
    if (!name) continue;
    const unique = JSON.stringify([category.key, name.toLocaleLowerCase('zh-TW')]);
    if (seenCourses.has(unique)) {
      warnings.push(`「${name}」有重複通過紀錄，已保守排除重複採計；請向系辦確認重修或重複修課規則。`);
      continue;
    }
    seenCourses.add(unique);
    rawEarned.set(category.key, (rawEarned.get(category.key) ?? 0) + course.credits);
    if (sub) {
      const subMap = rawSubEarned.get(category.key) ?? new Map<string, number>();
      subMap.set(sub.key, (subMap.get(sub.key) ?? 0) + course.credits);
      rawSubEarned.set(category.key, subMap);
    }
  }

  const byCategory: DetailedCreditAuditResult['byCategory'] = [];
  for (const category of template.categories) {
    let earned = rawEarned.get(category.key) ?? 0;
    const subCategories = category.subCategories?.map((sub) => {
      const raw = rawSubEarned.get(category.key)?.get(sub.key) ?? 0;
      const counted = sub.maxCredits == null ? raw : Math.min(raw, Math.max(0, sub.maxCredits));
      if (raw > counted) {
        const excess = raw - counted;
        earned -= excess;
        warnings.push(`「${sub.label}」已修 ${raw} 學分，超過可採計上限 ${sub.maxCredits} 學分，${excess} 學分不計。`);
      }
      return {
        key: sub.key,
        label: sub.label,
        earned: Number(counted.toFixed(2)),
        required: sub.minCredits,
        remaining: Number(Math.max(0, sub.minCredits - counted).toFixed(2)),
      };
    });

    const beforeCap = earned;
    if (category.maxCredits != null && earned > category.maxCredits) {
      earned = Math.max(0, category.maxCredits);
      warnings.push(
        `「${category.label}」已修 ${Number(beforeCap.toFixed(2))} 學分，超過可採計上限 ${category.maxCredits} 學分，超出部分不計。`,
      );
    }
    earned = Number(Math.max(0, earned).toFixed(2));
    byCategory.push({
      key: category.key,
      label: category.label,
      earned,
      required: category.minCredits,
      remaining: Number(Math.max(0, category.minCredits - earned).toFixed(2)),
      subCategories,
    });
  }

  const totalEarned = Number(byCategory.reduce((sum, category) => sum + category.earned, 0).toFixed(2));
  const totalRequired = template.totalCreditsRequired;
  const nonCreditStatus = template.nonCreditRequirements.map((requirement) => ({
    key: requirement.key,
    label: requirement.label,
    satisfied: nonCreditSatisfied[requirement.key] === true,
  }));
  // 這份結果是「對照規則試算」。實際能否畢業還要看必修課對應、重修免修與校方審查。
  const satisfied =
    totalEarned >= totalRequired &&
    byCategory.every((category) => category.earned >= category.required) &&
    byCategory.every((category) =>
      category.subCategories?.every((sub) => sub.earned >= sub.required) ?? true,
    ) &&
    nonCreditStatus.every((item) => item.satisfied);

  return {
    total: {
      earned: totalEarned,
      required: totalRequired,
      remaining: Number(Math.max(0, totalRequired - totalEarned).toFixed(2)),
    },
    byCategory,
    nonCreditStatus,
    satisfied,
    warnings,
  };
}
