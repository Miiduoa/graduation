export type AttendanceScope = {
  uid: string;
  groupId: string;
  sessionId: string;
};

export type LiveAttendanceReceipt = AttendanceScope & {
  status: 'present' | 'late';
  checkedInAt: string;
  alreadyRecorded: boolean;
};

/** Only an acknowledgement for this account, course and session may update the UI. */
export function parseLiveAttendanceReceipt(
  value: unknown,
  expected: AttendanceScope,
): LiveAttendanceReceipt | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!expected.uid || !expected.groupId || !expected.sessionId ||
      data.success !== true || data.valid !== true || data.attendanceRecorded !== true ||
      typeof data.alreadyRecorded !== 'boolean' ||
      data.uid !== expected.uid || data.groupId !== expected.groupId || data.sessionId !== expected.sessionId ||
      (data.status !== 'present' && data.status !== 'late')) return null;
  if (typeof data.checkedInAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.checkedInAt)) return null;
  const time = Date.parse(data.checkedInAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== data.checkedInAt) return null;
  return {
    ...expected, status: data.status, checkedInAt: data.checkedInAt,
    alreadyRecorded: data.alreadyRecorded,
  };
}

function validPathSegment(value: string): boolean {
  // Server repeats validation with a UTF-8 byte limit. No LMS prefixes are removed here.
  return value.length > 0 && value.length <= 128 && value.trim() === value &&
    Array.from(value).every((char) => char !== '/' && char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && value !== '.' && value !== '..' && !/^__.*__$/u.test(value);
}

export function buildLiveAttendanceRequest(
  scope: AttendanceScope,
  pastedToken: string,
): { groupId: string; sessionId: string; qrToken: string } | null {
  const qrToken = pastedToken.trim();
  if (!scope.uid || !validPathSegment(scope.groupId) || !validPathSegment(scope.sessionId) ||
      qrToken.length < 16 || qrToken.length > 512 || /\s/u.test(qrToken)) return null;
  // Identity and time are never supplied as authority by the client.
  return { groupId: scope.groupId, sessionId: scope.sessionId, qrToken };
}

export function liveAttendanceErrorMessage(error: unknown): string {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code).replace(/^functions\//, '') : '';
  switch (code) {
    case 'unauthenticated': return '登入已失效，請重新登入後再簽到。';
    case 'permission-denied': return '帳號沒有這門課的簽到資格，或 QR 內容不正確。請向授課老師確認。';
    case 'deadline-exceeded': return '這組 QR 已過期，請向老師取得有效的 QR。';
    case 'not-found': return '找不到進行中的課程點名，請確認課程與點名編號。';
    case 'failed-precondition': return '這次點名或既有紀錄需要老師確認。舊版點名需由老師重新開啟。';
    case 'invalid-argument': return '請填入完整點名編號與 QR 內容；六位示範碼不適用於正式簽到。';
    default: return '尚未收到伺服器確認。請重試；若上一次已成功，會讀回原本紀錄，不會再次計數。';
  }
}
