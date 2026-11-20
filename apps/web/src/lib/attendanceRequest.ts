import { FunctionsUnconfiguredError, isFunctionsUnconfiguredError } from './functionsUrl';

export const ATTENDANCE_REQUEST_TIMEOUT_MS = 25_000;
export const ATTENDANCE_RESULT_UNKNOWN = 'attendance/result-unknown';
export type AttendanceAction = 'startLiveSession' | 'endLiveSession' | 'joinLiveSession' | 'correctAttendanceRecord';
type AttendanceUser = { uid: string; getIdToken: () => Promise<string> };
type RequestOptions = {
  getUser: () => AttendanceUser | null;
  resolveUrl: (name: AttendanceAction) => string;
  expectedUid?: string;
};

export function attendanceRequestError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

// A timeout, a broken response or a server fault cannot prove that a write was rolled back.
export function isAttendanceResultUncertain(error: unknown): boolean {
  if (isFunctionsUnconfiguredError(error)) return false;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return ![
    'functions/unauthenticated', 'functions/permission-denied', 'functions/invalid-argument',
    'functions/not-found', 'functions/failed-precondition', 'functions/aborted',
    'functions/already-exists', 'functions/deadline-exceeded',
  ].includes(code);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function date(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}
function validResult(name: AttendanceAction, value: unknown, input: Record<string, unknown>): boolean {
  if (!object(value) || value.success !== true) return false;
  if (name === 'correctAttendanceRecord') {
    return typeof value.reused === 'boolean' && value.status === input.status;
  }
  if (name === 'joinLiveSession') return typeof value.alreadyJoined === 'boolean' && date(value.checkedInAt);
  if (name === 'startLiveSession') {
    return typeof value.sessionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)
      && typeof value.qrToken === 'string' && value.qrToken.length > 0
      && typeof value.active === 'boolean' && date(value.qrExpiresAt);
  }
  return true;
}

export async function requestAttendance<T>(
  name: AttendanceAction,
  input: Record<string, unknown>,
  options: RequestOptions,
): Promise<T> {
  const user = options.getUser();
  if (!user || (options.expectedUid !== undefined && user.uid !== options.expectedUid)) {
    throw attendanceRequestError('登入狀態已變更，請以原帳號核對紀錄。', 'functions/unauthenticated');
  }
  const actorUid = user.uid;
  const url = options.resolveUrl(name);
  const body = JSON.stringify({ data: input });
  const controller = new AbortController();
  const unknownResult = () => attendanceRequestError(
    '尚未收到完整確認，伺服器可能已保存。請確認原操作結果，不要另建一筆。',
    ATTENDANCE_RESULT_UNKNOWN,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject independently: an SDK token refresh or a mocked fetch may ignore abort.
      reject(unknownResult());
      controller.abort();
    }, ATTENDANCE_REQUEST_TIMEOUT_MS);
  });
  const operation = async (): Promise<T> => {
    const idToken = await user.getIdToken();
    // A token arriving after the deadline must not start a previously unsent write.
    if (controller.signal.aborted) throw unknownResult();
    if (options.getUser()?.uid !== actorUid) {
      throw attendanceRequestError('登入狀態已變更，請重新核對。', 'functions/unauthenticated');
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    if (controller.signal.aborted) throw unknownResult();
    if (options.getUser()?.uid !== actorUid) throw unknownResult();
    if (!object(payload)) throw unknownResult();
    const error = object(payload.error) ? payload.error : null;
    const message = error && typeof error.message === 'string' ? error.message : '';
    // A generic HTTP 503 is a temporary server fault, not evidence of missing configuration.
    if (error && /尚未啟用/.test(message)) throw new FunctionsUnconfiguredError('點名尚未啟用');
    if (!response.ok || payload.error) {
      const status = error && typeof error.status === 'string'
        ? error.status.toLowerCase().replaceAll('_', '-') : 'unknown';
      // Proxy/gateway 5xx responses remain ambiguous. Only the callable's QR-expiry
      // response has the distinct deadline-exceeded meaning used by the join flow.
      if ((response.status >= 500 || status === 'deadline-exceeded') && !(name === 'joinLiveSession' && status === 'deadline-exceeded')) {
        throw unknownResult();
      }
      throw attendanceRequestError(message || '無法確認操作結果。', `functions/${status}`);
    }
    const result = payload.result ?? payload.data;
    if (!validResult(name, result, input)) throw unknownResult();
    return result as T;
  };
  try {
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    if (isAttendanceResultUncertain(error)) throw unknownResult();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
