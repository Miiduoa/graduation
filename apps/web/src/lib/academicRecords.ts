export class AcademicRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcademicRecordError';
  }
}

export interface AcademicCourse {
  id: string;
  semester: string | null;
  code: string;
  name: string;
  nameEn: string;
  classOffered: string;
  courseType: string;
  credits: number;
  dayOfWeek: number | null;
  periods: number[];
  startTime: string | null;
  endTime: string | null;
  location: string;
  timePlaceRaw: string;
  teacherName: string;
  teacherEmail: string;
  scheduleWarning: string | null;
}

export interface AcademicCourseResponse {
  courses: AcademicCourse[];
  semester: string | null;
  /** Sum of the listed course credits, not earned or graduation credits. */
  totalCredits: number;
  sourceTotalCredits: number | null;
  studentInfo: { class: string | null; studentId: string | null; name: string | null };
}

export interface AcademicGrade {
  id: string;
  semester: string;
  courseName: string;
  courseNameEn: string;
  class: string;
  courseType: string;
  credits: number;
  score: number | string;
}

export interface AcademicSemesterSummary {
  semesterAverage?: number | string;
  behaviorScore?: number | string;
  classRanking?: number | string;
  departmentRanking?: number | string;
}

export interface AcademicGradeResponse {
  grades: AcademicGrade[];
  semesters: string[];
  allSemesters: string[];
  /** Values reported by the school, separate from the locally calculated average. */
  summary: Record<string, AcademicSemesterSummary>;
}

export interface GradeSummary {
  courseCount: number;
  totalCredits: number;
  numericGradeCount: number;
  numericCredits: number;
  weightedAverage: number | null;
}

export interface ScheduleConflict {
  first: AcademicCourse;
  second: AcademicCourse;
  dayOfWeek: number;
  overlappingPeriods: number[];
  timeOverlap: { startTime: string; endTime: string } | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcademicRecordError(`${label}格式不正確，請重新讀取。`);
  }
  return value as Record<string, unknown>;
}

function successfulResponse(input: unknown): Record<string, unknown> {
  const response = record(input, '校務資料');
  if (response.success !== true || (typeof response.error === 'string' && response.error.trim())) {
    throw new AcademicRecordError(
      typeof response.error === 'string' && response.error.trim()
        ? response.error.trim()
        : '校務資料讀取未完成，請重新讀取。',
    );
  }
  return response;
}

function text(value: unknown, label: string, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new AcademicRecordError(`${label}格式不正確，請重新讀取。`);
  }
  return value.trim();
}

function semesterCode(value: unknown): string | null {
  return text(value, '學期') || null;
}

function credits(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AcademicRecordError('學分格式不正確，請重新讀取。');
  }
  return value;
}

function gradeValue(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new AcademicRecordError('成績格式不正確，請重新讀取。');
}

function clockMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function courseSchedule(row: Record<string, unknown>) {
  const day = row.dayOfWeek;
  const dayOfWeek =
    typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7 ? day : null;
  const rawPeriods = row.periods;
  const validPeriods =
    Array.isArray(rawPeriods) &&
    rawPeriods.every(
      (period) => typeof period === 'number' && Number.isInteger(period) && period > 0,
    );
  // A partial list could hide a conflict, so retain the raw description instead.
  const periods = validPeriods ? [...new Set(rawPeriods as number[])].sort((a, b) => a - b) : [];
  const start = clockMinutes(row.startTime);
  const end = clockMinutes(row.endTime);
  const validTime = start !== null && end !== null && start < end;
  const hasTimeInput = row.startTime != null || row.endTime != null;
  const hasSchedule = dayOfWeek !== null && (periods.length > 0 || validTime);
  const malformedPeriods = rawPeriods != null && !validPeriods;
  const scheduleWarning =
    !hasSchedule || malformedPeriods || (hasTimeInput && !validTime)
      ? '上課時間尚未完整辨識，請以原始課表為準；衝堂檢查可能不完整。'
      : null;
  return {
    dayOfWeek,
    periods,
    startTime: validTime ? (row.startTime as string) : null,
    endTime: validTime ? (row.endTime as string) : null,
    scheduleWarning,
  };
}

export function normalizeCourseRecords(input: unknown): AcademicCourseResponse {
  const response = successfulResponse(input);
  if (!Array.isArray(response.courses))
    throw new AcademicRecordError('課表資料格式不正確，請重新讀取。');
  const semester = semesterCode(response.semester);
  const seen = new Set<string>();
  const courses: AcademicCourse[] = [];
  for (const item of response.courses) {
    const row = record(item, '課程');
    const course = {
      semester,
      code: text(row.code, '課程代碼', true),
      name: text(row.name, '課程名稱', true),
      nameEn: text(row.nameEn, '英文課程名稱'),
      classOffered: text(row.classOffered, '開課班級'),
      courseType: text(row.courseType, '課程類別'),
      credits: credits(row.credits),
      ...courseSchedule(row),
      location: text(row.location, '教室'),
      timePlaceRaw: text(row.timePlaceRaw, '原始上課時間'),
      teacherName: text(row.teacherName, '教師姓名'),
      teacherEmail: text(row.teacherEmail, '教師聯絡資訊'),
    };
    const key = JSON.stringify(course);
    if (seen.has(key)) continue;
    seen.add(key);
    courses.push({ id: `course:${key}`, ...course });
  }
  const student = response.studentInfo == null ? {} : record(response.studentInfo, '學生資料');
  return {
    courses,
    semester,
    totalCredits: courses.reduce((sum, course) => sum + course.credits, 0),
    sourceTotalCredits: response.totalCredits == null ? null : credits(response.totalCredits),
    studentInfo: {
      class: text(student.class, '班級') || null,
      studentId: text(student.studentId, '學號') || null,
      name: text(student.name, '姓名') || null,
    },
  };
}

export function normalizeGradeRecords(input: unknown): AcademicGradeResponse {
  const response = successfulResponse(input);
  if (!Array.isArray(response.grades) || !Array.isArray(response.allSemesters)) {
    throw new AcademicRecordError('歷年成績格式不正確，請重新讀取。');
  }
  const semesters = [...new Set(response.allSemesters.map((value) => text(value, '學期', true)))];
  const seen = new Set<string>();
  const grades: AcademicGrade[] = [];
  for (const item of response.grades) {
    const row = record(item, '成績');
    const grade = {
      semester: text(row.semester, '成績學期', true),
      courseName: text(row.courseName, '科目名稱', true),
      courseNameEn: text(row.courseNameEn, '英文科目名稱'),
      class: text(row.class, '班級'),
      courseType: text(row.courseType, '課程類別'),
      credits: credits(row.credits),
      score: gradeValue(row.score),
    };
    if (!semesters.includes(grade.semester)) semesters.push(grade.semester);
    const key = JSON.stringify(grade);
    if (seen.has(key)) continue;
    seen.add(key);
    grades.push({ id: `grade:${key}`, ...grade });
  }
  const sourceSummary = response.summary == null ? {} : record(response.summary, '學期摘要');
  const summary: Record<string, AcademicSemesterSummary> = {};
  for (const [code, value] of Object.entries(sourceSummary)) {
    const source = record(value, '學期摘要');
    const entry: AcademicSemesterSummary = {};
    for (const key of [
      'semesterAverage',
      'behaviorScore',
      'classRanking',
      'departmentRanking',
    ] as const) {
      if (source[key] !== undefined) entry[key] = gradeValue(source[key]);
    }
    Object.defineProperty(summary, text(code, '學期', true), {
      value: entry,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { grades, semesters, allSemesters: [...semesters], summary };
}

export const normalizeCourseResponse = normalizeCourseRecords;
export const normalizeGradeResponse = normalizeGradeRecords;

export function calculateGradeSummary(grades: readonly AcademicGrade[]): GradeSummary {
  let totalCredits = 0;
  let numericGradeCount = 0;
  let numericCredits = 0;
  let weightedTotal = 0;
  for (const grade of grades) {
    const weight = credits(grade.credits);
    const score = gradeValue(grade.score);
    totalCredits += weight;
    if (typeof score !== 'number') continue;
    numericGradeCount += 1;
    numericCredits += weight;
    weightedTotal += score * weight;
  }
  return {
    courseCount: grades.length,
    totalCredits,
    numericGradeCount,
    numericCredits,
    weightedAverage: numericCredits > 0 ? weightedTotal / numericCredits : null,
  };
}

export function formatSemester(code: string | null | undefined): string {
  if (!code?.trim()) return '學期未提供';
  const value = code.trim();
  const match = /^(\d{2,3})([12])$/.exec(value);
  return match ? `${match[1]} 學年度第 ${match[2]} 學期` : value;
}

export function findScheduleConflicts(courses: readonly AcademicCourse[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < courses.length; i += 1) {
    const first = courses[i];
    if (first.dayOfWeek === null) continue;
    for (let j = i + 1; j < courses.length; j += 1) {
      const second = courses[j];
      if (first.id === second.id || first.dayOfWeek !== second.dayOfWeek) continue;
      if (first.semester !== second.semester) continue;
      const overlappingPeriods = first.periods.filter((period) => second.periods.includes(period));
      const bothHavePeriods = first.periods.length > 0 && second.periods.length > 0;
      let timeOverlap: ScheduleConflict['timeOverlap'] = null;
      // Exact periods take precedence over their outer time range (e.g. periods 1 and 3).
      if (!bothHavePeriods) {
        const startA = clockMinutes(first.startTime);
        const startB = clockMinutes(second.startTime);
        const endA = clockMinutes(first.endTime);
        const endB = clockMinutes(second.endTime);
        if (
          startA !== null &&
          startB !== null &&
          endA !== null &&
          endB !== null &&
          startA < endA &&
          startB < endB &&
          Math.max(startA, startB) < Math.min(endA, endB)
        ) {
          timeOverlap = {
            startTime: startA >= startB ? first.startTime! : second.startTime!,
            endTime: endA <= endB ? first.endTime! : second.endTime!,
          };
        }
      }
      if (overlappingPeriods.length > 0 || timeOverlap) {
        conflicts.push({
          first,
          second,
          dayOfWeek: first.dayOfWeek,
          overlappingPeriods,
          timeOverlap,
        });
      }
    }
  }
  return conflicts;
}
