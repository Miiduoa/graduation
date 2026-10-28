import {
  STUDENT_LOGIN_CLIENT_MARGIN_MS,
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS,
} from '@campus/shared/src/schoolLogin';

/** 學生 e 校園驗證單次逾時下限；可用 PU_STUDENT_LOGIN_TIMEOUT_MS 再拉長，不可低於此值。 */
export const MIN_STUDENT_PORTAL_TIMEOUT_MS = 15_000;
export const MAX_STUDENT_PORTAL_TIMEOUT_MS = 60_000;
export {
  LMS_CONNECTING_CODE,
  MAX_TRANSIENT_HOP_RETRIES,
  STUDENT_LMS_CONNECTING_WINDOW_MS,
  STUDENT_LOGIN_CLIENT_MARGIN_MS,
  STUDENT_LOGIN_CLIENT_TIMEOUT_MS,
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS,
} from '@campus/shared/src/schoolLogin';

/** 登入後背景 TronClass／CAS 總預算；與 e 校園逾時分開，可用 PU_STUDENT_LMS_TIMEOUT_MS。 */
export const DEFAULT_STUDENT_LMS_TOTAL_TIMEOUT_MS = 30_000;
export const MIN_STUDENT_LMS_TOTAL_TIMEOUT_MS = 15_000;
export const MAX_STUDENT_LMS_TOTAL_TIMEOUT_MS = 120_000;

/** 背景 TronClass／CAS 單跳上限；可用 PU_STUDENT_LMS_HOP_TIMEOUT_MS。 */
export const DEFAULT_STUDENT_LMS_HOP_TIMEOUT_MS = 15_000;
export const MIN_STUDENT_LMS_HOP_TIMEOUT_MS = 1_000;

/** 同一組密碼對學校送出帳密 POST 的上限（含雙 UID 備援與逾時重試）。 */
export const MAX_STUDENT_CREDENTIAL_POSTS = 2;

/** 背景 SSO 進行中視窗：SSO 總預算再加前端餘裕。SSO 確定失敗時應清掉 connecting 標記。 */
export function studentLmsConnectingWindowMs(
  totalMs: number = studentLmsTotalTimeoutMs(),
): number {
  return totalMs + STUDENT_LOGIN_CLIENT_MARGIN_MS;
}

/** 學號登入整條牆鐘總預算；單跳逾時不可把整條撐過這個上限。 */
export function studentLoginTotalTimeoutMs(): number {
  return STUDENT_LOGIN_TOTAL_TIMEOUT_MS;
}

export function studentLoginHopTimeoutMs(
  hopMs: number = studentPortalTimeoutMs(),
  remainingMs: number = studentLoginTotalTimeoutMs(),
): number {
  return Math.max(1, Math.min(hopMs, remainingMs));
}

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
