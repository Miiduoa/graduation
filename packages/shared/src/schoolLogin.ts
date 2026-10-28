export const SCHOOL_LOGIN_BIND_HINT =
  '此校園尚未開放學號直接登入。你仍可匯入自己取得的課表、成績與活動；Google 帳號用於平台交流與課班服務。';

export const TEACHER_LMS_UNAVAILABLE_CODE = 'teacher_lms_unreachable';
export const TEACHER_LMS_UNAVAILABLE_COPY = '老師登入暫時無法使用';
export const TEACHER_LMS_UNAVAILABLE_COPY_LEGACY = '老師登入暫未開放；學生請輸入純數字學號';

/**
 * 學號登入整段等待：覆蓋「兩跳各接近 15 秒再重試」（15×4=60 秒）加上發 token 緩衝。
 * Web 與 App 共用，避免前端先 abort、後端卻寫入孤兒 session。
 */
export const STUDENT_LOGIN_CLIENT_TIMEOUT_MS = 80_000;

const USABLE_SCHOOL_LOGIN_KINDS = new Set(['school-issued', 'student-id']);

export function hasUsableSchoolLoginProvider(kinds: unknown): boolean {
  if (!Array.isArray(kinds)) return false;
  return kinds.some((kind) => typeof kind === 'string' && USABLE_SCHOOL_LOGIN_KINDS.has(kind));
}

export function isTeacherLmsUnavailableNotice(value: unknown): boolean {
  const text = String(value || '').trim();
  return (
    text === TEACHER_LMS_UNAVAILABLE_CODE ||
    text === TEACHER_LMS_UNAVAILABLE_COPY ||
    text === TEACHER_LMS_UNAVAILABLE_COPY_LEGACY
  );
}
