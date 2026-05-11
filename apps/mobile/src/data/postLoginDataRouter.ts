import {
  NormalizedAssignment,
  NormalizedCourse,
  PostLoginContext,
  PrimaryRole,
  ResolvedRoles,
} from './postLoginTypes';
import { puCacheGet, puCacheSet } from './puDataCache';

// ─── 對外 API ────────────────────────────────────────────────────────────────

/**
 * 登入後呼叫這個函式，傳入從 Firebase/E校園/TronClass 抓到的原始資料。
 * 會自動判斷 role、標準化課程、對齊 uid，然後寫進 puDataCache，
 * 並回傳 PostLoginContext 給前端使用。
 */
export async function buildPostLoginContext(params: {
  uid: string;
  schoolId: string;
  /** 從 Firestore users/{uid} 讀出的資料 */
  userDoc: Record<string, unknown>;
  /** E 校園課表（可選，抓失敗時可傳 null） */
  puCourses: PuRawCourse[] | null;
  /** TronClass 課程（可選） */
  tronCourses: TronRawCourse[] | null;
  /** TronClass 各課程成員（courseId -> members[]） */
  tronMembers: Record<string, TronMember[]> | null;
  /** Firebase school members（用來做 email -> uid 對齊） */
  schoolMembers: SchoolMember[] | null;
  /** 待辦作業 */
  pendingAssignments: TronRawAssignment[] | null;
  /** E 校園公告 */
  puAnnouncements: PuAnnouncement[] | null;
}): Promise<PostLoginContext> {
  const errors: string[] = [];

  // 1. 解析角色
  const roles = resolveRoles({
    uid: params.uid,
    userDoc: params.userDoc,
    tronCourses: params.tronCourses,
  });

  // 2. 建立 email/teacherName -> uid 對照表
  const uidByEmail = buildUidMap(params.schoolMembers ?? []);

  // 3. 標準化課程
  const normalizedCourses = normalizeCourses({
    puCourses: params.puCourses ?? [],
    tronCourses: params.tronCourses ?? [],
    tronMembers: params.tronMembers ?? {},
    uidByEmail,
  });

  // 4. 標準化作業
  const normalizedAssignments = normalizeAssignments(params.pendingAssignments ?? [], errors);

  // 5. 依角色組出視角
  const ctx: PostLoginContext = {
    uid: params.uid,
    schoolId: params.schoolId,
    roles,
    latestAnnouncements: (params.puAnnouncements ?? []).slice(0, 10).map((a) => ({
      id: a.id,
      title: a.title,
      publishedAt: a.publishedAt,
      source: 'pu' as const,
    })),
    builtAt: new Date().toISOString(),
    partialErrors: errors,
  };

  if (roles.flags.isStudent) {
    const studentCourses = normalizedCourses.filter((c) => c.studentUids.includes(params.uid));
    ctx.asStudent = {
      courses: studentCourses,
      pendingAssignments: normalizedAssignments.filter(
        (a) => a.status === 'pending' || a.status === 'overdue',
      ),
      upcomingExams: normalizedAssignments.filter((a) => a.type === 'exam'),
    };
  }

  if (roles.flags.isTeacher) {
    ctx.asTeacher = {
      teachingCourses: normalizedCourses.filter((c) => c.teacherUids.includes(params.uid)),
    };
  }

  // 6. 寫進 puDataCache
  await puCacheSet(`${params.schoolId}:postLoginContext`, ctx, 'computed');

  return ctx;
}

/**
 * 從 cache 讀取上一次 buildPostLoginContext 的結果。
 * 在各引擎初始化時呼叫，不用每次重跑 router。
 */
export async function getPostLoginContext(schoolId: string): Promise<PostLoginContext | null> {
  const cached = await puCacheGet<PostLoginContext>(`${schoolId}:postLoginContext`, {
    allowStale: true,
  });
  return cached?.data ?? null;
}

// ─── 內部函式 ────────────────────────────────────────────────────────────────

function resolveRoles(params: {
  uid: string;
  userDoc: Record<string, unknown>;
  tronCourses: TronRawCourse[] | null;
}): ResolvedRoles {
  const storedRole = params.userDoc?.role as string | undefined;

  // 如果 Firestore 已有明確的非 student role，直接信任
  if (storedRole && storedRole !== 'student') {
    return buildResolvedRoles(storedRole as PrimaryRole, 'firestore');
  }

  // TronClass：isTeacher 由呼叫端標記，或 teacherUserId 對到自己 → 老師
  const looksLikeTeacher =
    params.tronCourses?.some(
      (c) => c.isTeacher === true || (c.teacherUserId && c.teacherUserId === params.uid),
    ) ?? false;

  if (looksLikeTeacher) {
    return buildResolvedRoles('teacher', 'tron');
  }

  return buildResolvedRoles('student', 'fallback');
}

function buildResolvedRoles(role: PrimaryRole, source: ResolvedRoles['source']): ResolvedRoles {
  return {
    primaryRole: role,
    subRoles: [],
    flags: {
      isTeacher: role === 'teacher' || role === 'departmentAdmin' || role === 'admin',
      isStudent: role === 'student',
      isDeptAdmin: role === 'departmentAdmin',
      isAdmin: role === 'admin',
    },
    source,
  };
}

function buildUidMap(members: SchoolMember[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    if (m.email) map.set(m.email.toLowerCase().trim(), m.uid);
    if (m.teacherEmail) map.set(m.teacherEmail.toLowerCase().trim(), m.uid);
  }
  return map;
}

function normalizeCourses(params: {
  puCourses: PuRawCourse[];
  tronCourses: TronRawCourse[];
  tronMembers: Record<string, TronMember[]>;
  uidByEmail: Map<string, string>;
}): NormalizedCourse[] {
  const courses: NormalizedCourse[] = [];

  for (const tc of params.tronCourses) {
    const members = params.tronMembers[tc.id] ?? [];
    const studentUids = members
      .filter((m) => m.role === 'student')
      .map((m) => params.uidByEmail.get(m.email?.toLowerCase() ?? '') ?? m.userId ?? '')
      .filter(Boolean);

    const teacherEmail = tc.teacherEmail?.toLowerCase().trim();
    const teacherUid = teacherEmail ? (params.uidByEmail.get(teacherEmail) ?? '') : '';

    courses.push({
      id: tc.id,
      code: tc.courseCode ?? tc.id,
      name: tc.name,
      credits: tc.credits ?? 0,
      semesterId: tc.semesterId ?? 'unknown',
      teacherUids: teacherUid ? [teacherUid] : [],
      teacherNames: tc.teacherName ? [tc.teacherName] : [],
      studentUids,
      schedule: parseTronSchedule(tc.schedule),
      source: 'tron',
      tronCourseId: tc.id,
    });
  }

  const tronCodes = new Set(courses.map((c) => `${c.semesterId}:${c.code}`));
  for (const pc of params.puCourses) {
    const semesterId = pc.semesterId ?? 'unknown';
    const key = `${semesterId}:${pc.code}`;
    if (tronCodes.has(key)) continue;

    const teacherEmail = pc.teacherEmail?.toLowerCase().trim();
    const teacherUid = teacherEmail ? (params.uidByEmail.get(teacherEmail) ?? '') : '';

    courses.push({
      id: pc.code,
      code: pc.code,
      name: pc.name,
      credits: pc.credits,
      semesterId,
      teacherUids: teacherUid ? [teacherUid] : [],
      teacherNames: pc.teacherName ? [pc.teacherName] : [],
      studentUids: [],
      schedule: [],
      source: 'pu',
      puCourseCode: pc.code,
    });
    tronCodes.add(key);
  }

  return courses;
}

function parseTronSchedule(raw?: string): NormalizedCourse['schedule'] {
  // TronClass schedule 格式因學校而異，這裡給 safe fallback
  if (!raw) return [];
  return [];
}

function normalizeAssignments(
  raw: TronRawAssignment[],
  errors: string[],
): NormalizedAssignment[] {
  return raw
    .map((a) => {
      try {
        const now = Date.now();
        const dueMs = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        let status: NormalizedAssignment['status'] = 'pending';
        if (a.submitted) status = 'submitted';
        else if (dueMs > 0 && dueMs < now) status = 'overdue';

        return {
          id: a.id,
          courseId: a.courseId,
          title: a.title,
          dueAt: a.dueAt ?? '',
          type: a.type ?? 'homework',
          status,
          score: a.score,
          maxScore: a.maxScore,
          source: 'tron' as const,
        } satisfies NormalizedAssignment;
      } catch {
        errors.push(`assignment.normalize:${a.id}`);
        return null;
      }
    })
    .filter(Boolean) as NormalizedAssignment[];
}

// ─── 原始資料型別（最小定義，和 backend scraper 輸出對齊即可）────────────────
interface PuRawCourse {
  code: string;
  name: string;
  credits: number;
  teacherName?: string;
  teacherEmail?: string;
  semesterId?: string;
}

interface TronRawCourse {
  id: string;
  name: string;
  courseCode?: string;
  credits?: number;
  semesterId?: string;
  teacherName?: string;
  teacherEmail?: string;
  /** 由呼叫端依目前使用者標記是否為該課教師 */
  isTeacher?: boolean;
  /** 若與目前登入 uid 相同，可視為教師 */
  teacherUserId?: string;
  schedule?: string;
}

interface TronMember {
  userId?: string;
  email?: string;
  role: 'student' | 'teacher' | 'ta';
}

interface TronRawAssignment {
  id: string;
  courseId: string;
  title: string;
  dueAt?: string;
  type?: 'homework' | 'exam' | 'quiz';
  submitted?: boolean;
  score?: number;
  maxScore?: number;
}

interface SchoolMember {
  uid: string;
  email?: string;
  teacherEmail?: string;
}

interface PuAnnouncement {
  id: string;
  title: string;
  publishedAt: string;
}
