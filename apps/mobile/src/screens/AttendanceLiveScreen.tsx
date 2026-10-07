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
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
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
  subscribeToSession,
  updateStudentStatus,
  getStatusColor,
  getStatusLabel,
} from '../services/smartAttendanceEngine';

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
          <Text style={s.qrBadgeText}>定時更新</Text>
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scanHandled = useRef(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // State
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState('');
  const [numberInput, setNumberInput] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'present' | 'late' | 'absent'>('all');

  // Load historical records and subscribe for both student and teacher views.
  const applySession = useCallback((sess: AttendanceSession | null) => {
    setSession(sess);
    setLoading(false);
    const myRecord = !isTeacher && auth.user?.uid
      ? sess?.records.find((record) => record.studentId === auth.user.uid)
      : undefined;
    const attended = myRecord?.status === 'present' || myRecord?.status === 'late';
    setCheckedIn(attended);
    setCheckInMessage(attended ? getStatusLabel(myRecord.status) : '');
    if (!sess || sess.status !== 'active') setScanning(false);
  }, [isTeacher, auth.user?.uid]);

  const loadSession = useCallback(async () => {
    try {
      applySession(await getSessionById(sessionId));
      setLoadError(false);
    } catch {
      setLoadError(true);
      setLoading(false);
    }
  }, [sessionId, applySession]);

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    setLoading(true);
    setLoadError(false);
    setSession(null);
    setScanning(false);
    getSessionById(sessionId).then((sess) => {
      if (active && !receivedUpdate) applySession(sess);
    }).catch(() => {
      if (active && !receivedUpdate) {
        setLoadError(true);
        setLoading(false);
      }
    });
    const unsubscribe = subscribeToSession(sessionId, (sess) => {
      if (!active) return;
      receivedUpdate = true;
      setLoadError(false);
      applySession(sess);
    });
    return () => { active = false; unsubscribe(); };
  }, [sessionId, applySession]);

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
    try { await loadSession(); } finally { setRefreshing(false); }
  }, [loadSession]);

  const handleCheckIn = useCallback(async (proof: { method: 'number_code' | 'rotating_qr'; code: string }) => {
    if (submittingRef.current) return;
    if (!auth.user?.uid) {
      Alert.alert('請先登入', '請登入學生帳號後再簽到。');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const studentName = auth.user.displayName || auth.profile?.displayName || '學生';
      const result = await checkIn(sessionId, auth.user.uid, studentName, proof);
      if (result.success) {
        await earnXP('attend_class').catch(() => {});
        setCheckedIn(true);
        setCheckInMessage(result.message);
        Vibration.vibrate([0, 200, 100, 200]);
        await loadSession();
      } else {
        Alert.alert('簽到失敗', result.message);
      }
    } catch (error) {
      Alert.alert('簽到失敗', String(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [auth.user, auth.profile, sessionId, loadSession]);

  const handleNumberSubmit = useCallback(async () => {
    if (numberInput.length !== 6) {
      Alert.alert('無效代碼', '請輸入 6 位數字密碼');
      return;
    }
    await handleCheckIn({ method: 'number_code', code: numberInput });
    setNumberInput('');
  }, [numberInput, handleCheckIn]);

  const openScanner = useCallback(async () => {
    try {
      const permission = cameraPermission?.granted
        ? cameraPermission : await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert('需要相機權限', '請在設定中允許相機，或輸入教師提供的 6 位簽到密碼。');
        return;
      }
      scanHandled.current = false;
      setScanning(true);
    } catch {
      Alert.alert('無法開啟相機', '請改用教師提供的 6 位簽到密碼。');
    }
  }, [cameraPermission, requestCameraPermission]);

  const handleQRScanned = useCallback(({ data }: { data: string }) => {
    if (scanHandled.current) return;
    scanHandled.current = true;
    setScanning(false);
    void handleCheckIn({ method: 'rotating_qr', code: data });
  }, [handleCheckIn]);

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
          <Text style={s.loadingText}>
            {loading ? '載入點名資料...' : loadError ? '無法載入點名資料' : '找不到此點名場次'}
          </Text>
          {!loading && <TouchableOpacity onPress={loadSession}><Text>重試</Text></TouchableOpacity>}
          <TouchableOpacity onPress={() => navigation.goBack()}><Text>返回</Text></TouchableOpacity>
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
                <Text style={[s.statNum, { color: '#34C759' }]}>{stats.present}</Text>
                <Text style={s.statLabel}>出席</Text>
              </View>
              <View style={[s.statCard, { backgroundColor: '#FEF3C7' }]}>
                <Text style={[s.statNum, { color: '#FF9500' }]}>{stats.late}</Text>
                <Text style={s.statLabel}>遲到</Text>
              </View>
              <View style={[s.statCard, { backgroundColor: '#FEE2E2' }]}>
                <Text style={[s.statNum, { color: '#FF3B30' }]}>{stats.absent}</Text>
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
                <View>
                  <RotatingQRDisplay sessionId={sessionId} secret={session.qrSecret} />
                  <Text style={s.codeHint}>無法掃描時，可輸入密碼：{session.numberCode}</Text>
                </View>
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
            ) : session.status !== 'active' ? (
              <Text style={s.manualModeText}>點名已結束，無法再簽到</Text>
            ) : session.mode === 'manual' ? (
              <Text style={s.manualModeText}>此場次由教師手動點名，請向教師確認出席狀態。</Text>
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
                {session.mode === 'number_code' ? (
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
                      disabled={submitting || numberInput.length !== 6}
                    >
                      <Ionicons name={'checkmark-circle' as any} size={20} color="#FFFFFF" />
                      <Text style={s.checkInBtnText}>確認簽到</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* QR mode */
                  <View style={s.studentQRSection}>
                    <View style={s.scanPlaceholder}>
                      <Ionicons
                        name={'scan-outline' as any}
                        size={56}
                        color={theme.colors.accent}
                      />
                      <Text style={s.scanHint}>掃描教師端的 QR 碼</Text>
                    </View>
                    <TouchableOpacity style={s.checkInBtn} onPress={openScanner} disabled={submitting}>
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
                        disabled={submitting}
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
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
          {scanning && <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleQRScanned}
          />}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setScanning(false)}
            style={{ padding: 24, paddingBottom: insets.bottom + 24 }}
          >
            <Text style={{ color: '#fff', textAlign: 'center' }}>取消掃描</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
  statNum: { fontSize: 22, fontWeight: '700' },
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
  codeDigit: { fontSize: 28, fontWeight: '700', color: theme.colors.accent },
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
  successTitle: { fontSize: 24, fontWeight: '700', color: theme.colors.success, marginTop: 12 },
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
  liveTagText: { fontSize: 11, fontWeight: '600', color: '#34C759' },

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
  studentDigitText: { fontSize: 22, fontWeight: '700', color: theme.colors.text },
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
