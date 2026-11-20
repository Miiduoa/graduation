/**
 * @jest-environment node
 *
 * 智慧點名引擎完整測試：5 種方法 + 反作弊 + 智慧分析。
 */
import {
  verifyAttendance,
  buildRotatingQrToken,
  analyzeAttendancePattern,
  type AttendanceSessionConfig,
  type AttendanceClaim,
  type AttendancePatternSnapshot,
} from '@campus/shared';

const SECRET = 'sess123secret';
const NOW = '2026-05-13T09:05:00+08:00'; // 課程 09:00 開始，遲到線 09:10
const CFG_BASE: AttendanceSessionConfig = {
  sessionId: 's1',
  courseId: 'c1',
  method: 'rotating_qr',
  classStartAt: '2026-05-13T09:00:00+08:00',
  lateAfterAt: '2026-05-13T09:10:00+08:00',
  closesAt: '2026-05-13T10:00:00+08:00',
  secret: SECRET,
};

describe('rotating_qr', () => {
  test('正確 token 通過 + present', () => {
    const token = buildRotatingQrToken(SECRET, Date.parse(NOW));
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, token },
      { ...CFG_BASE, method: 'rotating_qr' },
    );
    expect(r.valid).toBe(true);
    expect(r.status).toBe('present');
  });

  test('過期 token → suspicious', () => {
    const oldToken = buildRotatingQrToken(SECRET, Date.parse(NOW) - 60_000);
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, token: oldToken },
      { ...CFG_BASE, method: 'rotating_qr' },
    );
    expect(r.valid).toBe(false);
    expect(r.flags).toContain('stale_or_forged_qr');
  });

  test('遲到線後簽到 → late', () => {
    const late = '2026-05-13T09:15:00+08:00';
    const token = buildRotatingQrToken(SECRET, Date.parse(late));
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: late, token },
      { ...CFG_BASE, method: 'rotating_qr' },
    );
    expect(r.valid).toBe(true);
    expect(r.status).toBe('late');
  });

  test('關門時間後 → absent', () => {
    const tooLate = '2026-05-13T11:00:00+08:00';
    const token = buildRotatingQrToken(SECRET, Date.parse(tooLate));
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: tooLate, token },
      { ...CFG_BASE, method: 'rotating_qr' },
    );
    expect(r.valid).toBe(false);
    expect(r.status).toBe('absent');
  });
});

describe('number_code', () => {
  test('正確 code → present', () => {
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, code: SECRET },
      { ...CFG_BASE, method: 'number_code' },
    );
    expect(r.valid).toBe(true);
  });

  test('錯 code → suspicious', () => {
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, code: 'wrong' },
      { ...CFG_BASE, method: 'number_code' },
    );
    expect(r.valid).toBe(false);
    expect(r.status).toBe('suspicious');
  });
});

describe('geofence', () => {
  const GEO_CFG: AttendanceSessionConfig = {
    ...CFG_BASE,
    method: 'geofence',
    geo: { lat: 24.225, lng: 120.563, radiusMeters: 50 },
  };
  test('在範圍內 → present', () => {
    const r = verifyAttendance(
      {
        uid: 'u1',
        claimedAt: NOW,
        location: { lat: 24.225, lng: 120.5631, accuracyMeters: 10 },
      },
      GEO_CFG,
    );
    expect(r.valid).toBe(true);
    expect(r.status).toBe('present');
  });

  test('遠超範圍 → suspicious + far_from_classroom', () => {
    const r = verifyAttendance(
      {
        uid: 'u1',
        claimedAt: NOW,
        location: { lat: 25.05, lng: 121.5, accuracyMeters: 10 }, // 台北
      },
      GEO_CFG,
    );
    expect(r.valid).toBe(false);
    expect(r.flags).toContain('far_from_classroom');
  });

  test('GPS 精度差 → 標 low_gps_accuracy 但仍通過', () => {
    const r = verifyAttendance(
      {
        uid: 'u1',
        claimedAt: NOW,
        location: { lat: 24.225, lng: 120.563, accuracyMeters: 100 },
      },
      GEO_CFG,
    );
    expect(r.valid).toBe(true);
    expect(r.flags).toContain('low_gps_accuracy');
  });
});

describe('selfie_liveness', () => {
  const SELFIE_CFG: AttendanceSessionConfig = {
    ...CFG_BASE,
    method: 'selfie_liveness',
    selfie: { minSimilarity: 0.7 },
  };
  test('相似度通過 → present', () => {
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, selfieSimilarity: 0.85 },
      SELFIE_CFG,
    );
    expect(r.valid).toBe(true);
  });

  test('相似度不足 → suspicious + proxy_attendance_risk', () => {
    const r = verifyAttendance(
      { uid: 'u1', claimedAt: NOW, selfieSimilarity: 0.4 },
      SELFIE_CFG,
    );
    expect(r.valid).toBe(false);
    expect(r.flags).toContain('proxy_attendance_risk');
  });
});

describe('multi_factor', () => {
  const MULTI_CFG: AttendanceSessionConfig = {
    ...CFG_BASE,
    method: 'multi_factor',
    multiFactorMethods: ['rotating_qr', 'geofence'],
    geo: { lat: 24.225, lng: 120.563, radiusMeters: 50 },
  };
  test('兩種都通過 → present', () => {
    const token = buildRotatingQrToken(SECRET, Date.parse(NOW));
    const r = verifyAttendance(
      {
        uid: 'u1',
        claimedAt: NOW,
        token,
        location: { lat: 24.225, lng: 120.563 },
      },
      MULTI_CFG,
    );
    expect(r.valid).toBe(true);
  });

  test('QR 對但人不在教室 → 整體失敗', () => {
    const token = buildRotatingQrToken(SECRET, Date.parse(NOW));
    const r = verifyAttendance(
      {
        uid: 'u1',
        claimedAt: NOW,
        token,
        location: { lat: 25.05, lng: 121.5 }, // 不在教室
      },
      MULTI_CFG,
    );
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('one_or_more_factors_failed');
  });
});

describe('analyzeAttendancePattern', () => {
  function rec(date: string, status: AttendancePatternSnapshot['status']): AttendancePatternSnapshot {
    return { sessionId: `s_${date}`, classStartAt: date, status };
  }

  test('空陣列 → 預設無警示', () => {
    const r = analyzeAttendancePattern([]);
    expect(r.alerts).toHaveLength(0);
    expect(r.attendanceRate).toBe(1);
  });

  test('連 3 次缺席 → consec_absent high', () => {
    const r = analyzeAttendancePattern([
      rec('2026-05-01T09:00:00Z', 'present'),
      rec('2026-05-08T09:00:00Z', 'absent'),
      rec('2026-05-15T09:00:00Z', 'absent'),
      rec('2026-05-22T09:00:00Z', 'absent'),
    ]);
    expect(r.consecutiveAbsent).toBe(3);
    expect(r.alerts.find((a) => a.kind === 'consec_absent')?.severity).toBe('high');
  });

  test('習慣性遲到時段', () => {
    const r = analyzeAttendancePattern([
      rec('2026-05-01T09:00:00Z', 'late'),
      rec('2026-05-08T09:00:00Z', 'late'),
      rec('2026-05-15T09:00:00Z', 'late'),
      rec('2026-05-22T15:00:00Z', 'present'),
    ]);
    expect(r.habituallyLateTimeSlot).toBeTruthy();
  });

  test('出席率 < 50% → high alert', () => {
    const r = analyzeAttendancePattern([
      rec('2026-05-01T09:00:00Z', 'absent'),
      rec('2026-05-08T09:00:00Z', 'absent'),
      rec('2026-05-15T09:00:00Z', 'present'),
    ]);
    expect(r.alerts.find((a) => a.kind === 'attendance_low')?.severity).toBe('high');
  });
});
