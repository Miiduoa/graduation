/* eslint-disable */
/**
 * AttendanceAnalyticsScreen v4 — 出席分析
 *
 * 角色自適應：
 * - 學生：個人出席率圓環 → 各課程出席比較 → 星期模式 → 連續天數
 * - 教師：班級出席率 → 出席趨勢折線 → 風險學生列表
 *
 * 使用真實 TronClass 資料 + 簡潔 iOS 風格視覺
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Dimensions,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { usePermissions } from "../hooks/usePermissions";
import {
  type StudentAnalytics,
  type TeacherAnalytics,
  getStudentAnalytics,
  getTeacherAnalytics,
  getRiskColor,
} from "../services/smartAttendanceEngine";

const { width: SCREEN_W } = Dimensions.get("window");

// ============================================================================
// Sub-components
// ============================================================================

/** 出席率圓環 */
function RateGauge({ rate, size = 140, label }: { rate: number; size?: number; label: string }) {
  const color = rate >= 80 ? '#10B981' : rate >= 60 ? '#F59E0B' : '#EF4444';
  const strokeWidth = 10;

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
        {/* Background ring */}
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: theme.colors.border, opacity: 0.3,
        }} />
        {/* Foreground ring (simplified as colored border) */}
        <View style={{
          position: "absolute", width: size, height: size, borderRadius: size / 2,
          borderWidth: strokeWidth, borderColor: color,
          borderTopColor: rate >= 25 ? color : "transparent",
          borderRightColor: rate >= 50 ? color : "transparent",
          borderBottomColor: rate >= 75 ? color : "transparent",
          borderLeftColor: rate >= 100 ? color : "transparent",
          transform: [{ rotate: "-90deg" }],
        }} />
        {/* Center text */}
        <View style={{ alignItems: "center" }}>
          <Text style={{ color, fontSize: size * 0.24, fontWeight: "900" }}>
            {Math.round(rate)}%
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

/** 長條圖 */
function BarChart({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.min(36, (SCREEN_W - 80) / data.length - 8);

  return (
    <View style={{ height: height + 24, paddingHorizontal: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: 6, justifyContent: "center" }}>
        {data.map((item, i) => {
          const barH = Math.max(4, (item.value / maxVal) * height * 0.8);
          const color = item.value >= 80 ? '#10B981' : item.value >= 60 ? '#F59E0B' : '#EF4444';
          return (
            <View key={i} style={{ alignItems: "center", width: barWidth }}>
              <Text style={{ color: theme.colors.muted, fontSize: 9, marginBottom: 2 }}>
                {Math.round(item.value)}%
              </Text>
              <View style={{ width: barWidth, height: barH, backgroundColor: color, borderRadius: 4 }} />
              <Text style={{ color: theme.colors.muted, fontSize: 9, marginTop: 4 }} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** 分組卡片 */
function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={[s.card, style]}>{children}</View>
  );
}

// ============================================================================
// MAIN SCREEN
// ============================================================================

interface Props {
  route?: { params?: { courseId?: string; isTeacher?: boolean } };
  navigation: any;
}

export default function AttendanceAnalyticsScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { isTeacher: permIsTeacher } = usePermissions();
  const isTeacher = route?.params?.isTeacher ?? permIsTeacher;

  const [studentData, setStudentData] = useState<StudentAnalytics | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherAnalytics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      if (isTeacher) {
        const data = await getTeacherAnalytics(route?.params?.courseId);
        setTeacherData(data);
      } else {
        const data = await getStudentAnalytics();
        setStudentData(data);
      }
    } catch (e) {
      console.log('Analytics load error:', e);
    } finally {
      setLoading(false);
    }
  }, [isTeacher, route?.params?.courseId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  if (loading) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <View style={s.loadingContainer}>
          <Ionicons name={'analytics-outline' as any} size={48} color={theme.colors.muted} />
          <Text style={s.loadingText}>載入分析資料...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <LinearGradient colors={['#6C5CE7', '#A29BFE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerContent}>
          <Text style={s.headerTitle}>出席分析</Text>
          <Text style={s.headerSubtitle}>
            {isTeacher ? '班級出席狀況一覽' : '個人出席追蹤'}
          </Text>
        </View>
      </LinearGradient>

      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CONTENT_BOTTOM_PADDING + 20 }}
      >
        {/* ══════════════════════════════════════════════════════
           TEACHER VIEW
        ══════════════════════════════════════════════════════ */}
        {isTeacher && teacherData ? (
          <>
            {/* Overall rate */}
            <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
              <RateGauge rate={teacherData.averageAttendanceRate} label="平均出席率" />
              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Text style={s.summaryNum}>{teacherData.totalSessions}</Text>
                  <Text style={s.summaryLabel}>已點名</Text>
                </View>
                <View style={s.summaryItem}>
                  <Text style={s.summaryNum}>{teacherData.riskStudents.length}</Text>
                  <Text style={s.summaryLabel}>風險學生</Text>
                </View>
              </View>
            </Card>

            {/* Trend */}
            {teacherData.attendanceTrend.length > 0 && (
              <Card>
                <Text style={s.cardTitle}>出席率趨勢</Text>
                <BarChart
                  data={teacherData.attendanceTrend.map((t) => ({
                    label: t.date.slice(5),
                    value: t.rate,
                  }))}
                />
              </Card>
            )}

            {/* Risk students */}
            {teacherData.riskStudents.length > 0 && (
              <Card>
                <Text style={s.cardTitle}>需關注學生</Text>
                {teacherData.riskStudents.map((stu) => (
                  <View key={stu.studentId} style={s.riskItem}>
                    <View style={[s.riskAvatar, { backgroundColor: getRiskColor(stu.rate < 60 ? 'danger' : 'warning') }]}>
                      <Text style={s.riskAvatarText}>{stu.studentName[0]}</Text>
                    </View>
                    <View style={s.riskInfo}>
                      <Text style={s.riskName}>{stu.studentName}</Text>
                      <Text style={s.riskDetail}>缺席 {stu.absences} 次 · 出席率 {stu.rate}%</Text>
                    </View>
                    <View style={[s.riskBadge, { backgroundColor: stu.rate < 60 ? '#FEE2E2' : '#FEF3C7' }]}>
                      <Text style={[s.riskBadgeText, { color: stu.rate < 60 ? '#EF4444' : '#F59E0B' }]}>
                        {stu.rate < 60 ? '高風險' : '注意'}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </>
        ) : null}

        {/* ══════════════════════════════════════════════════════
           STUDENT VIEW
        ══════════════════════════════════════════════════════ */}
        {!isTeacher && studentData ? (
          <>
            {/* Overall rate */}
            <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
              <RateGauge rate={studentData.overallRate} label="整體出席率" />
              <View style={s.summaryRow}>
                <View style={s.summaryItem}>
                  <Ionicons name={'flame' as any} size={16} color="#F59E0B" />
                  <Text style={s.summaryNum}>{studentData.streak.current}</Text>
                  <Text style={s.summaryLabel}>連續天數</Text>
                </View>
                <View style={s.summaryItem}>
                  <Ionicons name={'trophy' as any} size={16} color="#6366F1" />
                  <Text style={s.summaryNum}>{studentData.streak.best}</Text>
                  <Text style={s.summaryLabel}>最佳紀錄</Text>
                </View>
                <View style={s.summaryItem}>
                  <Ionicons name={'shield-checkmark' as any} size={16} color={getRiskColor(studentData.riskLevel)} />
                  <Text style={[s.summaryNum, { color: getRiskColor(studentData.riskLevel) }]}>
                    {studentData.riskLevel === 'safe' ? '安全' : studentData.riskLevel === 'warning' ? '注意' : '危險'}
                  </Text>
                  <Text style={s.summaryLabel}>風險等級</Text>
                </View>
              </View>
            </Card>

            {/* Course breakdown */}
            {studentData.courseBreakdown.length > 0 && (
              <Card>
                <Text style={s.cardTitle}>各課程出席率</Text>
                <BarChart
                  data={studentData.courseBreakdown.map((c) => ({
                    label: c.courseName.length > 4 ? c.courseName.slice(0, 4) : c.courseName,
                    value: c.rate,
                  }))}
                />
              </Card>
            )}

            {/* Weekday pattern */}
            {studentData.weekdayPattern.length > 0 && (
              <Card>
                <Text style={s.cardTitle}>星期出席模式</Text>
                <View style={s.weekdayRow}>
                  {studentData.weekdayPattern.map((d) => {
                    const color = d.rate >= 85 ? '#10B981' : d.rate >= 70 ? '#F59E0B' : '#EF4444';
                    return (
                      <View key={d.day} style={s.weekdayItem}>
                        <View style={[s.weekdayBar, { height: Math.max(8, d.rate * 0.8), backgroundColor: color }]} />
                        <Text style={s.weekdayLabel}>{d.day}</Text>
                        <Text style={[s.weekdayRate, { color }]}>{d.rate}%</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* Course detail list */}
            <Card>
              <Text style={s.cardTitle}>課程出席明細</Text>
              {studentData.courseBreakdown.map((c) => (
                <View key={c.courseId} style={s.courseDetailRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.courseDetailName}>{c.courseName}</Text>
                    <Text style={s.courseDetailSub}>
                      出席 {c.attended} · 遲到 {c.late} · 缺席 {c.absent} · 請假 {c.excused}
                    </Text>
                  </View>
                  <View style={s.courseDetailRate}>
                    <Text style={[s.courseDetailRateText, { color: c.rate >= 80 ? '#10B981' : c.rate >= 60 ? '#F59E0B' : '#EF4444' }]}>
                      {c.rate}%
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: theme.colors.muted, marginTop: 12 },

  // Header
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  headerContent: {},
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },

  scroll: { flex: 1 },

  // Card
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: 12 },

  // Summary
  summaryRow: { flexDirection: 'row', marginTop: 20, gap: 24 },
  summaryItem: { alignItems: 'center' },
  summaryNum: { fontSize: 18, fontWeight: '800', color: theme.colors.text },
  summaryLabel: { fontSize: 11, color: theme.colors.muted, marginTop: 2 },

  // Risk students (teacher)
  riskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  riskAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  riskAvatarText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  riskInfo: { flex: 1, marginLeft: 12 },
  riskName: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  riskDetail: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  riskBadgeText: { fontSize: 11, fontWeight: '700' },

  // Weekday pattern (student)
  weekdayRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 100, paddingTop: 8 },
  weekdayItem: { alignItems: 'center' },
  weekdayBar: { width: 28, borderRadius: 4, minHeight: 8 },
  weekdayLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.text, marginTop: 6 },
  weekdayRate: { fontSize: 10, fontWeight: '600', marginTop: 2 },

  // Course detail (student)
  courseDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  courseDetailName: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  courseDetailSub: { fontSize: 11, color: theme.colors.muted, marginTop: 2 },
  courseDetailRate: { marginLeft: 8 },
  courseDetailRateText: { fontSize: 18, fontWeight: '800' },
});
