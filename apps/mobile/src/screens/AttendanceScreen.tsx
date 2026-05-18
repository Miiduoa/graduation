/* eslint-disable */
/**
 * AttendanceScreen v4 — 智慧點名中樞
 *
 * 角色自適應設計：
 * - 學生：出席率總覽 → 進行中的點名提示 → 各課程出席 → 請假
 * - 教師：今日課程 → 一鍵啟動點名 → 近期紀錄 → 假單審核
 * - 管理員：全系出席率 → 風險學生 → 統計報表
 *
 * 真實使用情境：
 * 1. 教師上課前開啟 APP → 看到「今日課程」→ 點「啟動點名」→ 選模式 → 進入 Live
 * 2. 學生收到通知 → 開啟「進行中的點名」→ 掃 QR 或輸入密碼 → 簽到完成
 * 3. 學生事後可在此查看每門課出席率、申請請假
 * 4. 教師可審核假單、查看班級出席統計
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { usePermissions } from '../hooks/usePermissions';
import { earnXP } from '../services/gamificationEngine';
import {
  type AttendanceCourse,
  type AttendanceSession,
  type AttendanceMode,
  type LeaveRequest,
  type LeaveCategory,
  getAttendanceCourses,
  getActiveSessions,
  getActiveSessionsForStudent,
  getAllSessions,
  createSession,
  getStudentAnalytics,
  getLeaveRequests,
  submitLeaveRequest,
  reviewLeaveRequest,
  getModeName,
  getModeIcon,
  getStatusColor,
  getHighRiskStudents,
  type HighRiskStudent,
  getAdminAnalytics,
  type AdminAnalytics,
} from '../services/smartAttendanceEngine';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ============================================================================
// Sub-components
// ============================================================================

function GroupedCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: theme.space.lg,
        marginTop: 28,
        marginBottom: 10,
      }}
    >
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 13,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {title}
      </Text>
      {trailing}
    </View>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const LEAVE_CATEGORIES: { id: LeaveCategory; label: string; icon: string }[] = [
  { id: 'medical', label: '病假', icon: 'heart' },
  { id: 'family', label: '家事假', icon: 'home' },
  { id: 'official', label: '公假', icon: 'briefcase' },
  { id: 'personal', label: '事假', icon: 'person' },
  { id: 'other', label: '其他', icon: 'help-circle' },
];

// ============================================================================
// Main Component
// ============================================================================

export function AttendanceScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { isTeacher: permIsTeacher, isAdmin, isDepartmentHead } = usePermissions();

  // ── State ──
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courses, setCourses] = useState<AttendanceCourse[]>([]);
  const [activeSessions, setActiveSessions] = useState<AttendanceSession[]>([]);
  const [completedSessions, setCompletedSessions] = useState<AttendanceSession[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [overallRate, setOverallRate] = useState(0);
  const [riskStudents, setRiskStudents] = useState<HighRiskStudent[]>([]);
  const [adminAnalytics, setAdminAnalytics] = useState<AdminAnalytics | null>(null);

  // ── Role detection: combine permissions + course data ──
  const routeIsTeacher = props?.route?.params?.isTeacher as boolean | undefined;
  const teacherCourses = useMemo(
    () => courses.filter((c) => c.role === 'teacher' || c.role === 'ta'),
    [courses],
  );
  const studentCourses = useMemo(() => courses.filter((c) => c.role === 'student'), [courses]);
  const isTeacher = routeIsTeacher ?? permIsTeacher ?? teacherCourses.length > 0;
  const myCourses = isTeacher ? teacherCourses : studentCourses;

  // ── Create session state ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<AttendanceCourse | null>(null);
  const [selectedMode, setSelectedMode] = useState<AttendanceMode>('rotating_qr');
  const [locationInput, setLocationInput] = useState('');

  // ── Leave request state ──
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveCategory, setLeaveCategory] = useState<LeaveCategory>('medical');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveCourseId, setLeaveCourseId] = useState('');

  // ── Data loading ──
  const loadData = useCallback(async () => {
    try {
      const allCourses = await getAttendanceCourses();
      setCourses(allCourses);

      if (isTeacher) {
        // 教師：看所有進行中場次
        const active = await getActiveSessions();
        setActiveSessions(active);
        const leaves = await getLeaveRequests();
        setLeaveRequests(leaves);
        // 載入高風險學生
        const risks = await getHighRiskStudents();
        setRiskStudents(risks);
        // 管理者：載入全系統計
        if (isAdmin || isDepartmentHead) {
          const analytics = await getAdminAnalytics();
          setAdminAnalytics(analytics);
        }
      } else {
        // 學生：只看「我有修的課 + 老師已啟動點名」的場次
        const myEnrolledIds = allCourses.filter((c) => c.role === 'student').map((c) => c.id);
        const active = await getActiveSessionsForStudent(myEnrolledIds);
        setActiveSessions(active);
        const analytics = await getStudentAnalytics(auth.user?.uid);
        setOverallRate(analytics.overallRate);
        const myLeaves = await getLeaveRequests(undefined, auth.user?.uid);
        setLeaveRequests(myLeaves);
      }

      const all = await getAllSessions();
      setCompletedSessions(
        all.filter((s) => s.status === 'completed').sort((a, b) => b.startTime - a.startTime),
      );
    } catch (e) {
      console.error('AttendanceScreen loadData:', e);
    }
  }, [auth.user?.uid, isTeacher]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    })();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── Handlers ──
  const handleCreateSession = async () => {
    if (!selectedCourse) return Alert.alert('請選擇課程');
    try {
      const session = await createSession({
        courseId: selectedCourse.id,
        tcCourseId: selectedCourse.tcId,
        courseName: selectedCourse.name,
        courseCode: selectedCourse.courseCode,
        teacherId: auth.user?.uid || 'T001',
        teacherName: auth.profile?.displayName || '教師',
        mode: selectedMode,
        location: locationInput || undefined,
      });
      setShowCreateModal(false);
      // ── Demo：emit critical 推播給該課所有學生 ──
      try {
        const { simulateTeacherOpenAttendance } = await import('../services/demoActionSimulator');
        await simulateTeacherOpenAttendance({
          teacherUid: auth.user?.uid || 'T001',
          teacherName: auth.profile?.displayName || '教師',
          courseId: Number(selectedCourse.id) || 0,
          courseName: selectedCourse.name,
          method: (selectedMode === 'rotating_qr' || selectedMode === 'number_code') ? selectedMode : 'rotating_qr',
          classroomLocation: locationInput,
          studentUids: ['demo_student_kuchih'],
        });
      } catch { /* swallow demo emit failures */ }
      nav?.navigate?.('AttendanceLive', { sessionId: session.id, isTeacher: true });
      earnXP('attend_class');
    } catch (e) {
      Alert.alert('建立失敗', '請稍後再試');
    }
  };

  const handleSubmitLeave = async () => {
    if (!leaveReason.trim()) return Alert.alert('請輸入原因');
    const course = courses.find((c) => c.id === leaveCourseId) || studentCourses[0];
    if (!course) return;
    try {
      await submitLeaveRequest({
        studentId: auth.user?.uid || 'S001',
        studentName: auth.profile?.displayName || '學生',
        courseId: course.id,
        courseName: course.name,
        sessionId: '',
        reason: leaveReason,
        category: leaveCategory,
      });
      try {
        const { aiBrain } = await import('../services/aiBrain');
        aiBrain.reportToolOutcome(
          'request_leave',
          {
            courseId: course.id,
            courseName: course.name,
            category: leaveCategory,
            reason: leaveReason.slice(0, 80),
          },
          'success',
          undefined,
          `${course.name}請假（${leaveCategory}）：${leaveReason.slice(0, 40)}`,
        );
      } catch (brainErr) {
        console.warn('[Attendance] brain.observe failed:', brainErr);
      }
      Alert.alert('已提交', '假單已送出，等待教師審核');
      setShowLeaveModal(false);
      setLeaveReason('');
      await loadData();
    } catch (e: any) {
      try {
        const { aiBrain } = await import('../services/aiBrain');
        aiBrain.reportToolOutcome(
          'request_leave',
          { courseId: course.id, category: leaveCategory },
          'failure',
          e?.message,
        );
      } catch (brainErr) {
        console.warn('[Attendance] brain.observe failed:', brainErr);
      }
      Alert.alert('提交失敗');
    }
  };

  const handleReviewLeave = async (id: string, approved: boolean) => {
    await reviewLeaveRequest(id, approved, approved ? '已批准' : '不予批准');
    await loadData();
  };

  // ── Derived ──
  const pendingLeaves = leaveRequests.filter((r) => r.status === 'pending');
  const rateColor =
    overallRate >= 85 ? theme.colors.success : overallRate >= 70 ? '#FF9500' : theme.colors.danger;
  const todayStr = new Date().toLocaleDateString('zh-TW', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  // ── Loading ──
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.muted, marginTop: 12, fontSize: 14 }}>
          載入課程資料...
        </Text>
      </View>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        {/* ═══ Header ═══ */}
        <LinearGradient
          colors={
            theme.mode === 'dark'
              ? (['#1A0A3E', '#0D1B3E', theme.colors.bg] as [string, string, string])
              : (['#F2F2F7', '#FFFFFF', theme.colors.bg] as [string, string, string])
          }
          style={{ paddingTop: insets.top + 12, paddingBottom: 24 }}
        >
          {/* Back + Title */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: theme.space.lg,
              marginBottom: 16,
            }}
          >
            <Pressable onPress={() => nav?.goBack?.()} hitSlop={12} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 24, fontWeight: '700', color: theme.colors.text }}>
                智慧點名
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                {todayStr}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: isTeacher ? theme.colors.accent : theme.colors.success,
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 100,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
                {isTeacher ? '教師' : '學生'} · {myCourses.length} 門課
              </Text>
            </View>
          </View>

          {/* ── 智慧簽到入口 ── */}
          <Pressable
            onPress={() =>
              nav?.navigate?.('AttendanceMultiMethod', {
                courseId: myCourses[0]?.id ?? 'demo',
                sessionId: `demo-${Date.now()}`,
              })
            }
            style={{
              marginHorizontal: theme.space.lg,
              marginBottom: 12,
              padding: 14,
              borderRadius: 12,
              backgroundColor: '#34C759',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'center',
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
              智慧簽到（5 種方式）
            </Text>
          </Pressable>

          {/* Stats Row */}
          <View
            style={{
              flexDirection: 'row',
              marginHorizontal: theme.space.lg,
              backgroundColor: theme.colors.surface,
              borderRadius: 16,
              overflow: 'hidden',
            }}
          >
            {isTeacher ? (
              <>
                <StatPill
                  label="進行中"
                  value={activeSessions.length}
                  color={activeSessions.length > 0 ? theme.colors.danger : theme.colors.text}
                />
                <View
                  style={{ width: 1, backgroundColor: theme.colors.border, marginVertical: 12 }}
                />
                <StatPill
                  label="本學期"
                  value={completedSessions.length}
                  color={theme.colors.text}
                />
                <View
                  style={{ width: 1, backgroundColor: theme.colors.border, marginVertical: 12 }}
                />
                <StatPill
                  label="待審假單"
                  value={pendingLeaves.length}
                  color={pendingLeaves.length > 0 ? '#FF9500' : theme.colors.text}
                />
              </>
            ) : (
              <>
                <StatPill label="出席率" value={`${overallRate}%`} color={rateColor} />
                <View
                  style={{ width: 1, backgroundColor: theme.colors.border, marginVertical: 12 }}
                />
                <StatPill label="修課" value={studentCourses.length} color={theme.colors.text} />
                <View
                  style={{ width: 1, backgroundColor: theme.colors.border, marginVertical: 12 }}
                />
                <StatPill label="請假" value={leaveRequests.length} color={theme.colors.text} />
              </>
            )}
          </View>
        </LinearGradient>

        {/* ═══ Active Sessions Alert ═══ */}
        {activeSessions.length > 0 && (
          <>
            <SectionHeader title="進行中的點名" />
            <GroupedCard>
              {activeSessions.map((session, idx) => (
                <Pressable
                  key={session.id}
                  onPress={() =>
                    nav?.navigate?.('AttendanceLive', { sessionId: session.id, isTeacher })
                  }
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 16,
                    paddingHorizontal: 16,
                    borderBottomWidth: idx < activeSessions.length - 1 ? 1 : 0,
                    borderBottomColor: theme.colors.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: theme.colors.danger + '15',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: theme.colors.danger,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                      {session.courseName}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                      {session.location ? `${session.location} · ` : ''}
                      {getModeName(session.mode)}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: theme.colors.danger,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 10,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                      {isTeacher ? '管理' : '簽到'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </GroupedCard>
          </>
        )}

        {/* ═══ TEACHER: My Courses + Create ═══ */}
        {isTeacher && (
          <>
            <SectionHeader
              title="我的授課"
              trailing={
                <Text style={{ fontSize: 12, color: theme.colors.accent, fontWeight: '600' }}>
                  {teacherCourses.length} 門
                </Text>
              }
            />
            <GroupedCard>
              {teacherCourses.length === 0 ? (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Ionicons name="school-outline" size={40} color={theme.colors.muted} />
                  <Text
                    style={{
                      color: theme.colors.muted,
                      marginTop: 12,
                      fontSize: 14,
                      textAlign: 'center',
                    }}
                  >
                    尚未取得授課資料{'\n'}請先登入 E 校園帳號
                  </Text>
                </View>
              ) : (
                teacherCourses.map((course, idx) => (
                  <Pressable
                    key={course.id}
                    onPress={() => {
                      setSelectedCourse(course);
                      setLocationInput('');
                      setShowCreateModal(true);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderBottomWidth: idx < teacherCourses.length - 1 ? 1 : 0,
                      borderBottomColor: theme.colors.border,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <LinearGradient
                      colors={
                        [`${theme.colors.accent}20`, `${theme.colors.accent}08`] as [string, string]
                      }
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons name="book" size={18} color={theme.colors.accent} />
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                        {course.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                        {course.courseCode} · {course.studentCount} 位學生
                      </Text>
                    </View>
                    <View
                      style={{
                        backgroundColor: theme.colors.accent + '15',
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.accent }}>
                        啟動
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </GroupedCard>

            {/* Teacher: Leave Review */}
            {leaveRequests.length > 0 && (
              <>
                <SectionHeader
                  title="假單審核"
                  trailing={
                    pendingLeaves.length > 0 ? (
                      <View
                        style={{
                          backgroundColor: theme.colors.danger + '20',
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 100,
                        }}
                      >
                        <Text
                          style={{ fontSize: 11, fontWeight: '600', color: theme.colors.danger }}
                        >
                          {pendingLeaves.length} 待審
                        </Text>
                      </View>
                    ) : null
                  }
                />
                <GroupedCard>
                  {leaveRequests.slice(0, 10).map((req, idx) => (
                    <View
                      key={req.id}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderBottomWidth: idx < Math.min(leaveRequests.length, 10) - 1 ? 1 : 0,
                        borderBottomColor: theme.colors.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}
                          >
                            {req.studentName}
                          </Text>
                          <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                            {req.courseName} ·{' '}
                            {
                              {
                                medical: '病假',
                                family: '家事假',
                                official: '公假',
                                personal: '事假',
                                other: '其他',
                              }[req.category]
                            }
                          </Text>
                          <Text style={{ fontSize: 12, color: theme.colors.text, marginTop: 4 }}>
                            {req.reason}
                          </Text>
                          <Text style={{ fontSize: 10, color: theme.colors.muted, marginTop: 4 }}>
                            {new Date(req.submittedAt).toLocaleDateString('zh-TW')}
                          </Text>
                        </View>
                        {req.status === 'pending' ? (
                          <View style={{ flexDirection: 'row', gap: 8, marginLeft: 12 }}>
                            <Pressable
                              onPress={() => handleReviewLeave(req.id, true)}
                              style={{
                                backgroundColor: theme.colors.success,
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                justifyContent: 'center',
                                alignItems: 'center',
                              }}
                            >
                              <Ionicons name="checkmark" size={20} color="#fff" />
                            </Pressable>
                            <Pressable
                              onPress={() => handleReviewLeave(req.id, false)}
                              style={{
                                backgroundColor: theme.colors.danger,
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                justifyContent: 'center',
                                alignItems: 'center',
                              }}
                            >
                              <Ionicons name="close" size={20} color="#fff" />
                            </Pressable>
                          </View>
                        ) : (
                          <View
                            style={{
                              backgroundColor:
                                (req.status === 'approved'
                                  ? theme.colors.success
                                  : theme.colors.danger) + '15',
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 100,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '600',
                                color:
                                  req.status === 'approved'
                                    ? theme.colors.success
                                    : theme.colors.danger,
                              }}
                            >
                              {req.status === 'approved' ? '已批准' : '已拒絕'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </GroupedCard>
              </>
            )}

            {/* ═══ TEACHER: High Risk Students ═══ */}
            {riskStudents.length > 0 && (
              <>
                <SectionHeader title="高風險學生" trailing={<Text style={{ color: theme.colors.muted, fontSize: 12 }}>{riskStudents.length} 位低於 80%</Text>} />
                <GroupedCard>
                  {riskStudents.slice(0, 10).map((stu, idx) => {
                    const ratePercent = Math.round(stu.attendanceRate * 100);
                    const isDanger = ratePercent < 60;
                    const statusColor = isDanger ? '#FF3B30' : '#FF9500';
                    const statusBg = isDanger ? '#FEE2E2' : '#FEF3C7';
                    const statusLabel = isDanger ? '危險' : '警告';
                    return (
                      <View
                        key={stu.studentId || idx}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderBottomWidth: idx < Math.min(riskStudents.length, 10) - 1 ? 0.5 : 0,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: statusBg,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                          }}
                        >
                          <Ionicons
                            name={isDanger ? 'warning' : 'alert-circle'}
                            size={18}
                            color={statusColor}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: theme.colors.text,
                              fontSize: 15,
                              fontWeight: '600',
                            }}
                          >
                            {stu.studentName}
                          </Text>
                          <Text
                            style={{
                              color: theme.colors.muted,
                              fontSize: 12,
                              marginTop: 2,
                            }}
                          >
                            {stu.courseName ?? '未知課程'} · 缺席 {stu.absences}/{stu.totalSessions} 次
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text
                            style={{
                              color: statusColor,
                              fontSize: 16,
                              fontWeight: '700',
                            }}
                          >
                            {ratePercent}%
                          </Text>
                          <View
                            style={{
                              backgroundColor: statusBg,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 4,
                              marginTop: 2,
                            }}
                          >
                            <Text
                              style={{
                                color: statusColor,
                                fontSize: 10,
                                fontWeight: '600',
                              }}
                            >
                              {statusLabel}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {riskStudents.length > 10 && (
                    <View style={{ padding: 12, alignItems: 'center' }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                        還有 {riskStudents.length - 10} 位高風險學生...
                      </Text>
                    </View>
                  )}
                </GroupedCard>
              </>
            )}
          </>
        )}

        {/* ═══ STUDENT: Course Attendance ═══ */}
        {!isTeacher && (
          <>
            <SectionHeader title="各課程出席" />
            <GroupedCard>
              {studentCourses.length === 0 ? (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Ionicons name="book-outline" size={40} color={theme.colors.muted} />
                  <Text
                    style={{
                      color: theme.colors.muted,
                      marginTop: 12,
                      fontSize: 14,
                      textAlign: 'center',
                    }}
                  >
                    尚未取得課程資料{'\n'}請先登入 E 校園帳號
                  </Text>
                </View>
              ) : (
                studentCourses.map((course, idx) => {
                  const rc =
                    course.rate >= 85
                      ? theme.colors.success
                      : course.rate >= 70
                        ? '#FF9500'
                        : theme.colors.danger;
                  return (
                    <View
                      key={course.id}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderBottomWidth: idx < studentCourses.length - 1 ? 1 : 0,
                        borderBottomColor: theme.colors.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}
                          >
                            {course.name}
                          </Text>
                          <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                            {course.instructorName} · {course.courseCode}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 20, fontWeight: '700', color: rc }}>
                          {course.rate}%
                        </Text>
                      </View>
                      {/* Progress bar */}
                      <View
                        style={{
                          height: 4,
                          backgroundColor: theme.colors.border,
                          borderRadius: 2,
                          marginTop: 10,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            height: '100%',
                            width: `${course.rate}%`,
                            backgroundColor: rc,
                            borderRadius: 2,
                          }}
                        />
                      </View>
                      {/* Stats chips */}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <Text style={{ fontSize: 11, color: theme.colors.success }}>
                          出席 {course.attended}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#FF9500' }}>遲到 {course.late}</Text>
                        <Text style={{ fontSize: 11, color: theme.colors.danger }}>
                          缺席 {course.absent}
                        </Text>
                        {course.leave > 0 && (
                          <Text style={{ fontSize: 11, color: theme.colors.accent }}>
                            請假 {course.leave}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </GroupedCard>

            {/* Student: Quick leave + My requests */}
            <SectionHeader title="請假" />
            <GroupedCard>
              <Pressable
                onPress={() => {
                  setLeaveCourseId(studentCourses[0]?.id || '');
                  setShowLeaveModal(true);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  borderBottomWidth: leaveRequests.length > 0 ? 1 : 0,
                  borderBottomColor: theme.colors.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <LinearGradient
                  colors={['#FF950020', '#FF950008'] as [string, string]}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name="add-circle" size={18} color="#FF9500" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                    申請請假
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                    有事無法出席可以先申請
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
              </Pressable>

              {leaveRequests.slice(0, 5).map((req, idx) => (
                <View
                  key={req.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderBottomWidth: idx < Math.min(leaveRequests.length, 5) - 1 ? 1 : 0,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor:
                        (req.status === 'pending'
                          ? '#FF9500'
                          : req.status === 'approved'
                            ? theme.colors.success
                            : theme.colors.danger) + '15',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Ionicons
                      name={
                        req.status === 'pending'
                          ? 'time'
                          : req.status === 'approved'
                            ? 'checkmark-circle'
                            : 'close-circle'
                      }
                      size={18}
                      color={
                        req.status === 'pending'
                          ? '#FF9500'
                          : req.status === 'approved'
                            ? theme.colors.success
                            : theme.colors.danger
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '500', color: theme.colors.text }}>
                      {req.courseName}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                      {req.reason} · {new Date(req.submittedAt).toLocaleDateString('zh-TW')}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor:
                        (req.status === 'pending'
                          ? '#FF9500'
                          : req.status === 'approved'
                            ? theme.colors.success
                            : theme.colors.danger) + '15',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 100,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '600',
                        color:
                          req.status === 'pending'
                            ? '#FF9500'
                            : req.status === 'approved'
                              ? theme.colors.success
                              : theme.colors.danger,
                      }}
                    >
                      {{ pending: '審核中', approved: '已批准', rejected: '已拒絕' }[req.status]}
                    </Text>
                  </View>
                </View>
              ))}
            </GroupedCard>
          </>
        )}

        {/* ═══ Recent Sessions (shared) ═══ */}
        {completedSessions.length > 0 && (
          <>
            <SectionHeader title="近期點名紀錄" />
            <GroupedCard>
              {completedSessions.slice(0, 8).map((session, idx) => {
                const rate =
                  session.totalStudents > 0
                    ? Math.round(
                        ((session.presentCount + session.lateCount) / session.totalStudents) * 100,
                      )
                    : 0;
                const rc =
                  rate >= 80 ? theme.colors.success : rate >= 60 ? '#FF9500' : theme.colors.danger;
                return (
                  <View
                    key={session.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderBottomWidth: idx < Math.min(completedSessions.length, 8) - 1 ? 1 : 0,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        backgroundColor: rc + '15',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: rc }}>{rate}%</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '500', color: theme.colors.text }}>
                        {session.courseName}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                        {new Date(session.startTime).toLocaleDateString('zh-TW')} ·{' '}
                        {getModeName(session.mode)}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                      {session.presentCount + session.lateCount}/{session.totalStudents}
                    </Text>
                  </View>
                );
              })}
            </GroupedCard>
          </>
        )}

        {/* ═══ ADMIN: Department Analytics ═══ */}
        {(isAdmin || isDepartmentHead) && adminAnalytics && (
          <>
            <SectionHeader title="全系出席總覽" trailing={<Text style={{ color: theme.colors.muted, fontSize: 12 }}>管理者儀表板</Text>} />
            <GroupedCard>
              {/* 總覽數字 */}
              <View
                style={{
                  flexDirection: 'row',
                  paddingVertical: 16,
                  paddingHorizontal: 16,
                  borderBottomWidth: 0.5,
                  borderBottomColor: theme.colors.border,
                }}
              >
                {[
                  { label: '課程數', value: adminAnalytics.totalCourses, icon: 'book' as const },
                  { label: '點名場次', value: adminAnalytics.totalSessions, icon: 'clipboard' as const },
                  { label: '風險學生', value: adminAnalytics.riskStudentCount, icon: 'warning' as const },
                ].map((item, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={item.icon === 'warning' && item.value > 0 ? '#FF3B30' : theme.colors.accent}
                    />
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontSize: 20,
                        fontWeight: '700',
                        marginTop: 4,
                      }}
                    >
                      {item.value}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
              {/* 全系平均出席率 */}
              <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: theme.colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>
                    全系平均出席率
                  </Text>
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '700',
                      color: adminAnalytics.overallAttendanceRate >= 80
                        ? theme.colors.success
                        : adminAnalytics.overallAttendanceRate >= 60
                          ? '#FF9500'
                          : '#FF3B30',
                    }}
                  >
                    {adminAnalytics.overallAttendanceRate}%
                  </Text>
                </View>
                <View
                  style={{
                    height: 6,
                    backgroundColor: theme.colors.border,
                    borderRadius: 3,
                    marginTop: 8,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${Math.min(adminAnalytics.overallAttendanceRate, 100)}%`,
                      backgroundColor:
                        adminAnalytics.overallAttendanceRate >= 80
                          ? theme.colors.success
                          : adminAnalytics.overallAttendanceRate >= 60
                            ? '#FF9500'
                            : '#FF3B30',
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>
            </GroupedCard>

            {/* 課程排名 */}
            {adminAnalytics.courseRanking.length > 0 && (
              <>
                <SectionHeader title="課程出席率排名" trailing={<Text style={{ color: theme.colors.muted, fontSize: 12 }}>{adminAnalytics.courseRanking.length} 門課</Text>} />
                <GroupedCard>
                  {adminAnalytics.courseRanking.slice(0, 8).map((course, idx) => {
                    const rateColor =
                      course.averageRate >= 80
                        ? theme.colors.success
                        : course.averageRate >= 60
                          ? '#FF9500'
                          : '#FF3B30';
                    return (
                      <View
                        key={course.courseId}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          paddingHorizontal: 16,
                          borderBottomWidth: idx < Math.min(adminAnalytics.courseRanking.length, 8) - 1 ? 0.5 : 0,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: idx < 3 ? theme.colors.accent + '20' : theme.colors.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '700',
                              color: idx < 3 ? theme.colors.accent : theme.colors.muted,
                            }}
                          >
                            {idx + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}
                            numberOfLines={1}
                          >
                            {course.courseName}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                            {course.instructorName} · {course.sessions} 場次
                          </Text>
                        </View>
                        <Text style={{ color: rateColor, fontSize: 15, fontWeight: '700' }}>
                          {course.averageRate}%
                        </Text>
                      </View>
                    );
                  })}
                  {adminAnalytics.courseRanking.length > 8 && (
                    <View style={{ padding: 12, alignItems: 'center' }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                        還有 {adminAnalytics.courseRanking.length - 8} 門課...
                      </Text>
                    </View>
                  )}
                </GroupedCard>
              </>
            )}

            {/* 系所摘要 */}
            {adminAnalytics.departmentSummary.length > 0 && (
              <>
                <SectionHeader title="系所出席摘要" />
                <GroupedCard>
                  {adminAnalytics.departmentSummary.map((dept, idx) => (
                    <View
                      key={dept.department}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        borderBottomWidth: idx < adminAnalytics.departmentSummary.length - 1 ? 0.5 : 0,
                        borderBottomColor: theme.colors.border,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>
                          {dept.department}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                          {dept.courseCount} 門課
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: '700',
                          color: dept.avgRate >= 80 ? theme.colors.success : dept.avgRate >= 60 ? '#FF9500' : '#FF3B30',
                        }}
                      >
                        {dept.avgRate}%
                      </Text>
                    </View>
                  ))}
                </GroupedCard>
              </>
            )}
          </>
        )}

        {/* ═══ Analytics Link ═══ */}
        <SectionHeader title="深入分析" />
        <GroupedCard>
          <Pressable
            onPress={() => nav?.navigate?.('AttendanceAnalytics', { isTeacher })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 14,
              paddingHorizontal: 16,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <LinearGradient
              colors={[`${theme.colors.accent}20`, `${theme.colors.accent}08`] as [string, string]}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name="analytics" size={18} color={theme.colors.accent} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text }}>
                AI 出席分析
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                趨勢分析 · 風險預測
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        </GroupedCard>
      </ScrollView>

      {/* ═══ CREATE SESSION MODAL ═══ */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: theme.space.lg,
              paddingTop: 20,
              paddingBottom: insets.bottom + 20,
            }}
          >
            {/* Handle */}
            <View
              style={{
                width: 36,
                height: 4,
                backgroundColor: theme.colors.border,
                borderRadius: 2,
                alignSelf: 'center',
                marginBottom: 16,
              }}
            />

            <Text
              style={{ fontSize: 20, fontWeight: '700', color: theme.colors.text, marginBottom: 4 }}
            >
              啟動點名
            </Text>
            <Text style={{ fontSize: 14, color: theme.colors.muted, marginBottom: 20 }}>
              {selectedCourse?.name}
            </Text>

            {/* Mode Selection */}
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: theme.colors.textSecondary,
                marginBottom: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              點名方式
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {[
                {
                  id: 'rotating_qr' as const,
                  label: '動態 QR 碼',
                  icon: 'qr-code',
                  desc: '每 3 秒更新',
                },
                {
                  id: 'number_code' as const,
                  label: '數字密碼',
                  icon: 'keypad',
                  desc: '6 位數密碼',
                },
              ].map((mode) => {
                const sel = selectedMode === mode.id;
                return (
                  <Pressable
                    key={mode.id}
                    onPress={() => setSelectedMode(mode.id)}
                    style={{
                      flex: 1,
                      padding: 16,
                      borderRadius: 16,
                      alignItems: 'center',
                      backgroundColor: sel ? theme.colors.accent : theme.colors.surface,
                      borderWidth: sel ? 0 : 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Ionicons
                      name={mode.icon as any}
                      size={28}
                      color={sel ? '#fff' : theme.colors.accent}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '700',
                        color: sel ? '#fff' : theme.colors.text,
                        marginTop: 8,
                      }}
                    >
                      {mode.label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 10,
                        color: sel ? 'rgba(255,255,255,0.7)' : theme.colors.muted,
                        marginTop: 2,
                      }}
                    >
                      {mode.desc}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Location */}
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                color: theme.colors.textSecondary,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              上課地點（選填）
            </Text>
            <TextInput
              placeholder="例：主顧樓 201"
              value={locationInput}
              onChangeText={setLocationInput}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 14,
                color: theme.colors.text,
                fontSize: 14,
                marginBottom: 24,
              }}
              placeholderTextColor={theme.colors.muted}
            />

            {/* Start Button */}
            <Pressable
              onPress={handleCreateSession}
              style={({ pressed }) => ({
                backgroundColor: theme.colors.accent,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>啟動點名</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowCreateModal(false)}
              style={{ marginTop: 12, alignItems: 'center', paddingVertical: 12 }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 14 }}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ═══ LEAVE REQUEST MODAL ═══ */}
      <Modal
        visible={showLeaveModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLeaveModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: theme.space.lg,
              paddingTop: 20,
              paddingBottom: insets.bottom + 20,
              maxHeight: '80%',
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  backgroundColor: theme.colors.border,
                  borderRadius: 2,
                  alignSelf: 'center',
                  marginBottom: 16,
                }}
              />

              <Text
                style={{
                  fontSize: 20,
                  fontWeight: '700',
                  color: theme.colors.text,
                  marginBottom: 20,
                }}
              >
                申請請假
              </Text>

              {/* Course picker */}
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: theme.colors.textSecondary,
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                選擇課程
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 20 }}
              >
                {studentCourses.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setLeaveCourseId(c.id)}
                    style={{
                      backgroundColor:
                        leaveCourseId === c.id ? theme.colors.accent : theme.colors.surface,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 100,
                      marginRight: 8,
                      borderWidth: leaveCourseId === c.id ? 0 : 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '600',
                        color: leaveCourseId === c.id ? '#fff' : theme.colors.text,
                      }}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Category */}
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: theme.colors.textSecondary,
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                假別
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {LEAVE_CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat.id}
                    onPress={() => setLeaveCategory(cat.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor:
                        leaveCategory === cat.id ? theme.colors.accent : theme.colors.surface,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 100,
                      borderWidth: leaveCategory === cat.id ? 0 : 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={14}
                      color={leaveCategory === cat.id ? '#fff' : theme.colors.accent}
                    />
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '600',
                        color: leaveCategory === cat.id ? '#fff' : theme.colors.text,
                      }}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Reason */}
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '600',
                  color: theme.colors.textSecondary,
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                請假原因
              </Text>
              <TextInput
                placeholder="簡述請假原因..."
                value={leaveReason}
                onChangeText={setLeaveReason}
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  padding: 14,
                  color: theme.colors.text,
                  textAlignVertical: 'top',
                  minHeight: 80,
                  fontSize: 14,
                  marginBottom: 24,
                }}
                placeholderTextColor={theme.colors.muted}
              />

              <Pressable
                onPress={handleSubmitLeave}
                style={({ pressed }) => ({
                  backgroundColor: theme.colors.accent,
                  borderRadius: 14,
                  paddingVertical: 16,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>提交請假</Text>
              </Pressable>

              <Pressable
                onPress={() => setShowLeaveModal(false)}
                style={{ marginTop: 12, alignItems: 'center', paddingVertical: 12 }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 14 }}>取消</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
