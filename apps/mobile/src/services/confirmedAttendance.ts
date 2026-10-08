/** Validate a server receipt before the UI or companion can report a check-in. */
export type QrAttendanceRequest = {
  courseSpaceId: string;
  sessionId: string;
  qrToken?: string;
  uid?: string;
};

export type AttendanceReceipt = {
  success: true;
  attendanceRecorded: true;
  status: 'present' | 'late';
  uid: string;
  courseId: string;
  sessionId: string;
  checkedInAt: string;
  alreadyRecorded: boolean;
};

type Dependencies = {
  invoke: (payload: {
    courseId: string;
    sessionId: string;
    claim: { token: string; uid?: string };
  }) => Promise<unknown>;
  onConfirmed: (receipt: AttendanceReceipt) => void | Promise<void>;
};

export async function confirmQrAttendance(
  input: QrAttendanceRequest,
  dependencies: Dependencies,
): Promise<AttendanceReceipt> {
  if (!input.courseSpaceId?.trim() || !input.sessionId?.trim() || !input.qrToken?.trim()) {
    throw new Error('請提供課程、點名場次與完整的 QR 簽到碼。');
  }
  const payload = await dependencies.invoke({
    courseId: input.courseSpaceId,
    sessionId: input.sessionId,
    claim: { token: input.qrToken, ...(input.uid ? { uid: input.uid } : {}) },
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('伺服器尚未確認簽到，請重試或聯絡授課老師。');
  }
  const result = payload as Record<string, unknown>;
  if (result.valid !== true || result.attendanceRecorded !== true
      || (result.status !== 'present' && result.status !== 'late')
      || typeof result.uid !== 'string' || !result.uid.trim()
      || (input.uid !== undefined && result.uid !== input.uid)
      || result.courseId !== input.courseSpaceId || result.sessionId !== input.sessionId
      || typeof result.checkedInAt !== 'string' || !Number.isFinite(Date.parse(result.checkedInAt))
      || typeof result.alreadyRecorded !== 'boolean') {
    throw new Error('簽到回應未通過核對，未標記完成。');
  }
  const receipt: AttendanceReceipt = {
    success: true, attendanceRecorded: true, status: result.status,
    uid: result.uid, courseId: input.courseSpaceId, sessionId: input.sessionId,
    checkedInAt: result.checkedInAt, alreadyRecorded: result.alreadyRecorded,
  };
  if (!receipt.alreadyRecorded) {
    try { await dependencies.onConfirmed(receipt); } catch {
      // Hints are best-effort. A confirmed server record is still successful.
    }
  }
  return receipt;
}
