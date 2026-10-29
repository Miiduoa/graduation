export const SCHOOL_LOGIN_BIND_HINT =
  '此校園尚未開放學號直接登入。你仍可匯入自己取得的課表、成績與活動；Google 帳號用於平台交流與課班服務。';

export const TEACHER_LMS_UNAVAILABLE_CODE = 'teacher_lms_unreachable';
export const TEACHER_LMS_UNAVAILABLE_COPY = '老師登入暫時無法使用';
export const TEACHER_LMS_UNAVAILABLE_COPY_LEGACY = '老師登入暫未開放；學生請輸入純數字學號';

/** 後端學號登入整條（home／submit／redirect／verify 與單跳重試）的牆鐘總預算。超過回 503、不寫 session。 */
export const STUDENT_LOGIN_TOTAL_TIMEOUT_MS = 60_000;
/** 前端等待需大於總預算的餘裕，避免先 abort、後端卻寫入孤兒 session。 */
export const STUDENT_LOGIN_CLIENT_MARGIN_MS = 15_000;
/**
 * 學號登入整段等待：大於後端總預算並留餘裕。Web 與 App 共用。
 */
export const STUDENT_LOGIN_CLIENT_TIMEOUT_MS =
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS + 20_000;

/** 登入後背景 WOW Class 仍在進行時，課程 API 回傳的 details.code。 */
export const LMS_CONNECTING_CODE = 'lms-connecting';
/** e 校園／成績系統暫時無法從伺服器連線時，學術 API 的 details.code。 */
export const OFFICIAL_CAMPUS_UNAVAILABLE_CODE = 'official-campus-unavailable';
export const OFFICIAL_GRADES_UNAVAILABLE_COPY = '官方成績暫時無法取得';
export const OFFICIAL_COURSES_UNAVAILABLE_COPY = '官方課表暫時無法取得';
/** 學校防火牆封鎖頁或轉送 555 時標記主機。 */
export const CAMPUS_HOST_BLOCKED_CODE = 'campus_blocked';
/**
 * 登入後視為 WOW Class 背景連線進行中的預設最長時間。
 * 對齊背景 SSO 預設總預算 30 秒再加前端餘裕，避免窗口比 SSO 長太多。
 */
export const STUDENT_LMS_CONNECTING_WINDOW_MS = 45_000;
/** 暫時性錯誤時，同一跳（不含帳密 POST）最多再試幾次。 */
export const MAX_TRANSIENT_HOP_RETRIES = 2;

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
