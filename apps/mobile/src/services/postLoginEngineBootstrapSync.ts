import type { PostLoginContext, PrimaryRole } from '../data/postLoginTypes';
import type { UserRole } from '../data/types';
import type { PostLoginEngineBootstrap } from './postLoginBootstrapStore';
import { getLastPostLoginEngineBootstrap } from './postLoginBootstrapStore';

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

/** 將 PostLoginContext 與最近一次 finalize bootstrap 合併後餵給各引擎 */
export function syncEnginesFromPostLoginContext(ctx: PostLoginContext | null): void {
  if (!ctx) return;
  const prev = getLastPostLoginEngineBootstrap();
  const primaryRole = primaryRoleToUserRole(ctx.roles.primaryRole);
  const sub = ctx.roles.subRoles?.length ? ctx.roles.subRoles.map(String) : undefined;
  const bootstrap: PostLoginEngineBootstrap = {
    uid: ctx.uid,
    schoolId: ctx.schoolId,
    primaryRole,
    runId: prev?.runId ?? null,
    postLoginRoles: prev?.postLoginRoles?.length ? prev.postLoginRoles : sub,
    courseLiteCount:
      (ctx.asStudent?.courses.length ?? 0) + (ctx.asTeacher?.teachingCourses.length ?? 0) || undefined,
    finalizeOk: prev?.finalizeOk,
    finalizeFailed: prev?.finalizeFailed,
    finalizeSkipped: prev?.finalizeSkipped,
    errorCode: prev?.errorCode,
    errorMessage: prev?.errorMessage,
    bootstrapAt: prev?.bootstrapAt,
  };
  // 延遲 require，避免 aiAppContext → holder → 本模組 在 Jest 等環境靜態拉入 tronClassClient / firebase
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initFromPostLoginContext: initAttendance } = require('./smartAttendanceEngine') as {
      initFromPostLoginContext: (b: PostLoginEngineBootstrap) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initFromPostLoginContext: initStudyBuddy } = require('./studyBuddyEngine') as {
      initFromPostLoginContext: (b: PostLoginEngineBootstrap) => void;
    };
    initAttendance(bootstrap);
    initStudyBuddy(bootstrap);
  } catch (e) {
    console.warn('[postLoginEngineBootstrapSync] engine init skipped:', e);
  }
}
