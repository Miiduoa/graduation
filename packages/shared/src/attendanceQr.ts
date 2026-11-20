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
    let data: unknown;
    if (raw.trim().startsWith('{')) data = JSON.parse(raw);
    else {
      const url = new URL(raw);
      if (url.protocol !== 'campusone:' || url.hostname !== 'classroom' || url.pathname !== '/join')
        return { ok: false, message: invalid };
      data = { groupId: url.searchParams.get('groupId'), sessionId: url.searchParams.get('sessionId'), qrToken: url.searchParams.get('token') };
    }
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
