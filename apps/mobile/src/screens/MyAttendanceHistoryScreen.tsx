import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';
import { courseChipScrollContentStyle } from '../ui/courseChipShell';
import { safeNavigate } from '../utils/safeNavigate';
import {
  loadMyVerifiedAttendanceHistory,
  summarizeVerifiedAttendance,
  type AttendanceReceiptStatus,
  type AttendanceHistoryEntry,
  type VerifiedCourseHistory,
} from '../services/verifiedAttendanceHistory';

type HistoryState = {
  scope: string;
  loading: boolean;
  courses: VerifiedCourseHistory[];
  error: boolean;
};

const statusText: Record<AttendanceReceiptStatus, string> = {
  present: '已確認簽到',
  late: '已記錄遲到',
  absent: '已登記缺席',
  excused: '已核准請假',
  unconfirmed: '尚無簽到紀錄',
  unavailable: '暫時無法核實',
};

function formatTime(date: Date | null): string {
  return date
    ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '時間待確認';
}

function historyRecordHint(entry: AttendanceHistoryEntry): string {
  const state = entry.active ? '進行中' : '已結束';
  if (entry.source === 'manual') {
    const confirmedAt = entry.correctedAt ?? entry.checkedInAt;
    return confirmedAt ? `${state} · 教師核定 ${formatTime(confirmedAt)}` : `${state} · 教師更正`;
  }
  if (entry.checkedInAt) {
    return `${state} · ${entry.source === 'qr' ? '掃碼簽到' : '確認紀錄'} ${formatTime(entry.checkedInAt)}`;
  }
  return state;
}

export default function MyAttendanceHistoryScreen() {
  const navigation = useNavigation();
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid ?? '';
  const schoolId = school.id ?? auth.profile?.schoolId;
  const ready = !!uid && !!schoolId && !auth.loading && !auth.tokenExpired && !auth.tokenError;
  const scope = JSON.stringify([uid, schoolId, ready]);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const [state, setState] = useState<HistoryState>({
    scope,
    loading: true,
    courses: [],
    error: false,
  });

  useEffect(() => {
    let disposed = false;
    setState({ scope, loading: ready, courses: [], error: false });
    setExpanded(null);
    setVisibleCount(8);
    if (!ready) return;
    Promise.resolve().then(() => loadMyVerifiedAttendanceHistory(uid, schoolId)).then(
      (courses) => {
        if (!disposed) setState({ scope, loading: false, courses, error: false });
      },
      () => {
        if (!disposed) setState({ scope, loading: false, courses: [], error: true });
      },
    );
    return () => {
      disposed = true;
    };
  }, [scope, ready, uid, schoolId, revision]);

  const current = state.scope === scope ? state : { scope, loading: true, courses: [], error: false };
  const stats = useMemo(() => summarizeVerifiedAttendance(current.courses), [current.courses]);
  const invalidCourses = current.courses.filter((course) => course.error).length;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={courseChipScrollContentStyle(true)}
      accessibilityLabel="個人課堂點名紀錄"
      refreshControl={
        <RefreshControl
          refreshing={current.loading && revision > 0}
          onRefresh={() => setRevision((value) => value + 1)}
          tintColor={theme.colors.accent}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.heading}>
          <View style={styles.headingIcon}>
            <Ionicons name="checkmark-done-outline" size={24} color={theme.colors.accent} />
          </View>
          <View style={styles.headingText}>
            <Text style={styles.title}>我的課堂出席</Text>
            <Text style={styles.subtitle}>以課堂系統保存的個人紀錄為準</Text>
          </View>
        </View>

        {!uid && !auth.loading ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>請先登入校園帳號</Text>
            <Text style={styles.muted}>登入後才能確認屬於你的課程與簽到紀錄。</Text>
          </View>
        ) : !ready && !auth.loading ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>目前無法確認登入資格</Text>
            <Text style={styles.muted}>請更新登入狀態，再重新載入出席紀錄。</Text>
          </View>
        ) : current.loading ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.muted}>正在向課堂系統核對紀錄…</Text>
          </View>
        ) : current.error ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>出席紀錄暫時無法讀取</Text>
            <Text style={styles.muted}>請檢查網路後重試。未查到的資料不會被算成缺席。</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setRevision((v) => v + 1)}>
              <Text style={styles.actionText}>重新載入</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryEyebrow}>已確認的簽到</Text>
              <Text style={styles.summaryValue}>{stats.confirmed}<Text style={styles.summaryUnit}> 次</Text></Text>
              <Text style={styles.summaryDescription}>
                最近每門課最多 30 場點名 · 只有教師系統保存的紀錄會列為已簽到
              </Text>
              <View style={styles.metrics}>
                <View style={styles.metric}><Text style={styles.metricValue}>{stats.sessions}</Text><Text style={styles.metricLabel}>可查場次</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{stats.unconfirmed}</Text><Text style={styles.metricLabel}>尚無紀錄</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{stats.excused}</Text><Text style={styles.metricLabel}>已核假</Text></View>
              </View>
            </View>
            {(stats.unavailable > 0 || invalidCourses > 0) && (
              <View style={styles.warningPanel}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
                <Text style={styles.warningText}>
                  有 {stats.unavailable} 場點名、{invalidCourses} 門課暫時無法核實。下拉重新整理，不會推定為缺席。
                </Text>
              </View>
            )}
            {stats.absent > 0 && (
              <View style={styles.notePanel}>
                <Text style={styles.muted}>教師已正式登記缺席：{stats.absent} 次。若有疑義請向授課教師申請更正。</Text>
              </View>
            )}
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>各課程紀錄</Text>
              <Text style={styles.sectionCaption}>{current.courses.length} 門課</Text>
            </View>
            {current.courses.length === 0 ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>目前沒有可驗證的課堂點名</Text>
                <Text style={styles.muted}>這裡只顯示 Campus One 正式課程。外部 LMS 的資料尚未匯入時，不會以範例成績取代。</Text>
              </View>
            ) : (
              current.courses.map((course) => {
                const complete = course.sessions.filter((row) => row.status === 'present' || row.status === 'late').length;
                const isExpanded = expanded === course.courseId;
                return (
                  <View key={course.courseId} style={styles.courseCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`展開${course.courseName}點名紀錄`}
                      accessibilityState={{ expanded: isExpanded }}
                      style={styles.courseTop}
                      onPress={() => { setExpanded(isExpanded ? null : course.courseId); setVisibleCount(8); }}
                    >
                      <View style={styles.courseTitleArea}>
                        <Text style={styles.courseName} numberOfLines={2}>{course.courseName}</Text>
                        <Text style={styles.courseSub}>
                          {course.error ? '紀錄無法讀取' : `已確認 ${complete} 次 · 最近 ${course.sessions.length} 場`}
                        </Text>
                      </View>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.muted} />
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.courseDetails}>
                        {course.sessions.length === 0 ? (
                          <Text style={styles.muted}>{course.error ? '這門課目前無法讀取，請稍後重試。' : '尚無正式點名場次。'}</Text>
                        ) : (
                          course.sessions.slice(0, visibleCount).map((entry) => {
                            const verified = entry.status === 'present' || entry.status === 'late';
                            return (
                              <View key={entry.sessionId} style={styles.recordRow}>
                                <View style={styles.recordMain}>
                                  <Text style={styles.recordDate}>{formatTime(entry.startedAt)}</Text>
                                  <Text style={styles.recordHint}>{historyRecordHint(entry)}</Text>
                                </View>
                                <Text style={[styles.recordStatus, verified ? styles.successText : entry.status === 'unconfirmed' || entry.status === 'unavailable' ? styles.mutedText : styles.warningStatus]}>
                                  {statusText[entry.status]}
                                </Text>
                              </View>
                            );
                          })
                        )}
                        {course.sessions.length > visibleCount && (
                          <Pressable
                            accessibilityRole="button"
                            style={styles.secondaryButton}
                            onPress={() => setVisibleCount((count) => Math.min(count + 8, course.sessions.length))}
                          >
                            <Text style={styles.actionText}>顯示更多紀錄（剩餘 {course.sessions.length - visibleCount} 場）</Text>
                            <Ionicons name="chevron-down-outline" size={16} color={theme.colors.accent} />
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          style={styles.secondaryButton}
                          onPress={() => safeNavigate(navigation, 'AttendanceMultiMethod', { courseId: course.courseId })}
                        >
                          <Text style={styles.actionText}>前往課堂簽到</Text>
                          <Ionicons name="arrow-forward" size={17} color={theme.colors.accent} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })
            )}
            <Text style={styles.footer}>
              「尚無紀錄」不是缺席。系統只統計可驗證的簽到收據；若有請假或外部教務資料，請以學校正式紀錄為準。
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.surfaceMuted },
  content: { gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  headingIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  headingText: { flex: 1, gap: 3 },
  title: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.muted },
  summary: { padding: 22, borderRadius: 22, backgroundColor: theme.colors.surfaceElevated, borderWidth: 1, borderColor: theme.colors.border, gap: 5 },
  summaryEyebrow: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  summaryValue: { fontSize: 44, fontWeight: '800', color: theme.colors.accent, fontVariant: ['tabular-nums'] },
  summaryUnit: { fontSize: 16, fontWeight: '500', color: theme.colors.muted },
  summaryDescription: { fontSize: 12, lineHeight: 20, color: theme.colors.muted },
  metrics: { flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 14 },
  metric: { flex: 1, alignItems: 'center', gap: 3 },
  metricValue: { fontSize: 22, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 12, color: theme.colors.textSecondary },
  panel: { padding: 22, borderRadius: 18, gap: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  panelTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  muted: { color: theme.colors.muted, lineHeight: 21, fontSize: 13 },
  loadingPanel: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  sectionCaption: { fontSize: 12, color: theme.colors.muted },
  courseCard: { backgroundColor: theme.colors.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' },
  courseTop: { padding: 18, flexDirection: 'row', alignItems: 'center', minHeight: 80, gap: 12 },
  courseTitleArea: { flex: 1, gap: 6 },
  courseName: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  courseSub: { fontSize: 12, color: theme.colors.muted },
  courseDetails: { borderTopWidth: 1, borderTopColor: theme.colors.border, padding: 16, gap: 12 },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8 },
  recordMain: { flex: 1, gap: 3 },
  recordDate: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  recordHint: { fontSize: 11, color: theme.colors.muted },
  recordStatus: { fontSize: 12, fontWeight: '600' },
  successText: { color: theme.colors.success },
  mutedText: { color: theme.colors.muted },
  warningStatus: { color: theme.colors.warning },
  secondaryButton: { marginTop: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.colors.accentSoft },
  actionText: { color: theme.colors.accent, fontWeight: '700', fontSize: 13 },
  warningPanel: { padding: 14, borderRadius: 14, backgroundColor: theme.colors.warningSoft, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  warningText: { flex: 1, fontSize: 12, lineHeight: 18, color: theme.colors.text },
  notePanel: { padding: 14, borderRadius: 14, backgroundColor: theme.colors.surface },
  footer: { fontSize: 12, color: theme.colors.muted, lineHeight: 21, paddingVertical: 16 },
});
