export const PROVIDENCE_SCHOOL_ID = 'pu';

const STUDENT_ID = /^[0-9]{9,10}$/;
const TEACHER_ACCOUNT = /^[A-Za-z][A-Za-z0-9._-]{1,31}$/;

export function normalizePuAccount(value: unknown): string {
  return String(value || '').trim();
}

export function normalizePuStudentId(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase();
}

export function isPuStudentId(studentId: string): boolean {
  return STUDENT_ID.test(studentId);
}

export function isPuTeacherAccount(account: string): boolean {
  return TEACHER_ACCOUNT.test(account) && !STUDENT_ID.test(account);
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
