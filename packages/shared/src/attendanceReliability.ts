/** 回應遺失時保留原簽到碼，由既有伺服器交易安全取回同一筆收據。 */
export function attendanceSubmissionIssue(error: unknown): { pending: boolean; rescan: boolean; message: string } {
  const code = String((error as { code?: unknown })?.code ?? '').replace('functions/', '').toLowerCase();
  if (code === 'deadline-exceeded') return {
    pending: false, rescan: true,
    message: '這張簽到碼已過期。請掃描老師現在顯示的 QR Code；若老師還沒換碼，請老師重新開啟點名。',
  };
  if (code === 'permission-denied') return {
    pending: false, rescan: true,
    message: '伺服器沒有接受這次簽到。請確認課程資格，並重新掃描老師目前的 QR Code。',
  };
  if (code === 'unauthenticated') return { pending: false, rescan: false, message: '登入已失效，請重新登入後查詢簽到紀錄。' };
  if (code === 'failed-precondition' || code === 'not-found' || code === 'invalid-argument') return {
    pending: false, rescan: true, message: '這次簽到未完成。請更新課堂、確認老師已開放點名，再重新掃碼。',
  };
  return { pending: true, rescan: false,
    message: '還沒收到伺服器確認，簽到碼已保留。連線穩定後可重送；若剛才已送達，會取回原收據，不會重複點名。' };
}

export function attendanceReceiptTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export type AttendanceReceipt = {
  status: 'present' | 'late' | 'absent' | 'excused';
  checkedInAt: string | null;
  correctedAt: string | null;
  source: 'qr' | 'manual' | null;
};

export function readAttendanceReceipt(
  data: Record<string, unknown>,
  scope: { groupId: string; sessionId: string; userId: string },
): AttendanceReceipt | null {
  const time = (value: unknown) => {
    try {
      const date = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
        ? value.toDate() : value;
      return attendanceReceiptTime(date instanceof Date ? date.toISOString() : date);
    } catch { return null; }
  };
  const checkedInAt = time(data.checkedInAt);
  const correctedAt = time(data.correctedAt);
  const status = data.status;
  if (data.uid !== scope.userId || data.groupId !== scope.groupId || data.sessionId !== scope.sessionId ||
    (status !== 'present' && status !== 'late' && status !== 'absent' && status !== 'excused') ||
    ((status === 'present' || status === 'late') && !checkedInAt) ||
    (data.source != null && data.source !== 'qr' && data.source !== 'manual') ||
    (data.source === 'qr' && status !== 'present' && status !== 'late') ||
    (data.source === 'manual' && !correctedAt)) return null;
  return { status, checkedInAt: status === 'present' || status === 'late' ? checkedInAt : null,
    correctedAt: data.source === 'manual' ? correctedAt : null,
    source: data.source === 'qr' || data.source === 'manual' ? data.source : null };
}

/** 逾時只停止等待，不推論伺服器是否已寫入；重送仍由伺服器核對同一學生與場次。 */
export function awaitAttendanceReceipt<T>(request: Promise<T>, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('尚未收到簽到收據'), {
      code: 'unavailable',
    })), timeoutMs);
    request.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
