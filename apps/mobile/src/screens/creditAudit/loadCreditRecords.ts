import { getDataSource, hasDataSource } from '../../data';
import type { Grade } from '../../data/types';
import { computeReferenceGpa } from './creditMath';
import { filterScopedGrades, hasOfflineSchoolCache } from './gradeScope';

export type GpaSnapshot = {
  gpa: number;
  totalCredits: number;
  totalPoints: number;
  retakeCollapsed: number;
};

export type CreditLoadSuccess = {
  ok: true;
  grades: Grade[];
  gpa: GpaSnapshot | null;
  gpaUnavailable: boolean;
  /** 實際成功取回紀錄的本地讀取時間（非校方正式更新時間） */
  readAt: number;
  /** 含離線／過期校務快取；不得標成即時校方更新 */
  fromOfflineSchoolCache: boolean;
};

export type CreditLoadFailure = {
  ok: false;
  errorMessage: string;
  /** 無資料來源時也視為可重試／不可用，而非空白成績 */
  reason: 'no-source' | 'no-session' | 'read-failed';
};

export type CreditLoadResult = CreditLoadSuccess | CreditLoadFailure;

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/**
 * 單一載入路徑：成績失敗整包錯誤；參考 GPA 僅由已接受列推導，不再呼叫未受範圍驗證的 getGPA。
 * 絕不把讀取失敗偽裝成空成績或 GPA 0。
 */
export async function loadCreditRecords(args: {
  uid: string | null | undefined;
  schoolId: string | null | undefined;
}): Promise<CreditLoadResult> {
  const uid = args.uid?.trim() || '';
  const schoolId = args.schoolId?.trim() || '';
  if (!uid) {
    return { ok: false, errorMessage: '請先登入後再查看修課紀錄。', reason: 'no-session' };
  }
  if (!schoolId) {
    return {
      ok: false,
      errorMessage: '目前學校尚未確認，無法讀取此校修課紀錄。',
      reason: 'no-session',
    };
  }
  if (!hasDataSource()) {
    return {
      ok: false,
      errorMessage: '目前沒有可用的成績資料來源，請稍後再試。',
      reason: 'no-source',
    };
  }

  const ds = getDataSource();
  let rawGrades: Grade[];
  try {
    rawGrades = await ds.listGrades(uid, undefined, schoolId);
  } catch (error) {
    return {
      ok: false,
      errorMessage: messageOf(error, '讀取修課紀錄失敗，請稍後再試。'),
      reason: 'read-failed',
    };
  }

  const grades = filterScopedGrades(rawGrades, uid, schoolId);
  const reference = computeReferenceGpa(grades);
  const gpa: GpaSnapshot | null = reference
    ? {
        gpa: reference.gpa,
        totalCredits: reference.totalCredits,
        totalPoints: reference.totalPoints,
        retakeCollapsed: reference.retakeCollapsed,
      }
    : null;

  return {
    ok: true,
    grades,
    gpa,
    // 有修課列卻算不出參考 GPA 才標不可用；真正空成功不假裝 GPA 失敗
    gpaUnavailable: grades.length > 0 && gpa === null,
    readAt: Date.now(),
    fromOfflineSchoolCache: hasOfflineSchoolCache(grades),
  };
}
