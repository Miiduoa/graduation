/* eslint-disable */
/**
 * AttendanceLiveScreen v4 — 即時點名畫面
 *
 * 真實使用情境：
 * - 教師：顯示 QR 碼 / 數字密碼 → 即時看到誰簽到 → 結束點名
 * - 學生：輸入數字密碼或掃描 QR → 看到簽到結果
 *
 * 只保留 rotating_qr 和 number_code 兩種實際可行的模式
 */
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  RefreshControl,
  Alert,
  TextInput,
  Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { PureQRCode } from '../ui/PureQRCode';
import { earnXP } from '../services/gamificationEngine';
import {
  type AttendanceSession,
  type AttendanceRecord,
  type AttendanceStatus,
  getSessionById,
  checkIn,
  endSession,
  generateRotatingQR,
  validateRotatingQR,
  updateStudentStatus,
  getStatusColor,
  getStatusLabel,
} from '../services/smartAttendanceEngine';
import { simulateStudentCheckIn } from '../services/demoActionSimulator';

// ============================================================================
// TYPES
// ============================================================================

interface AttendanceLiveScreenProps {
  route: {
    params: {
      sessionId: string;
      isTeacher: boolean;
    };
  };
  navigation: any;
}

// ============================================================================
// ROTATING QR DISPLAY — 每 3 秒旋轉，教師展示用
// ============================================================================

function RotatingQRDisplay({ sessionId, secret }: { sessionId: string; secret: string }) {
  const [qrValue, setQrValue] = useState(() => generateRotatingQR(sessionId, secret));
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      const newQR = generateRotatingQR(sessionId, secret);
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.4, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
      setQrValue(newQR);
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, secret, fadeAnim]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 3 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={s.qrSection}>
      <Animated.View style={{ opacity: fadeAnim }}>
        <PureQRCode value={qrValue} size={220} />
      </Animated.View>
      <View style={s.qrBadgeRow}>
        <View style={s.qrBadge}>
          <Ionicons name={'shield-checkmark' as any} size={14} color="#FFFFFF" />
          <Text style={s.qrBadgeText}>動態防截圖</Text>
        </View>
        <View
          style={[
            s.qrBadge,
            {
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Ionicons name={'time-outline' as any} size={14} color={theme.colors.accent} />
          <Text style={[s.qrBadgeText, { color: theme.colors.text }]}>{countdown}s</Text>
        </View>
      </View>
    </View>
  );
}

// ============================================================================
// NUMBER CODE DISPLAY — 6 位數字，教師展示用
// ============================================================================

function NumberCodeDisplay({ code }: { code: string }) {
  const digits = code.split('');

  return (
    <View style={s.codeSection}>
      <Text style={s.codeSectionLabel}>簽到密碼</Text>
      <View style={s.codeDigitsRow}>
        {digits.map((d, i) => (
          <View key={i} style={s.codeDigitBox}>
            <Text style={s.codeDigit}>{d}</Text>
          </View>
        ))}
      </View>
      <Text style={s.codeHint}>請告訴學生輸入此密碼完成簽到</Text>
    </View>
  );
}

// ============================================================================
// STUDENT RECORD ITEM — 學生簽到列表項
// ============================================================================

function StudentRecordItem({
  record,
  isTeacher,
  onStatusChange,
}: {
  record: AttendanceRecord;
  isTeacher: boolean;
  onStatusChange?: (studentId: string, status: AttendanceStatus) => void;
}) {
  const statusColor = getStatusColor(record.status);
  const statusLabel = getStatusLabel(record.status);

  return (
    <View style={[s.recordItem, { borderLeftColor: statusColor }]}>
      <View style={[s.recordAvatar, { backgroundColor: statusColor }]}>
        <Text style={s.recordAvatarText}>{record.studentName[0]}</Text>
      </View>
      <View style={s.recordContent}>
        <Text style={s.recordName}>{record.studentName}</Text>
        <View style={s.recordMeta}>
          <Text style={[s.recordStatus, { color: statusColor }]}>{statusLabel}</Text>
          {record.checkInTime && (
            <Text style={s.recordTime}>
              {new Date(record.checkInTime).toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          )}
        </View>
      </View>
      {isTeacher && record.status === 'absent' && onStatusChange && (
        <TouchableOpacity
          style={s.recordAction}
          onPress={() => onStatusChange(record.studentId, 'excused')}
        >
          <Ionicons name={'checkmark' as any} size={16} color={theme.colors.success} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ============================================================================
// MAIN SCREEN
// ============================================================================

export default function AttendanceLiveScreen({ route, navigation }: AttendanceLiveScreenProps) {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { sessionId, isTeacher } = route.params;

  // State
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState('');
  const [numberInput, setNumberInput] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'present' | 'late' | 'absent'>('all');

  // ─── Load session ─────────────────────────────────────────
  const loadSession = useCallback(async () => {
    const sess = await getSessionById(sessionId);
    if (sess) {
      setSession(sess);
      // Check if student already checked in
      if (!isTeacher && auth.user?.uid) {
        const myRecord = sess.records.find((r) => r.studentId === auth.user?.uid);
        if (myRecord && myRecord.checkInTime) {
          setCheckedIn(true);
          setCheckInMessage(myRecord.status === 'present' ? '準時簽到' : '遲到簽到');
        }
      }
    }
  }, [sessionId, isTeacher, auth.user?.uid]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Auto-refresh (every 5 sec for teacher)
  useEffect(() => {
    if (!isTeacher) return;
    const interval = setInterval(loadSession, 5000);
    return () => clearInterval(interval);
  }, [isTeacher, loadSession]);

  // Elapsed timer
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - session.startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  // ─── Actions ──────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSession();
    setRefreshing(false);
  }, [loadSession]);

  const handleCheckIn = useCallback(async () => {
    try {
      const studentId = auth.user?.uid || 'S_ANON';
      const studentName = auth.user?.displayName || auth.profile?.displayName || '學生';
      const result = await checkIn(sessionId, studentId, studentName);
      if (result.success) {
        await earnXP('attend_class').catch(() => {});
        setCheckedIn(true);
        setCheckInMessage(result.message);
        Vibration.vibrate([0, 200, 100, 200]);
        await loadSession();
        // ── Demo：emit cross-role event 給老師 ──
        try {
          const sess = await getSessionById(sessionId);
          await simulateStudentCheckIn({
            studentUid: studentId,
            studentName,
            teacherUid: 'demo_teacher_chang',
            courseId: Number(sess?.courseId ?? 0) || 0,
            courseName: sess?.courseName ?? '課程',
            sessionId,
            method: (((sess as any)?.method ?? 'rotating_qr')) as 'rotating_qr' | 'number_code' | 'geofence' | 'selfie_liveness' | 'multi_factor',
            status: result.message.includes('遲') ? 'late' : 'present',
          });
        } catch { /* swallow demo emit failures */ }
      } else {
        Alert.alert('簽到失敗', result.message);
      }
    } catch (error) {
      Alert.alert('簽到失敗', String(error));
    }
  }, [auth.user, auth.profile, sessionId, loadSession]);

  const handleNumberSubmit = useCallback(async () => {
    if (numberInput.length !== 6) {
      Alert.alert('無效代碼', '請輸入 6 位數字密碼');
      return;
    }
    if (!session) return;
    // Validate: either matches rotating QR or the static number code
    if (numberInput === session.numberCode) {
      await handleCheckIn();
      setNumberInput('');
    } else {
      Alert.alert('密碼錯誤', '請重新輸入或詢問教師');
      setNumberInput('');
    }
  }, [numberInput, session, handleCheckIn]);

  const handleEndSession = useCallback(() => {
    if (!session) return;
    const checkedCount = session.records.filter(
      (r) => r.status === 'present' || r.status === 'late',
    ).length;
    Alert.alert(
      '結束點名',
      `確認結束「${session.courseName}」的點名？\n已簽到: ${checkedCount} / ${session.totalStudents}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認結束',
          style: 'destructive',
          onPress: async () => {
            await endSession(sessionId);
            navigation.goBack();
          },
        },
      ],
    );
  }, [session, sessionId, navigation]);

  const handleStatusChange = useCallback(
    async (studentId: string, status: AttendanceStatus) => {
      await updateStudentStatus(sessionId, studentId, status);
      await loadSession();
    },
    [sessionId, loadSession],
  );

  // ─── Computed ─────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!session) return { present: 0, late: 0, absent: 0, excused: 0, total: 0, rate: 0 };
    const present = session.records.filter((r) => r.status === 'present').length;
    const late = session.records.filter((r) => r.status === 'late').length;
    const absent = session.records.filter((r) => r.status === 'absent').length;
    const excused = session.records.filter((r) => r.status === 'excused').length;
    const total = session.totalStudents || session.records.length;
    const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
    return { present, late, absent, excused, total, rate };
  }, [session]);

  const filteredRecords = useMemo(() => {
    if (!session) return [];
    if (studentFilter === 'all') return session.records;
    return session.records.filter((r) => r.status === studentFilter);
  }, [session, studentFilter]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // ─── Loading ──────────────────────────────────────────────
  if (!session) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingContainer}>
          <Ionicons name={'hourglass-outline' as any} size={48} color={theme.colors.muted} />
          <Text style={s.loadingText}>載入點名資料...</Text>
        </View>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.headerBack}>
          <Ionicons name={'chevron-back' as any} size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {session.courseName}
          </Text>
          <View style={s.headerMeta}>
            <View style={[s.liveIndicator, session.status === 'active' && s.liveActive]} />
            <Text style={s.headerSubtitle}>
              {session.status === 'active' ? `進行中 ${formatTime(elapsedTime)}` : '已結束'}
            </Text>
          </View>
        </View>
        {isTeacher && session.status === 'active' && (
          <TouchableOpacity onPress={handleEndSession} style={s.endBtn}>
            <Text style={s.endBtnText}>結束點名</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingBottom: insets.bottom + TAB_BAR_CONTENT_BOTTOM_PADDING + 40,
        }}
      >
        {/* ══════════════════════════════════════════════════════
           TEACHER VIEW
        ══════════════════════════════════════════════════════ */}
        {isTeacher ? (
          <>
            {/* Stats */}
            <View style={s.statsRow}>
              <View style={[s.statCard, { backgroundColor: '#ECFDF5' }]}>
                <Text style={[s.statNum, { color: '#10B981' }]}>{stats.present}</Text>
                <Text style={s.statLabel}>出席</Text>
              </View>
              <View style={[s.statCard, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[s.statNum, { color: '#F59E0B' }]}>{stats.late}</Text>
                <Text style={s.statLabel}>遲到</Text>
              </View>
              <View style={[s.statCard, { backgroundColor: '#FEE2E2' }]}>
                <Text style={[s.statNum, { color: '#EF4444' }]}>{stats.absent}</Text>
                <Text style={s.statLabel}>缺席</Text>
              </View>
              <View style={[s.statCard, { backgroundColor: theme.colors.surface2 }]}>
                <Text style={[s.statNum, { color: theme.colors.accent }]}>{stats.rate}%</Text>
                <Text style={s.statLabel}>出席率</Text>
              </View>
            </View>

            {/* Mode Display */}
            <View style={s.modeDisplayCard}>
              {session.mode === 'rotating_qr' ? (
                <RotatingQRDisplay sessionId={sessionId} secret={session.qrSecret} />
              ) : session.mode === 'number_code' ? (
                <NumberCodeDisplay code={session.numberCode} />
              ) : (
                <View style={s.manualModeHint}>
                  <Ionicons
                    name={'clipboard-outline' as any}
                    size={40}
                    color={theme.colors.accent}
                  />
                  <Text style={s.manualModeText}>手動點名模式</Text>
                  <Text style={s.manualModeSubtext}>長按學生名稱更改出席狀態</Text>
                </View>
              )}
            </View>

            {/* Location info */}
            {session.location ? (
              <View style={s.locationBadge}>
                <Ionicons name={'location-outline' as any} size={14} color={theme.colors.muted} />
                <Text style={s.locationText}>{session.location}</Text>
              </View>
            ) : null}

            {/* Student List */}
            <View style={s.filterRow}>
              <Text style={s.sectionTitle}>學生列表 ({session.records.length})</Text>
              <View style={s.filterTabs}>
                {(['all', 'present', 'late', 'absent'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[s.filterTab, studentFilter === f && s.filterTabActive]}
                    onPress={() => setStudentFilter(f)}
                  >
                    <Text style={[s.filterTabText, studentFilter === f && s.filterTabTextActive]}>
                      {f === 'all'
                        ? '全部'
                        : f === 'present'
                          ? '出席'
                          : f === 'late'
                            ? '遲到'
                            : '缺席'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {filteredRecords.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name={'people-outline' as any} size={36} color={theme.colors.muted} />
                <Text style={s.emptyText}>等待學生簽到...</Text>
              </View>
            ) : (
              filteredRecords.map((record) => (
                <StudentRecordItem
                  key={record.id}
                  record={record}
                  isTeacher
                  onStatusChange={handleStatusChange}
                />
              ))
            )}
          </>
        ) : (
          /* ══════════════════════════════════════════════════════
             STUDENT VIEW
          ══════════════════════════════════════════════════════ */
          <>
            {checkedIn ? (
              /* ── Check-in success ── */
              <View style={s.successCard}>
                <View style={s.successIcon}>
                  <Ionicons
                    name={'checkmark-circle' as any}
                    size={72}
                    color={theme.colors.success}
                  />
                </View>
                <Text style={s.successTitle}>簽到成功</Text>
                <Text style={s.successMessage}>{checkInMessage}</Text>
                <Text style={s.successTime}>
                  {new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <View style={s.sessionInfoBox}>
                  <View style={s.sessionInfoRow}>
                    <Ionicons name={'book-outline' as any} size={16} color={theme.colors.muted} />
                    <Text style={s.sessionInfoText}>{session.courseName}</Text>
                  </View>
                  {session.location ? (
                    <View style={s.sessionInfoRow}>
                      <Ionicons
                        name={'location-outline' as any}
                        size={16}
                        color={theme.colors.muted}
                      />
                      <Text style={s.sessionInfoText}>{session.location}</Text>
                    </View>
                  ) : null}
                  <View style={s.sessionInfoRow}>
                    <Ionicons name={'person-outline' as any} size={16} color={theme.colors.muted} />
                    <Text style={s.sessionInfoText}>{session.teacherName}</Text>
                  </View>
                </View>
              </View>
            ) : (
              /* ── Check-in form ── */
              <>
                {/* Course info */}
                <View style={s.studentCourseCard}>
                  <Ionicons name={'book' as any} size={22} color={theme.colors.accent} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={s.studentCourseName}>{session.courseName}</Text>
                    <Text style={s.studentCourseTeacher}>{session.teacherName}</Text>
                  </View>
                  <View style={s.liveTag}>
                    <View style={[s.liveIndicator, s.liveActive, { marginRight: 4 }]} />
                    <Text style={s.liveTagText}>進行中</Text>
                  </View>
                </View>

                {/* Mode-specific UI */}
                {session.mode === 'number_code' || session.mode === 'manual' ? (
                  <View style={s.studentInputSection}>
                    <Text style={s.studentInputLabel}>輸入 6 位簽到密碼</Text>
                    <View style={s.studentDigitsRow}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View
                          key={i}
                          style={[s.studentDigitBox, numberInput[i] ? s.studentDigitFilled : null]}
                        >
                          <Text style={s.studentDigitText}>{numberInput[i] || ''}</Text>
                        </View>
                      ))}
                    </View>
                    <TextInput
                      style={s.hiddenInput}
                      value={numberInput}
                      onChangeText={(text) =>
                        setNumberInput(text.replace(/[^0-9]/g, '').slice(0, 6))
                      }
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[s.checkInBtn, numberInput.length !== 6 && s.checkInBtnDisabled]}
                      onPress={handleNumberSubmit}
                      disabled={numberInput.length !== 6}
                    >
                      <Ionicons name={'checkmark-circle' as any} size={20} color="#FFFFFF" />
                      <Text style={s.checkInBtnText}>確認簽到</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* QR mode — in real app would open camera scanner */
                  <View style={s.studentQRSection}>
                    <View style={s.scanPlaceholder}>
                      <Ionicons
                        name={'scan-outline' as any}
                        size={56}
                        color={theme.colors.accent}
                      />
                      <Text style={s.scanHint}>掃描教師端的 QR 碼</Text>
                    </View>
                    <TouchableOpacity style={s.checkInBtn} onPress={handleCheckIn}>
                      <Ionicons name={'camera-outline' as any} size={20} color="#FFFFFF" />
                      <Text style={s.checkInBtnText}>開啟掃描器</Text>
                    </TouchableOpacity>
                    <Text style={s.orText}>— 或 —</Text>
                    {/* Fallback: manual number input */}
                    <Text style={s.fallbackLabel}>手動輸入密碼</Text>
                    <View style={s.studentDigitsRow}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View
                          key={i}
                          style={[
                            s.studentDigitBox,
                            s.studentDigitSmall,
                            numberInput[i] ? s.studentDigitFilled : null,
                          ]}
                        >
                          <Text style={[s.studentDigitText, { fontSize: 18 }]}>
                            {numberInput[i] || ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <TextInput
                      style={s.hiddenInput}
                      value={numberInput}
                      onChangeText={(text) =>
                        setNumberInput(text.replace(/[^0-9]/g, '').slice(0, 6))
                      }
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    {numberInput.length === 6 && (
                      <TouchableOpacity
                        style={[
                          s.checkInBtn,
                          { marginTop: 12, backgroundColor: theme.colors.success },
                        ]}
                        onPress={handleNumberSubmit}
                      >
                        <Text style={s.checkInBtnText}>密碼簽到</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: theme.colors.muted, marginTop: 12 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerBack: { padding: 4 },
  headerCenter: { flex: 1, marginLeft: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  headerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.muted,
    marginRight: 6,
  },
  liveActive: { backgroundColor: '#34C759' },
  headerSubtitle: { fontSize: 12, color: theme.colors.muted },
  endBtn: {
    backgroundColor: theme.colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  endBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  scrollContent: { flex: 1 },

  // Stats
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: theme.colors.muted, marginTop: 2 },

  // Mode Display
  modeDisplayCard: {
    margin: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },

  // QR
  qrSection: { alignItems: 'center', paddingVertical: 24 },
  qrBadgeRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  qrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.success,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  qrBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },

  // Number Code
  codeSection: { alignItems: 'center', paddingVertical: 32 },
  codeSectionLabel: {
    fontSize: 13,
    color: theme.colors.muted,
    fontWeight: '600',
    letterSpacing: 1,
  },
  codeDigitsRow: { flexDirection: 'row', marginTop: 16, gap: 8 },
  codeDigitBox: {
    width: 48,
    height: 60,
    backgroundColor: theme.colors.background,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  codeDigit: { fontSize: 28, fontWeight: '800', color: theme.colors.accent },
  codeHint: { fontSize: 13, color: theme.colors.muted, marginTop: 16 },

  // Manual mode
  manualModeHint: { alignItems: 'center', paddingVertical: 32 },
  manualModeText: { fontSize: 16, fontWeight: '700', color: theme.colors.text, marginTop: 12 },
  manualModeSubtext: { fontSize: 13, color: theme.colors.muted, marginTop: 4 },

  // Location
  locationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    gap: 4,
    marginBottom: 8,
  },
  locationText: { fontSize: 12, color: theme.colors.muted },

  // Filter & Student List
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  filterTabs: { flexDirection: 'row', gap: 4 },
  filterTab: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  filterTabActive: { backgroundColor: theme.colors.accent },
  filterTabText: { fontSize: 11, color: theme.colors.text, fontWeight: '600' },
  filterTabTextActive: { color: '#FFFFFF' },

  // Record Item
  recordItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderLeftWidth: 3,
  },
  recordAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordAvatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  recordContent: { flex: 1, marginLeft: 12 },
  recordName: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  recordMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
  recordStatus: { fontSize: 12, fontWeight: '600' },
  recordTime: { fontSize: 11, color: theme.colors.muted },
  recordAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontSize: 14, color: theme.colors.muted, marginTop: 8 },

  // ── Student View ──
  successCard: {
    alignItems: 'center',
    margin: 16,
    padding: 32,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
  },
  successIcon: {},
  successTitle: { fontSize: 24, fontWeight: '800', color: theme.colors.success, marginTop: 12 },
  successMessage: { fontSize: 14, color: theme.colors.muted, marginTop: 8 },
  successTime: { fontSize: 32, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  sessionInfoBox: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    alignSelf: 'stretch',
  },
  sessionInfoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  sessionInfoText: { fontSize: 13, color: theme.colors.muted, marginLeft: 8 },

  studentCourseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
  },
  studentCourseName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  studentCourseTeacher: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
  },
  liveTagText: { fontSize: 11, fontWeight: '600', color: '#10B981' },

  // Student input
  studentInputSection: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 24 },
  studentInputLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  studentDigitsRow: { flexDirection: 'row', marginTop: 20, gap: 8 },
  studentDigitBox: {
    width: 44,
    height: 54,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  studentDigitSmall: { width: 38, height: 46 },
  studentDigitFilled: { borderColor: theme.colors.accent },
  studentDigitText: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },

  checkInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    gap: 8,
    alignSelf: 'center',
    minWidth: 200,
  },
  checkInBtnDisabled: { opacity: 0.4 },
  checkInBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  // Student QR scan
  studentQRSection: { alignItems: 'center', paddingTop: 16, paddingHorizontal: 16 },
  scanPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  scanHint: { fontSize: 13, color: theme.colors.muted, marginTop: 12 },
  orText: { fontSize: 13, color: theme.colors.muted, marginTop: 20, marginBottom: 12 },
  fallbackLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 4 },
});
