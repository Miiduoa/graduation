import { isProvidenceSchoolId, toPublicSchoolId } from '../../data/schoolIds';
import type { Grade } from '../../data/types';

/** 以 shared schoolIds 正規化後比對，不靠名稱字串猜測。 */
export function isProvidenceUniversitySchool(schoolId?: string | null): boolean {
  return isProvidenceSchoolId(schoolId);
}

export function sameCreditSchoolId(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const left = toPublicSchoolId(a) ?? a;
  const right = toPublicSchoolId(b) ?? b;
  return left === right;
}

function isSchoolOfficialSource(grade: Grade): boolean {
  return grade.gradeSource === 'school-official' || grade.gradeSource === 'school-official-offline';
}

/**
 * 只接受屬於目前帳號與目前學校的成績列。
 * - 校務 adapter 列：須帶權威 schoolId + school-official* 來源語意（可不含 publishedAt）
 * - Firebase 課程列（含讀取邊界標成 firebase-course）／未知來源：須有 schoolId + 真實 publishedAt，且不晚於現在
 * 文件內自帶的 gradeSource 字串不是所有權證明；firebaseSource 已剝離偽造 school-official*。
 * 不把缺欄位的任意列盲補成目前學校，也不捏造發布時間。
 */
export function filterScopedGrades(
  rows: Grade[] | null | undefined,
  uid: string,
  schoolId: string,
  nowMs: number = Date.now(),
): Grade[] {
  if (!uid || !schoolId || !Array.isArray(rows)) return [];
  return rows.filter((grade) => {
    if (!grade || typeof grade !== 'object') return false;
    if (grade.userId !== uid) return false;
    if (typeof grade.schoolId !== 'string' || !grade.schoolId) return false;
    if (!sameCreditSchoolId(grade.schoolId, schoolId)) return false;

    if (isSchoolOfficialSource(grade)) {
      return true;
    }

    // Firebase 課程成績／無校務收據：必須有真實發布時間
    if (!grade.publishedAt || typeof grade.publishedAt !== 'string') return false;
    const published = Date.parse(grade.publishedAt);
    return Number.isFinite(published) && published <= nowMs;
  });
}

/** 是否含離線／過期校務快取列（UI 不得標成即時校方更新）。 */
export function hasOfflineSchoolCache(grades: Grade[]): boolean {
  return grades.some((g) => g.gradeSource === 'school-official-offline');
}
