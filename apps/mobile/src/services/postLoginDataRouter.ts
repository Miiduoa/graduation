/**
 * postLoginDataRouter.ts — 登入後「舊版」跨角色關聯與 EventBus
 *
 * 與 `src/data/postLoginDataRouter.ts` 分工：
 *   - data/postLoginDataRouter：只做 buildPostLoginContext / getPostLoginContext（標準化 + @pu_cache_v1:），無 EventBus。
 *   - 本檔：routePostLoginData（關聯圖、同學名冊、@campus:role_data:）＋依 PostLoginContext 補發事件（見 routePostLoginDataWithContext）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedStudentInfo,
  getAnyCachedAnnouncements,
  getAnyCachedTCCourses,
} from './puDataCache';
import {
  tcFetchProfile,
  tcFetchCourses,
  tcFetchCourseMembers,
  hasTCSession,
  type TCCourse,
  type TCCourseMember,
  type TCUserProfile,
} from './tronClassClient';
import { loadMockAuthSession, saveMockAuthSession } from './mockAuth';
import { isTestAccount, getTestClassRoster, TEST_UIDS } from './testSeedData';
import { campusEventBus } from './campusEventBus';
import { getAuthInstance } from '../firebase';
import { tryCallFinalizePostLogin } from './finalizePostLoginClient';
import { getPostLoginContext } from '../data/postLoginDataRouter';
import type { PrimaryRole } from '../data/postLoginTypes';
import type { UserRole } from '../state/auth';
import type { PUCourse, PUCourseResult } from './puDirectScraper';

// ═══════════════════════════════════════════════════════
// I. Types
// ═══════════════════════════════════════════════════════

/** 師生關聯圖中的單筆記錄 */
export type CourseRelation = {
  courseCode: string;
  courseName: string;
  teacherName: string;
  teacherEmail: string;
  /** 來自 TronClass 的老師 ID（如果有的話） */
  teacherTCId: number | null;
  /** 來自 TronClass 的課程 ID */
  tcCourseId: number | null;
  /** 修課學生列表（教師視角才會有完整名冊） */
  students: CourseMemberInfo[];
  /** 這個使用者在這門課的角色 */
  userRole: 'student' | 'teacher' | 'ta' | 'unknown';
};

export type CourseMemberInfo = {
  id: string;
  name: string;
  role: string; // student | teacher | ta
  avatarUrl: string | null;
};

/** 角色推斷結果 */
export type RoleInferenceResult = {
  inferredRole: UserRole;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /** TronClass profile 原始角色字串 */
  tcProfileRole: string | null;
  /** 是否有教授課程 */
  hasTeachingCourses: boolean;
  /** 教授課程數量 */
  teachingCourseCount: number;
  /** 修課課程數量 */
  enrolledCourseCount: number;
};

/** 登入後資料路由的完整結果 */
export type PostLoginDataResult = {
  roleInference: RoleInferenceResult;
  courseRelations: CourseRelation[];
  /** 同班同學名冊（學生視角：我同學有誰） */
  classmates: CourseMemberInfo[];
  /** 教學學生名冊（教師視角：我教的學生有誰） */
  myStudents: CourseMemberInfo[];
  /** 所有相關教師 */
  myTeachers: Array<{ name: string; email: string; courses: string[] }>;
  /** 路由耗時 ms */
  elapsedMs: number;
};

// ═══════════════════════════════════════════════════════
// II. Storage Keys
// ═══════════════════════════════════════════════════════

const STORAGE_PREFIX = '@campus:role_data:';
const KEYS = {
  inferredRole: `${STORAGE_PREFIX}inferred_role`,
  courseRelations: `${STORAGE_PREFIX}course_relations`,
  classmates: `${STORAGE_PREFIX}classmates`,
  myStudents: `${STORAGE_PREFIX}my_students`,
  myTeachers: `${STORAGE_PREFIX}my_teachers`,
  lastRouted: `${STORAGE_PREFIX}last_routed`,
} as const;

// ═══════════════════════════════════════════════════════
// III. 角色推斷
// ═══════════════════════════════════════════════════════

/**
 * 根據 TronClass 資料自動推斷使用者的角色。
 *
 * 推斷邏輯：
 *   1. TronClass profile.role === 'teacher'/'admin' → 直接採用
 *   2. 有任何 course.role === 'teacher' → teacher（可能是兼任講師）
 *   3. 有 course.role === 'ta' → 仍為 student（助教通常是研究生）
 *   4. 都是 student → student
 */
async function inferRole(currentRole: UserRole): Promise<RoleInferenceResult> {
  // 測試帳號不推斷
  const session = await loadMockAuthSession();
  if (session && isTestAccount(session.uid)) {
    return {
      inferredRole: currentRole,
      confidence: 'high',
      reason: '測試帳號，使用預設角色',
      tcProfileRole: null,
      hasTeachingCourses: currentRole === 'teacher' || currentRole === 'professor',
      teachingCourseCount: 0,
      enrolledCourseCount: 0,
    };
  }

  let tcProfileRole: string | null = null;
  let hasTeachingCourses = false;
  let teachingCourseCount = 0;
  let enrolledCourseCount = 0;

  // Step 1: 嘗試從 TronClass Profile 取得角色
  try {
    if (await hasTCSession()) {
      const profile = await tcFetchProfile();
      if (profile) {
        tcProfileRole = profile.role;
        console.log(`[postLoginDataRouter] TC profile role: ${profile.role}`);
      }
    }
  } catch (e) {
    console.warn('[postLoginDataRouter] tcFetchProfile failed:', e);
  }

  // Step 2: 從 TronClass 課程列表判斷
  try {
    const tcCourses = await getAnyCachedTCCourses();
    if (tcCourses && tcCourses.length > 0) {
      for (const c of tcCourses) {
        if (c.role === 'teacher') {
          hasTeachingCourses = true;
          teachingCourseCount++;
        } else if (c.role === 'student') {
          enrolledCourseCount++;
        }
      }
    }
  } catch (_) { /* ignore */ }

  // Step 3: 綜合判斷
  let inferredRole: UserRole = currentRole;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let reason = '';

  if (tcProfileRole === 'teacher' || tcProfileRole === 'admin') {
    // TronClass 明確告訴我們
    inferredRole = tcProfileRole === 'admin' ? 'admin' : 'teacher';
    confidence = 'high';
    reason = `TronClass profile.role = "${tcProfileRole}"`;
  } else if (hasTeachingCourses) {
    // 有教授課程 → 教師（即使 profile 說 student，可能是兼任）
    inferredRole = 'teacher';
    confidence = 'medium';
    reason = `有 ${teachingCourseCount} 門教授課程（TronClass course.role = "teacher"）`;
  } else if (enrolledCourseCount > 0) {
    // 只有修課 → 學生
    inferredRole = 'student';
    confidence = 'high';
    reason = `修課 ${enrolledCourseCount} 門，無教授課程`;
  } else if (tcProfileRole) {
    // 有 profile 但沒課程資料
    inferredRole = tcProfileRole === 'student' ? 'student' : currentRole;
    confidence = 'medium';
    reason = `TronClass profile.role = "${tcProfileRole}"，無課程資料`;
  } else {
    // 什麼都沒有 → 維持原 role
    confidence = 'low';
    reason = '無 TronClass 資料，維持預設角色';
  }

  return {
    inferredRole,
    confidence,
    reason,
    tcProfileRole,
    hasTeachingCourses,
    teachingCourseCount,
    enrolledCourseCount,
  };
}

// ═══════════════════════════════════════════════════════
// IV. 課程關聯建構
// ═══════════════════════════════════════════════════════

/**
 * 解析 E校園課表 + TronClass 課程，建立完整的師生關聯圖。
 */
async function buildCourseRelations(
  inferredRole: UserRole,
): Promise<{
  relations: CourseRelation[];
  classmates: CourseMemberInfo[];
  myStudents: CourseMemberInfo[];
  myTeachers: Array<{ name: string; email: string; courses: string[] }>;
}> {
  const relations: CourseRelation[] = [];
  const classmateMap = new Map<string, CourseMemberInfo>();
  const studentMap = new Map<string, CourseMemberInfo>();
  const teacherMap = new Map<string, { name: string; email: string; courses: string[] }>();

  // ── 取得快取的課程資料 ──
  const puCourseResult = await getAnyCachedCourses();
  const tcCourses = await getAnyCachedTCCourses();
  const puCourses: PUCourse[] = puCourseResult?.courses ?? [];

  // ── 建立 TC course code → TC course 的對照表 ──
  const tcCourseByCode = new Map<string, TCCourse>();
  if (tcCourses) {
    for (const tc of tcCourses) {
      if (tc.course_code) {
        tcCourseByCode.set(tc.course_code, tc);
      }
    }
  }

  // ── 處理 E校園課表中的每一門課 ──
  for (const pu of puCourses) {
    const matchedTC = tcCourseByCode.get(pu.code) ?? null;

    // 判斷此使用者在這門課的角色
    let userRole: 'student' | 'teacher' | 'ta' | 'unknown' = 'unknown';
    if (matchedTC) {
      userRole = (matchedTC.role as 'student' | 'teacher' | 'ta') ?? 'unknown';
    } else if (inferredRole === 'teacher' || inferredRole === 'professor') {
      // 沒有 TC 匹配但使用者是教師 → 可能是教這門課
      userRole = 'teacher';
    } else {
      userRole = 'student';
    }

    const relation: CourseRelation = {
      courseCode: pu.code,
      courseName: pu.name,
      teacherName: pu.teacherName ?? '',
      teacherEmail: pu.teacherEmail ?? '',
      teacherTCId: matchedTC?.instructors?.[0]?.id ?? null,
      tcCourseId: matchedTC?.id ?? null,
      students: [],
      userRole,
    };

    // 記錄教師
    if (pu.teacherName && userRole === 'student') {
      const existing = teacherMap.get(pu.teacherName);
      if (existing) {
        existing.courses.push(pu.name);
      } else {
        teacherMap.set(pu.teacherName, {
          name: pu.teacherName,
          email: pu.teacherEmail ?? '',
          courses: [pu.name],
        });
      }
    }

    relations.push(relation);
  }

  // ── 處理 TC 課程中有但 E校園沒有的課（純 TronClass 課程）──
  if (tcCourses) {
    for (const tc of tcCourses) {
      const alreadyCovered = relations.some((r) => r.courseCode === tc.course_code);
      if (alreadyCovered) continue;

      const userRole = (tc.role as 'student' | 'teacher' | 'ta') ?? 'unknown';
      relations.push({
        courseCode: tc.course_code,
        courseName: tc.name,
        teacherName: tc.instructors?.[0]?.name ?? '',
        teacherEmail: '',
        teacherTCId: tc.instructors?.[0]?.id ?? null,
        tcCourseId: tc.id,
        students: [],
        userRole,
      });

      // 記錄教師
      if (tc.instructors?.[0]?.name && userRole === 'student') {
        const tName = tc.instructors[0].name;
        const existing = teacherMap.get(tName);
        if (existing) {
          existing.courses.push(tc.name);
        } else {
          teacherMap.set(tName, { name: tName, email: '', courses: [tc.name] });
        }
      }
    }
  }

  // ── 預載課程成員名冊（TronClass）──
  const hasTc = await hasTCSession();
  if (hasTc) {
    // 最多並行載入 6 門課的成員（避免太多請求）
    const coursesToFetch = relations
      .filter((r) => r.tcCourseId != null)
      .slice(0, 6);

    const memberResults = await Promise.allSettled(
      coursesToFetch.map(async (r) => {
        try {
          const members = await tcFetchCourseMembers(r.tcCourseId!);
          return { courseCode: r.courseCode, members };
        } catch {
          return { courseCode: r.courseCode, members: [] as TCCourseMember[] };
        }
      }),
    );

    for (const result of memberResults) {
      if (result.status !== 'fulfilled') continue;
      const { courseCode, members } = result.value;

      const relation = relations.find((r) => r.courseCode === courseCode);
      if (!relation) continue;

      const memberInfos: CourseMemberInfo[] = members.map((m) => ({
        id: m.id.toString(),
        name: m.name,
        role: m.role,
        avatarUrl: m.avatar_url ?? null,
      }));

      relation.students = memberInfos;

      // 分類學生/同學
      for (const m of memberInfos) {
        if (m.role === 'student') {
          if (relation.userRole === 'student') {
            // 我是學生 → 其他學生是同學
            classmateMap.set(m.id, m);
          } else if (relation.userRole === 'teacher') {
            // 我是教師 → 學生是我的學生
            studentMap.set(m.id, m);
          }
        }
      }
    }
  }

  // ── 測試帳號：用 testSeedData 的名冊 ──
  const session = await loadMockAuthSession();
  if (session && isTestAccount(session.uid)) {
    const roster = getTestClassRoster();
    for (const c of roster) {
      if (c.uid === session.uid) continue; // 排除自己
      const info: CourseMemberInfo = {
        id: c.uid,
        name: c.displayName,
        role: 'student',
        avatarUrl: null,
      };
      if (inferredRole === 'teacher' || inferredRole === 'professor') {
        studentMap.set(c.uid, info);
      } else {
        classmateMap.set(c.uid, info);
      }
    }
  }

  return {
    relations,
    classmates: Array.from(classmateMap.values()),
    myStudents: Array.from(studentMap.values()),
    myTeachers: Array.from(teacherMap.values()),
  };
}

// ═══════════════════════════════════════════════════════
// V. 主入口
// ═══════════════════════════════════════════════════════

/**
 * 登入後呼叫此函式，完成：
 *   1. 自動推斷角色（可能更新 MockAuthSession.role）
 *   2. 建立師生關聯圖
 *   3. 預載課程成員名冊
 *   4. 儲存結果到 AsyncStorage
 *   5. 透過 EventBus 廣播結果
 *
 * @param currentRole - 目前儲存的角色（可能是預設的 'student'）
 * @returns 完整的路由結果
 */
export async function routePostLoginData(
  currentRole: UserRole,
): Promise<PostLoginDataResult> {
  const start = Date.now();
  console.log('[postLoginDataRouter] Starting post-login data routing…');

  // ── Step 0: 後端 finalize（權威角色 + Firestore / claims）──
  let serverFinalize: Awaited<ReturnType<typeof tryCallFinalizePostLogin>> = null;
  try {
    serverFinalize = await tryCallFinalizePostLogin();
    if (serverFinalize?.success) {
      const u = getAuthInstance().currentUser;
      if (u) {
        await u.getIdToken(true).catch(() => undefined);
      }
    }
  } catch (e) {
    console.warn('[postLoginDataRouter] finalizePostLogin skipped:', e);
  }

  // ── Step 1: 推斷角色（優先採用伺服器解析）──
  let roleInference: RoleInferenceResult;
  let effectiveRole: UserRole = currentRole;

  if (serverFinalize?.resolved?.primaryRole) {
    effectiveRole = serverFinalize.resolved.primaryRole as UserRole;
    const tcCourses = await getAnyCachedTCCourses();
    const teachingCount =
      tcCourses?.filter((c) => String(c.role || '').toLowerCase() === 'teacher').length ?? 0;
    const enrolledCount =
      tcCourses?.filter((c) => String(c.role || '').toLowerCase() === 'student').length ?? 0;
    roleInference = {
      inferredRole: effectiveRole,
      confidence: (serverFinalize.resolved.confidence as RoleInferenceResult['confidence']) || 'high',
      reason: serverFinalize.resolved.reasons?.join('; ') || 'finalizePostLogin',
      tcProfileRole: null,
      hasTeachingCourses: teachingCount > 0,
      teachingCourseCount: teachingCount,
      enrolledCourseCount: enrolledCount,
    };
    console.log(
      `[postLoginDataRouter] Server role: ${currentRole} → ${effectiveRole} (${roleInference.confidence})`,
    );
  } else {
    roleInference = await inferRole(currentRole);
    effectiveRole = roleInference.inferredRole;
    console.log(
      `[postLoginDataRouter] Role inference: ${currentRole} → ${roleInference.inferredRole} (${roleInference.confidence}: ${roleInference.reason})`,
    );
  }

  // 如果推斷的角色不同 → 更新 MockAuthSession
  if (roleInference.inferredRole !== currentRole) {
    try {
      const session = await loadMockAuthSession();
      if (session) {
        session.role = roleInference.inferredRole;
        await saveMockAuthSession(session);
        console.log(`[postLoginDataRouter] Updated session role: ${currentRole} → ${roleInference.inferredRole}`);
      }
    } catch (e) {
      console.warn('[postLoginDataRouter] Failed to update session role:', e);
    }
  }

  // ── Step 2: 建立課程關聯 ──
  const { relations, classmates, myStudents, myTeachers } = await buildCourseRelations(
    effectiveRole,
  );
  console.log(
    `[postLoginDataRouter] Relations built: ${relations.length} courses, ${classmates.length} classmates, ${myStudents.length} students, ${myTeachers.length} teachers`,
  );

  // ── Step 3: 儲存到 AsyncStorage ──
  try {
    await AsyncStorage.multiSet([
      [KEYS.inferredRole, JSON.stringify(roleInference)],
      [KEYS.courseRelations, JSON.stringify(relations)],
      [KEYS.classmates, JSON.stringify(classmates)],
      [KEYS.myStudents, JSON.stringify(myStudents)],
      [KEYS.myTeachers, JSON.stringify(myTeachers)],
      [KEYS.lastRouted, new Date().toISOString()],
    ]);
  } catch (e) {
    console.warn('[postLoginDataRouter] Failed to persist results:', e);
  }

  const elapsed = Date.now() - start;

  const result: PostLoginDataResult = {
    roleInference,
    courseRelations: relations,
    classmates,
    myStudents,
    myTeachers,
    elapsedMs: elapsed,
  };

  // ── Step 4: 廣播到 EventBus ──
  try {
    campusEventBus.emit('post_login_data_routed', {
      role: roleInference.inferredRole,
      courseCount: relations.length,
      classmateCount: classmates.length,
      studentCount: myStudents.length,
      teacherCount: myTeachers.length,
    });

    if (roleInference.inferredRole !== currentRole) {
      campusEventBus.emit('role_updated', {
        previousRole: currentRole,
        newRole: roleInference.inferredRole,
        reason: roleInference.reason,
      });
    }
  } catch (_) { /* EventBus 可能尚未初始化 */ }

  console.log(`[postLoginDataRouter] Completed in ${elapsed}ms`);
  return result;
}

function primaryRoleToUserRole(primary: PrimaryRole): UserRole {
  switch (primary) {
    case 'student':
      return 'student';
    case 'teacher':
      return 'teacher';
    case 'departmentAdmin':
      return 'department';
    case 'admin':
      return 'admin';
    case 'staff':
    case 'shopOwner':
      return 'staff';
    default:
      return 'student';
  }
}

/**
 * 在 buildPostLoginContext 已寫入快取後呼叫：依 PostLoginContext 發 `post_login_context_ready`
 *（與舊版 `post_login_data_routed` 分開，避免同一輪登入重複計數）。
 */
export async function routePostLoginDataWithContext(schoolId: string): Promise<void> {
  const ctx = await getPostLoginContext(schoolId);
  if (!ctx) {
    console.log('[postLoginDataRouter] routePostLoginDataWithContext: no PostLoginContext, skip');
    return;
  }

  const role = primaryRoleToUserRole(ctx.roles.primaryRole);
  const studentCourseCount = ctx.asStudent?.courses.length ?? 0;
  const teachingCount = ctx.asTeacher?.teachingCourses.length ?? 0;
  const courseCount = Math.max(studentCourseCount, teachingCount);
  const pendingN = ctx.asStudent?.pendingAssignments.length ?? 0;
  const studentRosterApprox =
    ctx.asTeacher?.teachingCourses.reduce((n, c) => n + c.studentUids.length, 0) ?? 0;

  try {
    campusEventBus.emit('post_login_context_ready', {
      schoolId,
      role,
      roleSource: ctx.roles.source,
      courseCount,
      pendingAssignmentCount: pendingN,
      teachingCourseCount: teachingCount,
      studentRosterApprox,
      builtAt: ctx.builtAt,
    });
  } catch {
    /* EventBus 可能尚未初始化 */
  }
}

// ═══════════════════════════════════════════════════════
// VI. 讀取快取的結果（供各引擎使用）
// ═══════════════════════════════════════════════════════

/** 取得快取的角色推斷結果 */
export async function getCachedRoleInference(): Promise<RoleInferenceResult | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.inferredRole);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 取得快取的課程關聯 */
export async function getCachedCourseRelations(): Promise<CourseRelation[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.courseRelations);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 取得我的同班同學 */
export async function getCachedClassmates(): Promise<CourseMemberInfo[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.classmates);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 取得我教的學生（教師視角） */
export async function getCachedMyStudents(): Promise<CourseMemberInfo[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.myStudents);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 取得相關教師列表 */
export async function getCachedMyTeachers(): Promise<Array<{ name: string; email: string; courses: string[] }> | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.myTeachers);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 取得特定課程的學生名冊（從快取的 relations 中） */
export async function getCachedCourseStudents(courseCode: string): Promise<CourseMemberInfo[]> {
  const relations = await getCachedCourseRelations();
  if (!relations) return [];
  const rel = relations.find((r) => r.courseCode === courseCode);
  return rel?.students ?? [];
}

/** 判斷使用者是否是某門課的教師 */
export async function isTeacherOfCourse(courseCode: string): Promise<boolean> {
  const relations = await getCachedCourseRelations();
  if (!relations) return false;
  const rel = relations.find((r) => r.courseCode === courseCode);
  return rel?.userRole === 'teacher';
}

/** 清除所有路由快取 */
export async function clearPostLoginCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  } catch (_) { /* ignore */ }
}
