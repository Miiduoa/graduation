/** 學生 e 校園驗證單次逾時下限；可用 PU_STUDENT_LOGIN_TIMEOUT_MS 再拉長，不可低於此值。 */
export const MIN_STUDENT_PORTAL_TIMEOUT_MS = 15_000;
export const MAX_STUDENT_PORTAL_TIMEOUT_MS = 60_000;

/** 登入後背景 TronClass／CAS 總預算；與 e 校園逾時分開，可用 PU_STUDENT_LMS_TIMEOUT_MS。 */
export const DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS = 30_000;
export const MIN_STUDENT_LMS_TOTAL_TIMEOUT_MS = 15_000;
export const MAX_STUDENT_LMS_TOTAL_TIMEOUT_MS = 120_000;

/** 背景 TronClass／CAS 單跳上限；可用 PU_STUDENT_LMS_HOP_TIMEOUT_MS。 */
export const DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS = 15_000;
export const MIN_STUDENT_LMS_HOP_TIMEOUT_MS = 1_000;

/** 同一組密碼對學校送出帳密 POST 的上限（含雙 UID 備援與逾時重試）。 */
export const MAX_STUDENT_CREDENTIAL_POSTS = 2;

/**
 * 前端學號登入整段等待：覆蓋「兩跳各接近 15 秒再重試」（15×4=60 秒）加上發 token 緩衝。
 * 必須大於伺服器最長 submit，避免前端先 abort、後端卻寫入孤兒 session。
 */
export const STUDENT_LOGIN_CLIENT_TIMEOUT_MS =
  MIN_STUDENT_PORTAL_TIMEOUT_MS * MAX_STUDENT_CREDENTIAL_POSTS * 2 + 20_000;

export function studentPortalTimeoutMs(
  raw: string | undefined = process.env.PU_STUDENT_LOGIN_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return MIN_STUDENT_PORTAL_TIMEOUT_MS;
  return Math.min(
    MAX_STUDENT_PORTAL_TIMEOUT_MS,
    Math.max(MIN_STUDENT_PORTAL_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function studentLmsTotalTimeoutMs(
  raw: string | undefined = process.env.PU_STUDENT_LMS_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS;
  return Math.min(
    MAX_STUDENT_LMS_TOTAL_TIMEOUT_MS,
    Math.max(MIN_STUDENT_LMS_TOTAL_TIMEOUT_MS, Math.trunc(parsed)),
  );
}

export function studentLmsHopTimeoutMs(
  raw: string | undefined = process.env.PU_STUDENT_LMS_HOP_TIMEOUT_MS,
  totalMs: number = studentLmsTotalTimeoutMs(),
): number {
  const parsed = Number(raw);
  const fallback = Math.min(DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS, totalMs);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(totalMs, Math.max(MIN_STUDENT_LMS_HOP_TIMEOUT_MS, Math.trunc(parsed)));
}
