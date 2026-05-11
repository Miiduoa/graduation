import { httpsCallable } from 'firebase/functions';
import type { FunctionsError } from 'firebase/functions';

import { getAuthInstance, getFunctionsInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';
import { loadMockAuthSession } from './mockAuth';
import { isTestAccount } from './testSeedData';
import { getPUSession } from './studentIdAuth';
import { getTCBackendSessionId } from './tronClassClient';
import type { PostLoginEngineBootstrap } from './postLoginBootstrapStore';
import {
  getLastPostLoginEngineBootstrap,
  setLastPostLoginEngineBootstrap,
} from './postLoginBootstrapStore';

export type { PostLoginEngineBootstrap };
export { getLastPostLoginEngineBootstrap, setLastPostLoginEngineBootstrap };

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
  /** Callable / 前檢失敗時有值 */
  errorCode?: string;
  errorMessage?: string;
  runId?: string;
  resolved?: FinalizePostLoginResolved;
  summaries?: {
    puCourseCount?: number;
    tcCourseCount?: number;
    rosterCourses?: number;
    partial?: boolean;
    sourcesUsed?: {
      pu?: boolean;
      tronCourses?: boolean;
      tronProfile?: boolean;
      rosters?: boolean;
    };
    puCoursesFailed?: boolean;
    tronCoursesFailed?: boolean;
    tronRostersFailed?: boolean;
  };
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

function parseCallableError(e: unknown): { code: string; message: string } {
  const fe = e as Partial<FunctionsError> & { message?: string };
  const raw = typeof fe?.code === 'string' ? fe.code : 'unknown';
  const code = raw.replace(/^functions\//, '');
  const message =
    typeof fe?.message === 'string' && fe.message.trim() ? fe.message.trim() : 'finalizePostLogin failed';
  return { code, message };
}

/**
 * 呼叫後端 finalizePostLogin（需已 Firebase 登入且具 PU session）。
 * 失敗時回傳 `{ success: false, errorCode, errorMessage }`，不拋出。
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
  if (!puSessionId) {
    return { success: false, errorCode: 'missing_pu_session', errorMessage: 'No PU backend session' };
  }

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
    return data ?? { success: false, errorCode: 'empty_response', errorMessage: 'No data from finalizePostLogin' };
  } catch (e) {
    const { code, message } = parseCallableError(e);
    console.warn('[finalizePostLoginClient] callable failed:', e);
    return { success: false, errorCode: code, errorMessage: message };
  }
}
