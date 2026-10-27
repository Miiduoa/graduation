export const PROVIDENCE_SCHOOL_ID = 'pu';

/** 學號（9–10 碼）或靜宜帳號去掉 s 後的數字（7–8 碼）。 */
const STUDENT_DIGITS = /^[0-9]{7,10}$/;
const STUDENT_S_PREFIX = /^[sS]([0-9]{7,10})$/;
const STUDENT_EMAIL = /^([0-9]{7,10})@pu\.edu\.tw$/i;
const STUDENT_S_EMAIL = /^[sS]([0-9]{7,10})@pu\.edu\.tw$/i;
const TEACHER_ACCOUNT = /^[A-Za-z][A-Za-z0-9._-]{1,31}$/;

export function normalizePuAccount(value: unknown): string {
  return String(value || '').trim();
}

export function normalizePuStudentId(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

export function canonicalizePuStudentId(value: unknown): string | null {
  const raw = normalizePuAccount(value);
  const digits =
    STUDENT_DIGITS.exec(raw)?.[0] ||
    STUDENT_S_PREFIX.exec(raw)?.[1] ||
    STUDENT_EMAIL.exec(raw)?.[1] ||
    STUDENT_S_EMAIL.exec(raw)?.[1] ||
    null;
  return digits;
}

export function isPuStudentId(studentId: string): boolean {
  return STUDENT_DIGITS.test(studentId);
}

export function isPuTeacherAccount(account: string): boolean {
  if (canonicalizePuStudentId(account)) return false;
  return TEACHER_ACCOUNT.test(account);
}

/**
 * e 校園登入表單的 uid 沒有 maxlength 或 pattern，官方說明帳號欄只填靜宜帳號、不要加
 * @pu.edu.tw。有 s 前綴時先送小寫 s＋數字；否則先送數字。帳密錯誤時可再試另一種一次。
 */
export function providenceAlcatUidCandidates(rawAccount: string): string[] {
  const digits = canonicalizePuStudentId(rawAccount);
  if (!digits) return [];
  const local = normalizePuAccount(rawAccount).split('@')[0] ?? '';
  const withS = `s${digits}`;
  const withoutS = digits;
  return /^s/i.test(local) ? [withS, withoutS] : [withoutS, withS];
}

export function buildPuStudentUid(studentId: string): string {
  return `pu-${studentId.toLowerCase()}`;
}

export function buildPuTeacherUid(account: string): string {
  return `pu-t-${account.toLowerCase()}`;
}

export function buildPuStudentEmail(studentId: string): string {
  return `${studentId.toLowerCase()}@pu.edu.tw`;
}

export function buildPuTeacherEmail(account: string): string {
  if (account.includes('@')) return account.toLowerCase();
  return `${account.toLowerCase()}@pu.edu.tw`;
}

export function assertOnlyProvidence(schoolId: unknown): void {
  if (schoolId === undefined || schoolId === null || schoolId === '') return;
  if (String(schoolId).trim().toLowerCase() !== PROVIDENCE_SCHOOL_ID) {
    throw new Error('only-pu');
  }
}
