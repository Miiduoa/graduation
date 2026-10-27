export type AttendanceQrScope = { groupId: string; sessionId: string };
export type AttendanceQrResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

const invalid = '這不是可用的課堂簽到碼，請對準老師目前顯示的 QR Code。';

/** 只辨識目前課程與場次；掃碼不等於完成簽到。 */
export function parseAttendanceQr(raw: string, scope: AttendanceQrScope): AttendanceQrResult {
  if (typeof raw !== 'string' || raw.length > 2048 || !scope.groupId || !scope.sessionId) {
    return { ok: false, message: invalid };
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: invalid };
    const value = data as Record<string, unknown>;
    const validId = (id: unknown): id is string => typeof id === 'string' &&
      id.length > 0 && id.length <= 256 && !/[\s/]/u.test(id) && id !== '.' && id !== '..';
    if (!validId(value.groupId) || !validId(value.sessionId) || typeof value.qrToken !== 'string' ||
      !value.qrToken || value.qrToken.length > 512 || /\s/u.test(value.qrToken) ||
      value.qrToken.split('').some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return { ok: false, message: invalid };
    }
    if (value.groupId !== scope.groupId) {
      return { ok: false, message: '這是另一堂課的簽到碼，請確認目前開啟的課程。' };
    }
    if (value.sessionId !== scope.sessionId) {
      return { ok: false, message: '這不是本次點名的簽到碼，請更新頁面或掃描老師目前顯示的 QR Code。' };
    }
    return { ok: true, token: value.qrToken };
  } catch {
    return { ok: false, message: invalid };
  }
}

export function attendanceCameraError(problem: unknown): string {
  const name = problem && typeof problem === 'object' && 'name' in problem ? problem.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '尚未允許相機權限。請在瀏覽器設定中允許相機，或改用下方簽到碼。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '這台裝置沒有可用的相機，請改用下方簽到碼。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '相機可能被其他程式使用，請關閉其他相機程式後重試，或輸入簽到碼。';
  }
  return '暫時無法使用相機掃碼。請重新開啟，或改用下方簽到碼。';
}
