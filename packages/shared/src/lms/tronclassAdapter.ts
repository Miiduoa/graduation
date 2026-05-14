/**
 * TronClass Adapter — 把 TronClass 原始 API 回應 normalize 成我們 APP 的標準型。
 *
 * 上層（mobile/web/AI）永遠只認我們的型，不直接看 TronClass payload；
 * 這層出 bug 才不會把資料來源綁死，未來換 Moodle / Canvas 也是改這一層。
 *
 * 純函式，無 I/O，可同時在 mobile / cloud function 跑。
 */

// ── 結構性型別（避免從 apps/mobile 反向依賴；與 apps/mobile/src/data/types 對齊）──
export interface CourseSpace {
  id: string;
  groupId: string;
  courseId?: string;
  name: string;
  description?: string;
  role?: string;
  unreadCount: number;
  assignmentCount: number;
  dueSoonCount: number;
  quizCount: number;
  moduleCount: number;
  activeSessionId: string | null;
  latestDueAt: Date | null;
  memberCount?: number;
  schoolId?: string;
}
export interface CourseModule {
  id: string;
  courseSpaceId: string;
  title: string;
  order: number;
  visible: boolean;
  materialCount: number;
  progress: number;
}
export interface CourseMaterial {
  id: string;
  moduleId: string;
  title: string;
  type: 'pdf' | 'video' | 'link' | 'doc' | 'audio';
  url?: string;
  durationSeconds?: number;
  progress: number;
}
export interface Quiz {
  id: string;
  assignmentId: string;
  groupId: string;
  groupName: string;
  title: string;
  description?: string;
  dueAt: Date | null;
  type: 'quiz' | 'exam';
  gradesPublished?: boolean;
  questionCount?: number;
  durationMinutes?: number;
  points?: number;
  weight?: number;
  source: 'quiz' | 'assignment';
}
export interface AttendanceSession {
  id: string;
  groupId: string;
  groupName: string;
  active: boolean;
  attendeeCount?: number;
  startedAt: Date | null;
  endedAt: Date | null;
  source: 'attendance' | 'live';
  attendanceMode?: string | null;
}
export interface AttendanceRecord {
  id: string;
  sessionId: string;
  groupId: string;
  userId: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  source?: 'qr' | 'tap' | 'manual';
  checkedInAt?: Date | null;
}
export interface CourseGradebookData {
  groupName: string;
  finalScoresPublished: boolean;
  finalScoresPublishedAt: Date | null;
  assignments: Array<{
    id: string;
    title: string;
    weight: number;
    dueAt: Date | null;
    gradesPublished: boolean;
    averageScore: number | null;
  }>;
  rows: Array<{
    uid: string;
    displayName: string;
    email?: string | null;
    studentId?: string | null;
    department?: string | null;
    finalScore: number | null;
    passingScore: number;
    result: string;
    published: boolean;
    publishedAt: Date | null;
    gradedAssignments: number;
    totalAssignments: number;
    assignmentBreakdown: Array<{
      assignmentId: string;
      title: string;
      weight: number;
      dueAt: Date | null;
      grade: number | null;
      isLate: boolean;
      feedback?: string | null;
      submittedAt: Date | null;
    }>;
  }>;
}

// ─────────────────────────────────────────────────────────
// TronClass 原始型（依官方 API/HTML schema 整理；部分欄位是猜測，會在實際對接時微調）
// ─────────────────────────────────────────────────────────

export interface TronClassRawCourse {
  id: string | number;
  course_code?: string;
  name: string;
  description?: string;
  semester?: string;
  /** 'teacher' | 'student' | 'assistant' */
  membership_role?: string;
  student_count?: number;
  unread_count?: number;
  module_count?: number;
  homework_count?: number;
  exam_count?: number;
  /** ISO datetime of the latest deadline */
  latest_due_at?: string | null;
}

export interface TronClassRawModule {
  id: string | number;
  course_id: string | number;
  name: string;
  position?: number;
  is_visible?: boolean;
  activity_count?: number;
}

export interface TronClassRawMaterial {
  id: string | number;
  module_id: string | number;
  title: string;
  /** 'pdf' | 'video' | 'link' | 'doc' | 'audio' */
  type: string;
  url?: string;
  duration_seconds?: number;
  progress?: number; // 0-1 該生閱讀進度
}

export interface TronClassRawQuiz {
  id: string | number;
  course_id: string | number;
  title: string;
  description?: string;
  /** 'quiz' | 'exam' | 'homework' */
  category: string;
  due_at?: string | null;
  duration_minutes?: number;
  points?: number;
  weight?: number;
  question_count?: number;
  is_published?: boolean;
}

export interface TronClassRawAttendanceSession {
  id: string | number;
  course_id: string | number;
  started_at: string;
  ended_at?: string | null;
  active?: boolean;
  attendee_count?: number;
  total_count?: number;
  mode?: 'qr' | 'tap' | 'manual';
}

export interface TronClassRawAttendanceRecord {
  session_id: string | number;
  user_id: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  checked_in_at?: string | null;
  source?: string;
}

export interface TronClassRawGradeItem {
  course_id: string | number;
  id: string | number;
  title: string;
  weight: number;
  max_score?: number;
  due_at?: string | null;
  grades_published?: boolean;
  average_score?: number | null;
}

export interface TronClassRawGradebookEntry {
  course_id: string | number;
  user_id: string;
  display_name?: string;
  email?: string | null;
  student_id?: string | null;
  department?: string | null;
  final_score?: number | null;
  passing_score?: number;
  result?: string;
  published?: boolean;
  published_at?: string | null;
  /** 每個 grade_item 上的個人分數 */
  scores: Array<{
    grade_item_id: string | number;
    score: number | null;
    is_late?: boolean;
    feedback?: string | null;
    submitted_at?: string | null;
  }>;
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function id(v: string | number): string {
  return String(v);
}

function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────
// 主轉換
// ─────────────────────────────────────────────────────────

export function toCourseSpaceFromTronClass(raw: TronClassRawCourse, schoolId?: string): CourseSpace {
  return {
    id: `tc:${id(raw.id)}`,
    groupId: `tc:${id(raw.id)}`,
    courseId: raw.course_code ?? String(raw.id),
    name: raw.name,
    description: raw.description,
    role: raw.membership_role ?? 'student',
    unreadCount: raw.unread_count ?? 0,
    assignmentCount: raw.homework_count ?? 0,
    dueSoonCount: 0,
    quizCount: raw.exam_count ?? 0,
    moduleCount: raw.module_count ?? 0,
    activeSessionId: null,
    latestDueAt: parseDate(raw.latest_due_at),
    memberCount: raw.student_count,
    schoolId,
  };
}

export function toCourseModuleFromTronClass(raw: TronClassRawModule): CourseModule {
  return {
    id: `tc:m:${id(raw.id)}`,
    courseSpaceId: `tc:${id(raw.course_id)}`,
    title: raw.name,
    order: raw.position ?? 0,
    visible: raw.is_visible !== false,
    materialCount: raw.activity_count ?? 0,
    progress: 0,
  } as CourseModule;
}

export function toCourseMaterialFromTronClass(raw: TronClassRawMaterial): CourseMaterial {
  return {
    id: `tc:mat:${id(raw.id)}`,
    moduleId: `tc:m:${id(raw.module_id)}`,
    title: raw.title,
    type: normalizeMaterialType(raw.type),
    url: raw.url,
    durationSeconds: raw.duration_seconds,
    progress: typeof raw.progress === 'number' ? raw.progress : 0,
  } as CourseMaterial;
}

function normalizeMaterialType(t: string): CourseMaterial['type'] {
  const lower = String(t || '').toLowerCase();
  if (lower.includes('video')) return 'video';
  if (lower.includes('audio')) return 'audio';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('doc')) return 'doc';
  if (lower.includes('link')) return 'link';
  return 'doc';
}

export function toQuizFromTronClass(raw: TronClassRawQuiz, groupName: string): Quiz {
  return {
    id: `tc:q:${id(raw.id)}`,
    assignmentId: `tc:q:${id(raw.id)}`,
    groupId: `tc:${id(raw.course_id)}`,
    groupName,
    title: raw.title,
    description: raw.description,
    dueAt: parseDate(raw.due_at),
    type: raw.category === 'exam' ? 'exam' : 'quiz',
    gradesPublished: raw.is_published ?? false,
    questionCount: raw.question_count,
    durationMinutes: raw.duration_minutes,
    points: raw.points,
    weight: raw.weight,
    source: 'quiz',
  };
}

export function toAttendanceSessionFromTronClass(
  raw: TronClassRawAttendanceSession,
  groupName: string,
): AttendanceSession {
  return {
    id: `tc:s:${id(raw.id)}`,
    groupId: `tc:${id(raw.course_id)}`,
    groupName,
    active: raw.active ?? !raw.ended_at,
    attendeeCount: raw.attendee_count,
    startedAt: parseDate(raw.started_at),
    endedAt: parseDate(raw.ended_at),
    source: 'attendance',
    attendanceMode: raw.mode ?? null,
  };
}

export function toAttendanceRecordFromTronClass(
  raw: TronClassRawAttendanceRecord,
  courseId: string | number,
): AttendanceRecord {
  return {
    id: `tc:r:${id(raw.session_id)}:${raw.user_id}`,
    sessionId: `tc:s:${id(raw.session_id)}`,
    groupId: `tc:${id(courseId)}`,
    userId: raw.user_id,
    status: raw.status,
    source: raw.source === 'qr' || raw.source === 'tap' || raw.source === 'manual' ? raw.source : undefined,
    checkedInAt: parseDate(raw.checked_in_at),
  };
}

export function toCourseGradebookDataFromTronClass(
  items: TronClassRawGradeItem[],
  entries: TronClassRawGradebookEntry[],
  groupName: string,
): CourseGradebookData {
  const itemById = new Map(items.map((it) => [String(it.id), it]));
  return {
    groupName,
    finalScoresPublished: entries.every((e) => e.published === true),
    finalScoresPublishedAt:
      parseDate(entries.find((e) => e.published_at)?.published_at ?? undefined) ?? null,
    assignments: items.map((it) => ({
      id: String(it.id),
      title: it.title,
      weight: it.weight,
      dueAt: parseDate(it.due_at),
      gradesPublished: it.grades_published ?? false,
      averageScore: it.average_score ?? null,
    })),
    rows: entries.map((entry) => ({
      uid: entry.user_id,
      displayName: entry.display_name ?? entry.user_id,
      email: entry.email ?? null,
      studentId: entry.student_id ?? null,
      department: entry.department ?? null,
      finalScore: entry.final_score ?? null,
      passingScore: entry.passing_score ?? 60,
      result: entry.result ?? '',
      published: entry.published ?? false,
      publishedAt: parseDate(entry.published_at ?? undefined),
      gradedAssignments: entry.scores.filter((s) => s.score !== null && s.score !== undefined).length,
      totalAssignments: items.length,
      assignmentBreakdown: entry.scores.map((s) => {
        const it = itemById.get(String(s.grade_item_id));
        return {
          assignmentId: String(s.grade_item_id),
          title: it?.title ?? '',
          weight: it?.weight ?? 0,
          dueAt: parseDate(it?.due_at ?? undefined),
          grade: s.score,
          isLate: s.is_late ?? false,
          feedback: s.feedback ?? null,
          submittedAt: parseDate(s.submitted_at ?? undefined),
        };
      }),
    })),
  };
}

// ─────────────────────────────────────────────────────────
// 批次匯入結果（給後端 / AI 用）
// ─────────────────────────────────────────────────────────

export interface TronClassImportResult {
  courseSpaces: CourseSpace[];
  modules: CourseModule[];
  materials: CourseMaterial[];
  quizzes: Quiz[];
  attendanceSessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  gradebooks: CourseGradebookData[];
  sourceMeta: {
    provider: 'tronclass';
    fetchedAt: string;
    courseCount: number;
  };
}

export function buildImportResult(
  schoolId: string,
  payload: {
    courses: TronClassRawCourse[];
    modules: TronClassRawModule[];
    materials: TronClassRawMaterial[];
    quizzes: TronClassRawQuiz[];
    attendanceSessions: TronClassRawAttendanceSession[];
    attendanceRecords: TronClassRawAttendanceRecord[];
    gradeItems: TronClassRawGradeItem[];
    gradebookEntries: TronClassRawGradebookEntry[];
  },
): TronClassImportResult {
  const courseSpaces = payload.courses.map((c) => toCourseSpaceFromTronClass(c, schoolId));
  const courseNameById = new Map(courseSpaces.map((c) => [c.groupId, c.name]));
  const modules = payload.modules.map(toCourseModuleFromTronClass);
  const materials = payload.materials.map(toCourseMaterialFromTronClass);
  const quizzes = payload.quizzes.map((q) =>
    toQuizFromTronClass(q, courseNameById.get(`tc:${q.course_id}`) ?? ''),
  );
  const attendanceSessions = payload.attendanceSessions.map((s) =>
    toAttendanceSessionFromTronClass(s, courseNameById.get(`tc:${s.course_id}`) ?? ''),
  );
  const attendanceRecords = payload.attendanceRecords.map((r) =>
    toAttendanceRecordFromTronClass(r, r.session_id),
  );

  // gradebook 依 course_id 分組
  const itemsByCourse = new Map<string, TronClassRawGradeItem[]>();
  for (const it of payload.gradeItems) {
    const k = `tc:${it.course_id}`;
    itemsByCourse.set(k, [...(itemsByCourse.get(k) ?? []), it]);
  }
  const entriesByCourse = new Map<string, TronClassRawGradebookEntry[]>();
  for (const e of payload.gradebookEntries) {
    const k = `tc:${e.course_id}`;
    entriesByCourse.set(k, [...(entriesByCourse.get(k) ?? []), e]);
  }
  const gradebooks: CourseGradebookData[] = [];
  for (const cs of courseSpaces) {
    const its = itemsByCourse.get(cs.groupId) ?? [];
    const ens = entriesByCourse.get(cs.groupId) ?? [];
    if (its.length > 0 || ens.length > 0) {
      gradebooks.push(toCourseGradebookDataFromTronClass(its, ens, cs.name));
    }
  }

  return {
    courseSpaces,
    modules,
    materials,
    quizzes,
    attendanceSessions,
    attendanceRecords,
    gradebooks,
    sourceMeta: {
      provider: 'tronclass',
      fetchedAt: new Date().toISOString(),
      courseCount: courseSpaces.length,
    },
  };
}
