export const SCHOOL_LOGIN_BIND_HINT = '先用 Google 登入，再綁定學校';

const USABLE_SCHOOL_LOGIN_KINDS = new Set(['school-issued', 'student-id']);

export function hasUsableSchoolLoginProvider(kinds: unknown): boolean {
  if (!Array.isArray(kinds)) return false;
  return kinds.some((kind) => typeof kind === 'string' && USABLE_SCHOOL_LOGIN_KINDS.has(kind));
}
