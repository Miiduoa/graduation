export const SCHOOL_LOGIN_BIND_HINT =
  '目前只能用 Google 帳號登入，登入後再綁定你的學校。';

const USABLE_SCHOOL_LOGIN_KINDS = new Set(['school-issued', 'student-id']);

export function hasUsableSchoolLoginProvider(kinds: unknown): boolean {
  if (!Array.isArray(kinds)) return false;
  return kinds.some((kind) => typeof kind === 'string' && USABLE_SCHOOL_LOGIN_KINDS.has(kind));
}
