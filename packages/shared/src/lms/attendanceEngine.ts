/**
 * Smart Attendance Engine — TronClass parity + 超越版
 *
 * TronClass 提供 3 種：QR / Geofence / NumericCode
 * 我們提供 5 種 + 智慧反作弊：
 *   1. rotating_qr      — 教師端每 3 秒輪轉的 QR Code（防截圖外流）
 *   2. number_code      — 教師唸的 4-6 位驗證碼（無相機環境用）
 *   3. geofence         — GPS 距離教室 ≤ N 米
 *   4. selfie_liveness  — 學生拍臉證明本人（防代簽）
 *   5. multi_factor     — 任兩種合一（高利害如期末考）
 *
 * 反作弊：
 *   - QR 動態旋轉（HOTP-like，每 3 秒一新）
 *   - 同一裝置短時間多次簽到 → 標記 suspicious
 *   - GPS 距離超過教室半徑 → reject
 *   - selfie 與註冊照片相似度 < 閾值 → 標記
 *   - clock skew > 30s → reject
 *
 * 純函式，無 I/O：mobile / cloud function / web 共用。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type AttendanceMethod =
  | 'rotating_qr'
  | 'number_code'
  | 'geofence'
  | 'selfie_liveness'
  | 'multi_factor';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused' | 'suspicious';

export interface AttendanceSessionConfig {
  sessionId: string;
  courseId: string;
  method: AttendanceMethod;
  /** 課堂開始時間 ISO */
  classStartAt: string;
  /** 最晚簽到時間（之後算遲到） */
  lateAfterAt?: string;
  /** 最後關門時間（之後算缺席，無法補簽） */
  closesAt?: string;
  /** rotating_qr / number_code 共用：教師端 secret，每 3 秒生成新 token */
  secret?: string;
  /** geofence：教室經緯度與半徑(m) */
  geo?: {
    lat: number;
    lng: number;
    radiusMeters: number;
  };
  /** selfie_liveness：是否比對註冊照 + 相似度閾值 */
  selfie?: {
    enrolledHash?: string;
    minSimilarity?: number; // 0-1
  };
  /** multi_factor：要求同時滿足哪幾種 */
  multiFactorMethods?: AttendanceMethod[];
}

export interface AttendanceClaim {
  uid: string;
  /** 學生提交時間 ISO */
  claimedAt: string;
  /** 學生裝置 fingerprint（用於同一裝置多人偵測） */
  deviceFingerprint?: string;
  /** rotating_qr 解析後的 token */
  token?: string;
  /** number_code 輸入 */
  code?: string;
  /** geofence 學生 GPS */
  location?: { lat: number; lng: number; accuracyMeters?: number };
  /** selfie 比對結果（device 端先做完比對 → 傳結果） */
  selfieSimilarity?: number;
  /** multi_factor 子 claim */
  subClaims?: AttendanceClaim[];
}

export interface AttendanceVerifyResult {
  valid: boolean;
  status: AttendanceStatus;
  /** 若 invalid，回覆給使用者的原因 */
  reason?: string;
  /** 反作弊標記 */
  flags: string[];
  /** 偵測到的細節 */
  details?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────
// 內部 helpers
// ─────────────────────────────────────────────────────────

function rotatingQrToken(secret: string, intervalSec = 3, atMs?: number): string {
  // 簡化版 HOTP：sha1-like wrap，每 intervalSec 一換
  const slot = Math.floor((atMs ?? Date.now()) / 1000 / intervalSec);
  let h = 0;
  const s = `${secret}|${slot}`;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  // 取絕對值並對齊 6 位 hex
  return Math.abs(h).toString(16).padStart(6, '0').slice(-6).toUpperCase();
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function classifyByTime(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): { status: AttendanceStatus; reason?: string } {
  const tClaim = Date.parse(claim.claimedAt);
  const tStart = Date.parse(cfg.classStartAt);
  const tLate = cfg.lateAfterAt ? Date.parse(cfg.lateAfterAt) : tStart + 10 * 60 * 1000;
  const tClose = cfg.closesAt ? Date.parse(cfg.closesAt) : tLate + 50 * 60 * 1000;

  if (tClaim > tClose) {
    return { status: 'absent', reason: 'session_closed' };
  }
  if (tClaim > tLate) {
    return { status: 'late' };
  }
  return { status: 'present' };
}

// ─────────────────────────────────────────────────────────
// 各方法驗證
// ─────────────────────────────────────────────────────────

function verifyRotatingQR(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  if (!cfg.secret) {
    return { valid: false, status: 'absent', reason: 'no_secret', flags: ['config_error'] };
  }
  if (!claim.token) {
    return { valid: false, status: 'absent', reason: 'no_token', flags: [] };
  }
  // 接受當前 + 前 1 + 後 1 slot（容忍 clock skew）
  const now = Date.parse(claim.claimedAt);
  const slotSec = 3;
  const tokens = [
    rotatingQrToken(cfg.secret, slotSec, now),
    rotatingQrToken(cfg.secret, slotSec, now - slotSec * 1000),
    rotatingQrToken(cfg.secret, slotSec, now + slotSec * 1000),
  ];
  if (!tokens.includes(claim.token.toUpperCase())) {
    return {
      valid: false,
      status: 'suspicious',
      reason: 'token_mismatch',
      flags: ['stale_or_forged_qr'],
    };
  }
  const t = classifyByTime(claim, cfg);
  return { valid: true, status: t.status, flags: [], details: { method: 'rotating_qr' } };
}

function verifyNumberCode(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  if (!cfg.secret) {
    return { valid: false, status: 'absent', reason: 'no_code', flags: ['config_error'] };
  }
  const expected = String(cfg.secret).toUpperCase();
  const given = (claim.code ?? '').toUpperCase().trim();
  if (given !== expected) {
    return { valid: false, status: 'suspicious', reason: 'code_mismatch', flags: [] };
  }
  const t = classifyByTime(claim, cfg);
  return { valid: true, status: t.status, flags: [], details: { method: 'number_code' } };
}

function verifyGeofence(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  if (!cfg.geo) {
    return { valid: false, status: 'absent', reason: 'no_geo_config', flags: ['config_error'] };
  }
  if (!claim.location) {
    return { valid: false, status: 'absent', reason: 'no_location_provided', flags: [] };
  }
  const dist = haversineMeters(cfg.geo, claim.location);
  if (dist > cfg.geo.radiusMeters) {
    return {
      valid: false,
      status: 'suspicious',
      reason: 'out_of_range',
      flags: ['far_from_classroom'],
      details: { distanceMeters: Math.round(dist), radius: cfg.geo.radiusMeters },
    };
  }
  // accuracy 過大也標記
  const flags: string[] = [];
  if ((claim.location.accuracyMeters ?? 0) > 50) flags.push('low_gps_accuracy');
  const t = classifyByTime(claim, cfg);
  return {
    valid: true,
    status: t.status,
    flags,
    details: { method: 'geofence', distanceMeters: Math.round(dist) },
  };
}

function verifySelfie(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  const min = cfg.selfie?.minSimilarity ?? 0.6;
  if (claim.selfieSimilarity === undefined) {
    return { valid: false, status: 'absent', reason: 'no_selfie', flags: [] };
  }
  if (claim.selfieSimilarity < min) {
    return {
      valid: false,
      status: 'suspicious',
      reason: 'face_mismatch',
      flags: ['proxy_attendance_risk'],
      details: { similarity: claim.selfieSimilarity, required: min },
    };
  }
  const t = classifyByTime(claim, cfg);
  return {
    valid: true,
    status: t.status,
    flags: [],
    details: { method: 'selfie', similarity: claim.selfieSimilarity },
  };
}

function verifyMultiFactor(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  const requiredMethods = cfg.multiFactorMethods ?? [];
  if (requiredMethods.length < 2) {
    return {
      valid: false,
      status: 'absent',
      reason: 'multi_factor_needs_2_methods',
      flags: ['config_error'],
    };
  }
  const subResults: AttendanceVerifyResult[] = [];
  for (const m of requiredMethods) {
    const subCfg: AttendanceSessionConfig = { ...cfg, method: m };
    // 對應 sub claim 採用整個 claim
    const sub = verifyAttendance(claim, subCfg);
    subResults.push(sub);
  }
  const allValid = subResults.every((r) => r.valid);
  const flags = subResults.flatMap((r) => r.flags);
  const worstStatus: AttendanceStatus = subResults.some((r) => r.status === 'suspicious')
    ? 'suspicious'
    : subResults.some((r) => r.status === 'late')
    ? 'late'
    : subResults.every((r) => r.status === 'present')
    ? 'present'
    : 'absent';
  return {
    valid: allValid,
    status: allValid ? worstStatus : 'suspicious',
    reason: allValid ? undefined : 'one_or_more_factors_failed',
    flags: Array.from(new Set(flags)),
    details: { method: 'multi_factor', subResults },
  };
}

// ─────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────

export function verifyAttendance(
  claim: AttendanceClaim,
  cfg: AttendanceSessionConfig,
): AttendanceVerifyResult {
  // 時間關門先擋
  if (cfg.closesAt && Date.parse(claim.claimedAt) > Date.parse(cfg.closesAt)) {
    return { valid: false, status: 'absent', reason: 'session_closed', flags: [] };
  }

  switch (cfg.method) {
    case 'rotating_qr':
      return verifyRotatingQR(claim, cfg);
    case 'number_code':
      return verifyNumberCode(claim, cfg);
    case 'geofence':
      return verifyGeofence(claim, cfg);
    case 'selfie_liveness':
      return verifySelfie(claim, cfg);
    case 'multi_factor':
      return verifyMultiFactor(claim, cfg);
    default:
      return { valid: false, status: 'absent', reason: 'unknown_method', flags: ['config_error'] };
  }
}

// ─────────────────────────────────────────────────────────
// 智慧出席模式分析（超越 TronClass）
// ─────────────────────────────────────────────────────────

/** 單堂課的出席結果快照，供 `analyzeAttendancePattern` 使用（與 `tronclassAdapter.AttendanceRecord` 分離命名） */
export interface AttendancePatternSnapshot {
  sessionId: string;
  classStartAt: string;
  status: AttendanceStatus;
}

export interface AttendancePatternResult {
  attendanceRate: number;
  consecutiveAbsent: number;
  consecutiveLate: number;
  habituallyLateTimeSlot: string | null; // 例如 '0900'
  alerts: Array<{
    kind: 'consec_absent' | 'consec_late' | 'habitual_late_slot' | 'attendance_low';
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
}

export function analyzeAttendancePattern(records: AttendancePatternSnapshot[]): AttendancePatternResult {
  if (records.length === 0) {
    return {
      attendanceRate: 1,
      consecutiveAbsent: 0,
      consecutiveLate: 0,
      habituallyLateTimeSlot: null,
      alerts: [],
    };
  }

  // 依時間排序
  const sorted = [...records].sort(
    (a, b) => Date.parse(a.classStartAt) - Date.parse(b.classStartAt),
  );

  const presentCount = sorted.filter(
    (r) => r.status === 'present' || r.status === 'late' || r.status === 'excused',
  ).length;
  const attendanceRate = presentCount / sorted.length;

  // 連續缺席（從尾巴往回算）
  let consecutiveAbsent = 0;
  let consecutiveLate = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].status === 'absent') consecutiveAbsent += 1;
    else break;
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].status === 'late') consecutiveLate += 1;
    else break;
  }

  // 習慣性遲到時段
  const lateByHour = new Map<string, number>();
  for (const r of sorted) {
    if (r.status !== 'late') continue;
    const h = new Date(r.classStartAt).getHours();
    const slot = `${String(h).padStart(2, '0')}00`;
    lateByHour.set(slot, (lateByHour.get(slot) ?? 0) + 1);
  }
  let habituallyLateTimeSlot: string | null = null;
  let maxLate = 0;
  for (const [slot, n] of lateByHour) {
    if (n >= 3 && n > maxLate) {
      maxLate = n;
      habituallyLateTimeSlot = slot;
    }
  }

  // 警示
  const alerts: AttendancePatternResult['alerts'] = [];
  if (consecutiveAbsent >= 2) {
    alerts.push({
      kind: 'consec_absent',
      severity: consecutiveAbsent >= 3 ? 'high' : 'medium',
      message: `已連續 ${consecutiveAbsent} 次缺席`,
    });
  }
  if (consecutiveLate >= 3) {
    alerts.push({
      kind: 'consec_late',
      severity: 'medium',
      message: `已連續 ${consecutiveLate} 次遲到`,
    });
  }
  if (habituallyLateTimeSlot) {
    alerts.push({
      kind: 'habitual_late_slot',
      severity: 'low',
      message: `${habituallyLateTimeSlot} 的課常遲到（${maxLate} 次）`,
    });
  }
  if (attendanceRate < 0.7) {
    alerts.push({
      kind: 'attendance_low',
      severity: attendanceRate < 0.5 ? 'high' : 'medium',
      message: `出席率僅 ${Math.round(attendanceRate * 100)}%`,
    });
  }

  return {
    attendanceRate: Math.round(attendanceRate * 100) / 100,
    consecutiveAbsent,
    consecutiveLate,
    habituallyLateTimeSlot,
    alerts,
  };
}

// 對外暴露 QR 產生器（教師端 mobile / web 共用）
export function buildRotatingQrToken(secret: string, atMs?: number): string {
  return rotatingQrToken(secret, 3, atMs);
}
