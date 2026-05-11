import { buildPostLoginContext, getPostLoginContext } from '../data/postLoginDataRouter';
import type { PostLoginContext } from '../data/postLoginTypes';
import type { UserRole } from '../state/auth';
import { loadMockAuthSession } from './mockAuth';
import {
  getAnyCachedAnnouncements,
  getAnyCachedCourses,
  getAnyCachedTCCourses,
  getAnyCachedTCTodos,
} from './puDataCache';
import type { TCActivity } from './tronClassClient';
import type { TCCourse } from './tronClassClient';
import {
  getInMemoryPostLoginContext,
  setInMemoryPostLoginContext,
} from './postLoginContextHolder';

/**
 * 從現有 puDataCache（@pu_cache:）組裝參數並呼叫 data 層 buildPostLoginContext，
 * 寫入 @pu_cache_v1: 與記憶體。不觸發舊版 routePostLoginData 的 EventBus。
 */
export async function syncPostLoginContextFromCaches(params: {
  uid: string;
  schoolId: string;
  role: UserRole;
  email?: string | null;
}): Promise<PostLoginContext | null> {
  try {
    const [puResult, tcList, todos, puAnnouncements] = await Promise.all([
      getAnyCachedCourses(),
      getAnyCachedTCCourses(),
      getAnyCachedTCTodos(),
      getAnyCachedAnnouncements(),
    ]);

    const semesterFallback = puResult?.semester ?? null;
    const puCourses =
      puResult?.courses.map((c) => ({
        code: c.code,
        name: c.name,
        credits: c.credits,
        teacherName: c.teacherName,
        teacherEmail: c.teacherEmail,
        semesterId: semesterFallback ?? undefined,
      })) ?? [];

    const tronCourses = (tcList ?? []).map((tc) => tcCourseToRaw(tc, params.uid));

    const pendingAssignments = (todos ?? [])
      .filter((t) => ['homework', 'quiz', 'exam'].includes(t.type))
      .map((t) => tcActivityToRawAssignment(t));

    const announcements = (puAnnouncements ?? []).map((a) => ({
      id: a.url?.trim() ? a.url : `pu:${a.title}`,
      title: a.title,
      publishedAt: a.date?.trim() ? a.date : new Date().toISOString(),
    }));

    const ctx = await buildPostLoginContext({
      uid: params.uid,
      schoolId: params.schoolId,
      userDoc: {
        role: params.role,
        email: params.email ?? null,
      },
      puCourses: puCourses.length ? puCourses : null,
      tronCourses: tronCourses.length ? tronCourses : null,
      tronMembers: null,
      schoolMembers: null,
      pendingAssignments: pendingAssignments.length ? pendingAssignments : null,
      puAnnouncements: announcements.length ? announcements : null,
    });

    setInMemoryPostLoginContext(ctx);
    return ctx;
  } catch (e) {
    console.warn('[postLoginContextFromCaches] sync failed:', e);
    return null;
  }
}

/** 記憶體優先，否則讀 AsyncStorage（與目前學校 id 對齊）。 */
export async function resolveActivePostLoginContext(): Promise<PostLoginContext | null> {
  const mem = getInMemoryPostLoginContext();
  if (mem) return mem;
  const session = await loadMockAuthSession();
  if (!session?.schoolId) return null;
  return getPostLoginContext(session.schoolId);
}

/** Tron 課程若為教師端，應設 isTeacher 或讓 teacherUserId === Firebase uid（adapter 需一致）。 */
function tcCourseToRaw(tc: TCCourse, firebaseUid: string) {
  const isTeacher = tc.role === 'teacher';
  return {
    id: String(tc.id),
    name: tc.name,
    courseCode: tc.course_code,
    credits: tc.credit ?? 0,
    semesterId: tc.semester?.code ?? 'unknown',
    teacherName: tc.instructors?.[0]?.name,
    teacherEmail: undefined as string | undefined,
    isTeacher,
    teacherUserId: isTeacher ? firebaseUid : undefined,
    schedule: undefined as string | undefined,
  };
}

function tcActivityToRawAssignment(t: TCActivity) {
  const submitted = t.status === 'submitted' || t.status === 'graded';
  const type =
    t.type === 'exam' ? ('exam' as const) : t.type === 'quiz' ? ('quiz' as const) : ('homework' as const);
  return {
    id: String(t.id),
    courseId: String(t.course_id),
    title: t.title,
    dueAt: t.end_time ?? '',
    type,
    submitted,
    score: t.score ?? undefined,
    maxScore: t.total_score ?? undefined,
  };
}
