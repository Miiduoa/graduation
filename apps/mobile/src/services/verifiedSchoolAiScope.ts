import { isProvidenceSchoolId } from '@campus/shared/src/schoolIds';
import type { PostLoginContext } from '../data/postLoginTypes';
import { getInMemoryPostLoginContext } from './postLoginContextHolder';

export type VerifiedSchoolAiScope = Readonly<{
  context: PostLoginContext;
  assertCurrent: () => void;
}>;

let activeScope: VerifiedSchoolAiScope | null = null;

export function revokeVerifiedSchoolAiScope(): void {
  activeScope = null;
}

/** 由成功的學校登入綁定，其檢查包含登入輪次、Firebase 使用者與校務 session。 */
export function bindVerifiedSchoolAiScope(context: PostLoginContext, assertCurrent: () => void): void {
  if (context.origin !== 'verified-school-login' || !isProvidenceSchoolId(context.schoolId)) return;
  assertCurrent();
  if (getInMemoryPostLoginContext() !== context) return;
  activeScope = { context, assertCurrent };
}

export function isVerifiedSchoolAiScopeCurrent(scope: VerifiedSchoolAiScope): boolean {
  const current = getInMemoryPostLoginContext();
  // 個人資料刷新會經 JSON 還原同一份 PLC，登入輪次仍由 assertCurrent 驗證。
  if (activeScope !== scope || !current || current.origin !== scope.context.origin ||
      current.uid !== scope.context.uid || current.schoolId !== scope.context.schoolId ||
      current.builtAt !== scope.context.builtAt) return false;
  try {
    scope.assertCurrent();
    return true;
  } catch {
    return false;
  }
}

export function getVerifiedSchoolAiScope(identity?: {
  schoolId: string;
  userId?: string | null;
}): VerifiedSchoolAiScope | null {
  const scope = activeScope;
  if (!scope || !identity?.userId || scope.context.uid !== identity.userId ||
      scope.context.schoolId !== identity.schoolId || !isVerifiedSchoolAiScopeCurrent(scope)) return null;
  return scope;
}
