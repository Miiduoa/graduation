/**
 * Supabase LMS Adapter — 把 Supabase row 轉成 packages/shared/lms 的標準型
 * ───────────────────────────────────────────────────────────
 * 與 tronclassAdapter.ts 對偶。共用引擎(gradePredictor、studyPlanner、
 * quizScoring、attendanceEngine 等)永遠只認標準型,所以無論資料源是
 * TronClass 還是 Supabase,引擎程式碼都不需要改。
 *
 * 純函式,無 I/O。
 */

import type {
  CourseSpace,
  CourseModule,
  CourseMaterial,
  Quiz,
  AttendanceSession,
  AttendanceRecord,
  CourseGradebookData,
} from './tronclassAdapter';

// ─── Supabase row shapes (與 supabase/migrations 的 schema 對齊) ───

export interface SupabaseCourseRow {
  id: string | number;
  name: string;
  code?: string | null;
  description?: string | null;
  term?: string | null;
  start_at?: string | null;
  end_at?: string | null;
}

export interface SupabaseCourseUnitRow {
  id: string | number;
  course_id: string | number;
  title: string;
  position?: number | null;
  is_visible?: boolean | null;
}

export interface SupabaseCourseMaterialRow {
  id: string | number;
  course_id: string | number;
  unit_id?: string | number | null;
  title: string;
  url?: string | null;
  kind?: string | null;
  size_bytes?: number | null;
}

export interface SupabaseQuizRow {
  id: string | number;
  course_id: string | number;
  title: string;
  description?: string | null;
  due_at?: string | null;
  total_score?: number | null;
  status?: string | null;
}

export interface SupabaseLiveSessionRow {
  id: string | number;
  course_id: string | number;
  title?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  attendance_window_start?: string | null;
  attendance_window_end?: string | null;
}

export interface SupabaseLiveAttendanceRow {
  id: string | number;
  session_id: string | number;
  user_id: string;
  status?: string | null;
  checked_in_at?: string | null;
}

export interface SupabaseGradeRollupRow {
  id: string | number;
  course_id: string | number;
  user_id: string;
  item_name: string;
  score?: number | null;
  max_score?: number | null;
  weight?: number | null;
  category?: string | null;
}

// ─── Conversion helpers ───

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const t = new Date(asString(v));
  return Number.isFinite(t.getTime()) ? t : null;
}

// ─── courses → CourseSpace ───
export function toCourseSpaceFromSupabase(
  row: SupabaseCourseRow,
  opts: {
    schoolId?: string;
    role?: string;
    memberCount?: number;
    assignmentCount?: number;
    dueSoonCount?: number;
    quizCount?: number;
    moduleCount?: number;
    unreadCount?: number;
    latestDueAt?: Date | null;
    activeSessionId?: string | null;
  } = {},
): CourseSpace {
  return {
    id: asString(row.id),
    groupId: asString(row.id),
    courseId: asString(row.code || row.id),
    name: row.name || '',
    description: row.description || '',
    role: opts.role,
    unreadCount: opts.unreadCount ?? 0,
    assignmentCount: opts.assignmentCount ?? 0,
    dueSoonCount: opts.dueSoonCount ?? 0,
    quizCount: opts.quizCount ?? 0,
    moduleCount: opts.moduleCount ?? 0,
    activeSessionId: opts.activeSessionId ?? null,
    latestDueAt: opts.latestDueAt ?? null,
    memberCount: opts.memberCount,
    schoolId: opts.schoolId,
  };
}

// ─── course_units → CourseModule ───
export function toCourseModuleFromSupabase(
  row: SupabaseCourseUnitRow,
  opts: { materialCount?: number; progress?: number } = {},
): CourseModule {
  return {
    id: asString(row.id),
    courseSpaceId: asString(row.course_id),
    title: row.title || '',
    order: typeof row.position === 'number' ? row.position : 0,
    visible: row.is_visible !== false,
    materialCount: opts.materialCount ?? 0,
    progress: opts.progress ?? 0,
  };
}

// ─── course_materials → CourseMaterial ───
function inferMaterialType(kind?: string | null): CourseMaterial['type'] {
  if (!kind) return 'doc';
  const k = kind.toLowerCase();
  if (k.includes('video') || k.includes('mp4')) return 'video';
  if (k.includes('audio') || k.includes('mp3')) return 'audio';
  if (k.includes('pdf')) return 'pdf';
  if (k.includes('link') || k.includes('url')) return 'link';
  return 'doc';
}
export function toCourseMaterialFromSupabase(
  row: SupabaseCourseMaterialRow,
): CourseMaterial {
  return {
    id: asString(row.id),
    moduleId: asString(row.unit_id ?? row.course_id),
    title: row.title || '',
    type: inferMaterialType(row.kind),
    url: row.url || '',
    progress: 0,
  };
}

// ─── quizzes → Quiz ───
function inferQuizType(status?: string | null): Quiz['type'] {
  if (status && /(exam|final|midterm|期末|期中)/i.test(status)) return 'exam';
  return 'quiz';
}
export function toQuizFromSupabase(row: SupabaseQuizRow, groupName: string): Quiz {
  const id = asString(row.id);
  return {
    id,
    assignmentId: id,
    groupId: asString(row.course_id),
    groupName,
    title: row.title || '',
    description: row.description || '',
    dueAt: asDate(row.due_at),
    type: inferQuizType(row.status),
    gradesPublished: row.status === 'published',
    points: row.total_score ?? undefined,
    source: 'quiz',
  };
}

// ─── live_sessions → AttendanceSession ───
export function toAttendanceSessionFromSupabase(
  row: SupabaseLiveSessionRow,
): AttendanceSession {
  const now = Date.now();
  const startAt = asDate(row.starts_at);
  const endAt = asDate(row.ends_at);
  const active = !!(startAt && (!endAt || endAt.getTime() > now));
  return {
    id: asString(row.id),
    groupId: asString(row.course_id),
    groupName: row.title || '',
    active,
    startedAt: startAt,
    endedAt: endAt,
    source: 'live',
  };
}

// ─── live_attendance → AttendanceRecord ───
function normalizeAttendanceStatus(s?: string | null): AttendanceRecord['status'] {
  if (!s) return 'absent';
  const v = s.toLowerCase();
  if (v.startsWith('p')) return 'present';
  if (v.startsWith('l')) return 'late';
  if (v.startsWith('e')) return 'excused';
  return 'absent';
}
export function toAttendanceRecordFromSupabase(
  row: SupabaseLiveAttendanceRow,
): AttendanceRecord {
  return {
    id: asString(row.id),
    sessionId: asString(row.session_id),
    groupId: '',
    userId: asString(row.user_id),
    status: normalizeAttendanceStatus(row.status),
    checkedInAt: asDate(row.checked_in_at),
  };
}

// ─── course_grade_rollups → CourseGradebookData ───
export function toCourseGradebookDataFromSupabase(
  courseId: string,
  rows: SupabaseGradeRollupRow[],
  opts: { groupName?: string; passingScore?: number } = {},
): CourseGradebookData {
  // 把扁平的 rollup 列轉成共用引擎需要的 { assignments, rows } 結構
  // 每個唯一 item_name 視為一個 assignment;每個唯一 user_id 視為一個 row
  const assignmentMap: Record<
    string,
    {
      id: string;
      title: string;
      weight: number;
      dueAt: Date | null;
      gradesPublished: boolean;
      averageScore: number | null;
      scores: number[];
    }
  > = {};
  const userRows: Record<
    string,
    {
      uid: string;
      breakdown: Array<{
        assignmentId: string;
        title: string;
        weight: number;
        dueAt: Date | null;
        grade: number | null;
        isLate: boolean;
        feedback?: string | null;
        submittedAt: Date | null;
      }>;
      finalScoreNumerator: number;
      finalScoreWeightSum: number;
    }
  > = {};

  rows.forEach(r => {
    const aid = `${courseId}::${r.item_name}`;
    if (!assignmentMap[aid]) {
      assignmentMap[aid] = {
        id: aid,
        title: r.item_name,
        weight: r.weight ?? 1,
        dueAt: null,
        gradesPublished: false,
        averageScore: null,
        scores: [],
      };
    }
    if (typeof r.score === 'number') {
      assignmentMap[aid].scores.push(r.score);
    }
    const uid = asString(r.user_id);
    if (!userRows[uid]) {
      userRows[uid] = {
        uid,
        breakdown: [],
        finalScoreNumerator: 0,
        finalScoreWeightSum: 0,
      };
    }
    userRows[uid].breakdown.push({
      assignmentId: aid,
      title: r.item_name,
      weight: r.weight ?? 1,
      dueAt: null,
      grade: r.score ?? null,
      isLate: false,
      submittedAt: null,
    });
    if (typeof r.score === 'number') {
      userRows[uid].finalScoreNumerator += r.score * (r.weight ?? 1);
      userRows[uid].finalScoreWeightSum += r.weight ?? 1;
    }
  });

  const assignments = Object.values(assignmentMap).map(a => {
    const avg = a.scores.length
      ? a.scores.reduce((s, n) => s + n, 0) / a.scores.length
      : null;
    return {
      id: a.id,
      title: a.title,
      weight: a.weight,
      dueAt: a.dueAt,
      gradesPublished: a.gradesPublished,
      averageScore: avg,
    };
  });

  const passingScore = opts.passingScore ?? 60;
  const finalRows = Object.values(userRows).map(u => {
    const finalScore =
      u.finalScoreWeightSum > 0
        ? u.finalScoreNumerator / u.finalScoreWeightSum
        : null;
    return {
      uid: u.uid,
      displayName: '',
      email: null,
      studentId: null,
      department: null,
      finalScore,
      passingScore,
      result:
        finalScore == null
          ? 'pending'
          : finalScore >= passingScore
            ? 'pass'
            : 'fail',
      published: false,
      publishedAt: null,
      gradedAssignments: u.breakdown.filter(b => b.grade != null).length,
      totalAssignments: u.breakdown.length,
      assignmentBreakdown: u.breakdown,
    };
  });

  return {
    groupName: opts.groupName || courseId,
    finalScoresPublished: false,
    finalScoresPublishedAt: null,
    assignments,
    rows: finalRows,
  };
}

// ─── Bulk import result (對齊 tronclassAdapter 的 TronClassImportResult) ───

export interface SupabaseLmsImportResult {
  courses: CourseSpace[];
  modules: CourseModule[];
  materials: CourseMaterial[];
  quizzes: Quiz[];
  attendanceSessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  gradebooks: CourseGradebookData[];
}

export function buildImportResultFromSupabase(input: {
  courses: SupabaseCourseRow[];
  units?: SupabaseCourseUnitRow[];
  materials?: SupabaseCourseMaterialRow[];
  quizzes?: SupabaseQuizRow[];
  liveSessions?: SupabaseLiveSessionRow[];
  liveAttendance?: SupabaseLiveAttendanceRow[];
  gradeRollups?: SupabaseGradeRollupRow[];
}): SupabaseLmsImportResult {
  const courses = (input.courses || []).map(c => toCourseSpaceFromSupabase(c));
  const modules = (input.units || []).map(u => toCourseModuleFromSupabase(u));
  const materials = (input.materials || []).map(m => toCourseMaterialFromSupabase(m));
  const quizzes = (input.quizzes || []).map(q =>
    toQuizFromSupabase(q, courses.find(c => c.id === asString(q.course_id))?.name || ''),
  );
  const attendanceSessions = (input.liveSessions || []).map(s =>
    toAttendanceSessionFromSupabase(s),
  );
  const attendanceRecords = (input.liveAttendance || []).map(r =>
    toAttendanceRecordFromSupabase(r),
  );

  // gradebooks 依 course_id 群組
  const grBy: Record<string, SupabaseGradeRollupRow[]> = {};
  (input.gradeRollups || []).forEach(r => {
    const k = asString(r.course_id);
    if (!grBy[k]) grBy[k] = [];
    grBy[k].push(r);
  });
  const gradebooks = Object.entries(grBy).map(([cid, rs]) =>
    toCourseGradebookDataFromSupabase(cid, rs),
  );

  return {
    courses,
    modules,
    materials,
    quizzes,
    attendanceSessions,
    attendanceRecords,
    gradebooks,
  };
}
