import { httpsCallable } from 'firebase/functions';

import { getAuthInstance, getFunctionsInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';
import type { UserRole } from '../state/auth';
import { loadMockAuthSession } from './mockAuth';
import { isTestAccount } from './testSeedData';
import { getPUSession } from './studentIdAuth';
import { getTCBackendSessionId } from './tronClassClient';

export type FinalizePostLoginResolved = {
  primaryRole: string;
  roles: string[];
  teachingRoles: string[];
  orgRoles: string[];
  confidence: string;
  reasons: string[];
  usedAuthoritativeUserRole: boolean;
};

export type FinalizePostLoginResponse = {
  success: boolean;
  runId?: string;
  resolved?: FinalizePostLoginResolved;
  summaries?: { puCourseCount?: number; tcCourseCount?: number; rosterCourses?: number };
  context?: {
    user: { uid: string; email?: string | null };
    schoolId?: string | null;
    courses: Array<{
      id: string;
      code: string;
      name: string;
      source: string;
      role?: string;
      teacherUids: string[];
      studentUids: string[];
    }>;
    puCoursesSample?: Array<{ code?: string; name?: string; teacherEmail?: string | null }>;
  };
};

/** 各引擎 initFromPostLoginContext 使用的精簡 payload */
export type PostLoginEngineBootstrap = {
  uid: string;
  schoolId?: string | null;
  primaryRole: UserRole;
  runId?: string | null;
  postLoginRoles?: string[];
  courseLiteCount?: number;
};

let lastBootstrap: PostLoginEngineBootstrap | null = null;

export function getLastPostLoginEngineBootstrap(): PostLoginEngineBootstrap | null {
  return lastBootstrap;
}

export function setLastPostLoginEngineBootstrap(b: PostLoginEngineBootstrap | null): void {
  lastBootstrap = b;
}

/**
 * 呼叫後端 finalizePostLogin（需已 Firebase 登入且具 PU session）。
 */
export async function tryCallFinalizePostLogin(
  semester?: string,
): Promise<FinalizePostLoginResponse | null> {
  if (!hasUsableFirebaseConfig() || isFirebaseMockMode()) return null;

  const mock = await loadMockAuthSession().catch(() => null);
  if (mock && isTestAccount(mock.uid)) return null;

  const authUser = getAuthInstance().currentUser;
  if (!authUser) return null;

  const puSessionId = getPUSession()?.backendSessionId?.trim();
  if (!puSessionId) return null;

  const tronSessionId = (await getTCBackendSessionId())?.trim() || undefined;

  try {
    const fn = httpsCallable<
      { puSessionId: string; tronSessionId?: string; semester?: string },
      FinalizePostLoginResponse
    >(getFunctionsInstance(), 'finalizePostLogin');
    const res = await fn({
      puSessionId,
      ...(tronSessionId ? { tronSessionId } : {}),
      ...(semester?.trim() ? { semester: semester.trim() } : {}),
    });
    const data = res.data as FinalizePostLoginResponse | undefined;
    return data ?? null;
  } catch (e) {
    console.warn('[finalizePostLoginClient] callable failed:', e);
    return null;
  }
}
