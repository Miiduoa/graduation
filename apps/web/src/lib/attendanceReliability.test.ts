import { describe, expect, it, vi } from 'vitest';
import { attendanceSubmissionIssue, awaitAttendanceReceipt, readAttendanceReceipt } from '@campus/shared/src/attendanceReliability';
import { assembleAttendanceRegister } from './attendanceRegister';
import { parseAttendanceQr } from './attendanceQr';

describe('兩端共用的點名契約', () => {
  const scope = { groupId: 'course', sessionId: 'session', userId: 'student' };
  it.each(['present', 'late', 'absent', 'excused'] as const)('Web 名冊與 Mobile 收據對 %s 的解讀相同', (status) => {
    const data = { uid: scope.userId, groupId: scope.groupId, sessionId: scope.sessionId,
      status, source: 'manual', checkedInAt: '2026-10-23T10:00:00Z', correctedAt: '2026-10-23T10:01:00Z' };
    const receipt = readAttendanceReceipt(data, scope);
    const [row] = assembleAttendanceRegister([{ uid: scope.userId, displayName: '', studentId: '' }],
      [{ id: scope.userId, data }], { courseId: scope.groupId, sessionId: scope.sessionId, complete: true });
    expect(row).toMatchObject(receipt!);
    expect(readAttendanceReceipt({ ...data, uid: 'other' }, scope)).toBeNull();
  });
  it('兩端產生的 QR 都可掃描，換場次後舊 QR 不能沿用', () => {
    const json = JSON.stringify({ groupId: 'course', sessionId: 'session', qrToken: 'proof' });
    const link = 'campusone://classroom/join?groupId=course&sessionId=session&token=proof';
    expect(parseAttendanceQr(json, scope)).toEqual(parseAttendanceQr(link, scope));
    expect(parseAttendanceQr(link, { ...scope, sessionId: 'new-session' }).ok).toBe(false);
  });
  it('慢速請求會回到待確認，稍後抵達的回應不會把逾時改成成功', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (result: { success: boolean }) => void;
      const waiting = awaitAttendanceReceipt(new Promise<{ success: boolean }>((resolve) => { finish = resolve; }));
      const assertion = expect(waiting).rejects.toMatchObject({ code: 'unavailable' });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      finish({ success: true });
      expect(attendanceSubmissionIssue({ code: 'unavailable' }).pending).toBe(true);
      expect(attendanceSubmissionIssue({ code: 'deadline-exceeded' })).toMatchObject({ pending: false, rescan: true });
    } finally { vi.useRealTimers(); }
  });
});
