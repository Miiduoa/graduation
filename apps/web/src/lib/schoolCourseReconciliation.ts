/** 只對照兩個已驗證來源，不寫入選課，也不把 LMS 清單當成學分依據。 */
export type AcademicComparisonCourse = {
  code: string;
  name: string;
  semester: string | null;
  classOffered: string;
  courseType: string;
  credits: number;
  teacherName: string;
  timePlaceRaw: string;
  location: string;
  scheduleWarning: string | null;
};
export type AcademicComparisonSnapshot = {
  ownerUid: string;
  schoolId: string;
  fetchedAt: string;
  records: {
    semester: string | null;
    sourceTotalCredits: number | null;
    courses: readonly AcademicComparisonCourse[];
  };
};
export type LmsComparisonCourse = {
  id: number;
  code: string;
  name: string;
  semester: string | null;
};
export type LmsComparisonSnapshot = {
  ownerUid: string;
  schoolId: string;
  source: string;
  fetchedAt: string;
  status: string;
  courses: readonly LmsComparisonCourse[];
};
export type CourseMatchState = 'matched' | 'missing-key' | 'ambiguous' | 'credit-conflict' | 'not-in-list' | 'lms-unavailable';
export type ReconciledSchoolCourse = {
  key: string;
  code: string;
  name: string;
  semester: string | null;
  classOffered: string;
  courseType: string;
  credits: number | null;
  teachers: string[];
  schedule: string[];
  scheduleIncomplete: boolean;
  match: CourseMatchState;
  lms: { id: number; name: string; href: string } | null;
};
export type SchoolCourseComparison = {
  rows: ReconciledSchoolCourse[];
  unmatchedLms: readonly LmsComparisonCourse[];
  matchedCount: number;
  needsReviewCount: number;
  semester: string | null;
  sourceTotalCredits: number | null;
  academicFetchedAt: string;
  lmsFetchedAt: string | null;
  lmsAvailable: boolean;
};

function normalized(value: string): string {
  return value.normalize('NFKC').trim();
}

/** 僅轉換明確的民國學年／學期；不推測西元年份或 Fall 等文字的對應。 */
export function schoolSemesterKey(value: string | null): string | null {
  if (!value || !value.trim()) return null;
  const text = normalized(value);
  const compact = text.match(/^(\d{3})([12])$/);
  const separated = text.match(/^(\d{3})\s*[-／/]\s*([12])$/);
  const chinese = text.match(/^(\d{3})\s*學年度\s*第?\s*([12一二上下])\s*學期$/);
  const match = compact || separated || chinese;
  if (!match) return `raw:${text}`;
  const term = ['1', '一', '上'].includes(match[2]) ? '1' : '2';
  return `${match[1]}:${term}`;
}

function courseKey(code: string, semester: string | null): string | null {
  const normalizedCode = normalized(code).toUpperCase();
  const term = schoolSemesterKey(semester);
  return normalizedCode && term ? JSON.stringify([term, normalizedCode]) : null;
}

export function schoolCourseHref(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('課堂識別無法核對。');
  return `https://tronclass.pu.edu.tw/course/${id}/content`;
}

export function reconcileSchoolCourses(
  academic: AcademicComparisonSnapshot,
  lms: LmsComparisonSnapshot | null,
  scope: { uid: string; schoolId: string },
): SchoolCourseComparison {
  if (!scope.uid || scope.schoolId !== 'pu' || academic.ownerUid !== scope.uid ||
    academic.schoolId !== scope.schoolId || !Number.isFinite(Date.parse(academic.fetchedAt)) ||
    academic.records.courses.length > 1000 || (lms !== null && (
      lms.ownerUid !== scope.uid || lms.schoolId !== scope.schoolId || lms.source !== 'pu-tronclass' ||
      !['ongoing', 'completed', 'upcoming'].includes(lms.status) ||
      !Number.isFinite(Date.parse(lms.fetchedAt)) || lms.courses.length > 1000))) {
    throw new Error('資料來源與目前帳號或學校不一致，請重新讀取。');
  }
  const total = academic.records.sourceTotalCredits;
  if (total !== null && (!Number.isFinite(total) || total < 0)) {
    throw new Error('校方選課學分小計無法核對。');
  }
  const lmsByKey = new Map<string, LmsComparisonCourse[]>();
  const lmsIds = new Set<number>();
  for (const course of lms?.courses || []) {
    schoolCourseHref(course.id);
    if (lmsIds.has(course.id)) throw new Error('WOW Class 課堂識別重複，請重新讀取。');
    lmsIds.add(course.id);
    const key = courseKey(course.code, course.semester);
    if (key) lmsByKey.set(key, [...(lmsByKey.get(key) || []), course]);
  }

  // 同一門課的不同上課時段合併展示；不同班別或課名不擅自視為同一門。
  const groups = new Map<string, AcademicComparisonCourse[]>();
  for (const course of academic.records.courses) {
    if (!course.name.trim() || !Number.isFinite(course.credits) || course.credits < 0) {
      throw new Error('校方課程名稱或學分無法核對。');
    }
    const key = JSON.stringify([schoolSemesterKey(course.semester), normalized(course.code).toUpperCase(),
      normalized(course.name), normalized(course.classOffered), normalized(course.courseType)]);
    groups.set(key, [...(groups.get(key) || []), course]);
  }
  const academicKeyCounts = new Map<string, number>();
  for (const [first] of groups.values()) {
    const key = courseKey(first.code, first.semester);
    if (key) academicKeyCounts.set(key, (academicKeyCounts.get(key) || 0) + 1);
  }
  const matchedIds = new Set<number>();
  const rows: ReconciledSchoolCourse[] = [];
  for (const [key, entries] of groups) {
    const first = entries[0];
    const lookup = courseKey(first.code, first.semester);
    const candidates = lookup ? lmsByKey.get(lookup) || [] : [];
    const consistentCredits = entries.every((entry) => entry.credits === first.credits);
    const match: CourseMatchState = !consistentCredits ? 'credit-conflict'
      : lms === null ? 'lms-unavailable'
      : !lookup ? 'missing-key'
      : (academicKeyCounts.get(lookup) || 0) > 1 || candidates.length > 1 ? 'ambiguous'
      : candidates.length === 1 ? 'matched' : 'not-in-list';
    const selected = match === 'matched' ? candidates[0] : null;
    if (selected) matchedIds.add(selected.id);
    rows.push({
      key, code: first.code, name: first.name, semester: first.semester,
      classOffered: first.classOffered, courseType: first.courseType,
      credits: consistentCredits ? first.credits : null,
      teachers: [...new Set(entries.map((entry) => entry.teacherName.trim()).filter(Boolean))],
      schedule: [...new Set(entries.map((entry) => [entry.timePlaceRaw.trim(), entry.location.trim()]
        .filter(Boolean).join(' · ')).filter(Boolean))],
      scheduleIncomplete: entries.some((entry) => !!entry.scheduleWarning),
      match,
      lms: selected ? { id: selected.id, name: selected.name, href: schoolCourseHref(selected.id) } : null,
    });
  }
  return {
    rows,
    unmatchedLms: (lms?.courses || []).filter((course) => !matchedIds.has(course.id)),
    matchedCount: rows.filter((row) => row.match === 'matched').length,
    needsReviewCount: rows.filter((row) => row.match !== 'matched').length,
    semester: academic.records.semester,
    sourceTotalCredits: total,
    academicFetchedAt: academic.fetchedAt,
    lmsFetchedAt: lms?.fetchedAt ?? null,
    lmsAvailable: lms !== null,
  };
}
