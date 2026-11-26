/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, LoadingState, ErrorState, SectionTitle } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { isProvidenceSchoolId } from '@campus/shared/src/schoolIds';
import { useSchool } from '../state/school';
import { SchoolLearningLinks } from '../components/SchoolLearningLinks';
import { useAuth } from '../state/auth';
import { getAnyCachedTCCourses, refreshTCCourses } from '../services/puDataCache';
import { tcFetchHomeworkActivities } from '../services/tronClassClient';
import type { TCCourse } from '../services/tronClassClient';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

// ── TronClass 作業型別 ─────────────────────────
type TCHomework = {
  id: number;
  title: string;
  courseId: number;
  courseName: string;
  end_time: string | null;
  is_closed: boolean;
  module_id: number;
  submit_times: number | null;
  homework_submissions: number[];
};

// ── TronClass 作業 API ─────────────────────────
async function fetchHomeworkForCourse(courseId: number): Promise<any[]> {
  return tcFetchHomeworkActivities(courseId);
}

// ── 日期格式化 ──────────────────────────────────
function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// ── 作業列 ──────────────────────────────────────
function HomeworkRow(props: { hw: TCHomework; isCurrent: () => boolean; first: boolean }) {
  const { hw, first } = props;
  const s = useThemeStyleSheet(createStyles);
  const now = new Date();
  const endTime = hw.end_time ? new Date(hw.end_time) : null;
  const isOverdue = endTime ? endTime < now : false;
  const hasSubmission = (hw.homework_submissions?.length ?? 0) > 0;

  let statusColor: string = theme.colors.textSecondary;
  let statusText = '進行中';
  let statusIcon: keyof typeof Ionicons.glyphMap = 'time-outline';

  if (hasSubmission) {
    statusColor = theme.colors.success;
    statusText = '已繳交';
    statusIcon = 'checkmark-circle-outline';
  } else if (hw.is_closed || isOverdue) {
    statusColor = theme.colors.danger;
    statusText = '已截止';
    statusIcon = 'close-circle-outline';
  } else if (endTime) {
    // 檢查是否快到截止時間（24小時內）
    const hoursLeft = (endTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft <= 24 && hoursLeft > 0) {
      statusColor = theme.colors.warning;
      statusText = `剩 ${Math.floor(hoursLeft)} 小時`;
      statusIcon = 'alarm-outline';
    }
  }

  const onPress = () => {
    if (!props.isCurrent()) return;
    const url = `https://tronclass.pu.edu.tw/course/${hw.courseId}/content#/homework/${hw.id}`;
    void webBrowserOpenWithPuTronClassGate(url);
  };

  const deadline = hw.end_time ? `截止 ${formatDate(hw.end_time)}` : '';

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${hw.title}，${hw.courseName}，${statusText}${deadline ? `，${deadline}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [s.row, !first && s.rowDivider, pressed && s.rowPressed]}
    >
      <View style={s.rowBody}>
        <Text style={s.rowTitle} numberOfLines={2}>
          {hw.title}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {hw.courseName}
          {deadline ? ` · ${deadline}` : ''}
        </Text>
      </View>
      <View style={s.rowStatus}>
        <Ionicons name={statusIcon} size={16} color={statusColor} />
        <Text style={[s.rowStatusText, { color: statusColor }]}>{statusText}</Text>
      </View>
      <Ionicons name="open-outline" size={14} color={theme.colors.muted} />
    </Pressable>
  );
}

// ── 主畫面 ──────────────────────────────────────
export function GroupAssignmentsScreen() {
  const auth = useAuth();
  const { school, selection, selectionReady } = useSchool();
  const schoolId = selection.schoolId;
  if (!selectionReady || auth.loading || auth.profileLoading) {
    return <LoadingState title="作業" subtitle="正在確認學校與帳號…" rows={2} />;
  }
  const uid = auth.user?.uid;
  const ownProvidence = uid && !auth.tokenExpired && auth.profile?.uid === uid
    && isProvidenceSchoolId(auth.profile.schoolId) && isProvidenceSchoolId(schoolId);
  if (!ownProvidence) {
    return (
      <Screen>
        <Card title="校方課程與作業">
          <SchoolLearningLinks key={JSON.stringify([uid, schoolId, school.name])}
            schoolId={schoolId ?? ''} schoolName={school.name} />
        </Card>
      </Screen>
    );
  }
  return <ProvidenceAssignments key={uid} />;
}

function ProvidenceAssignments() {
  const s = useThemeStyleSheet(createStyles);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const [revision, setRevision] = useState(0);
  const [homeworks, setHomeworks] = useState<TCHomework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 載入所有課程的作業
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 先取得課程列表
        let courses: TCCourse[] = (await getAnyCachedTCCourses().catch(() => null)) ?? [];
        if (cancelled || !active.current) return;
        if (courses.length === 0) {
          courses = (await refreshTCCourses().catch(() => null)) ?? [];
        }

        if (courses.length === 0) {
          if (!cancelled) {
            setHomeworks([]);
            setLoading(false);
          }
          return;
        }

        if (cancelled || !active.current) return;
        // 平行取得每門課的作業
        const allHomeworks: TCHomework[] = [];
        const results = await Promise.allSettled(
          courses.map(async (course) => {
            const rawHomeworks = await fetchHomeworkForCourse(course.id);
            return rawHomeworks.map((hw: any) => ({
              id: hw.id,
              title: hw.title ?? '',
              courseId: course.id,
              courseName: course.name,
              end_time: hw.end_time ?? null,
              is_closed: hw.is_closed === true,
              module_id: hw.module_id ?? 0,
              submit_times: hw.submit_times ?? null,
              homework_submissions: Array.isArray(hw.homework_submissions)
                ? hw.homework_submissions
                : [],
            }));
          }),
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            allHomeworks.push(...r.value);
          }
        }

        // 依截止時間排序：未截止的排前面，已截止的排後面
        allHomeworks.sort((a, b) => {
          const aEnded = a.is_closed || (a.end_time ? new Date(a.end_time) < new Date() : false);
          const bEnded = b.is_closed || (b.end_time ? new Date(b.end_time) < new Date() : false);
          if (aEnded !== bEnded) return aEnded ? 1 : -1;
          // 都未截止：按截止時間近到遠
          if (a.end_time && b.end_time)
            return new Date(a.end_time).getTime() - new Date(b.end_time).getTime();
          if (a.end_time) return -1;
          if (b.end_time) return 1;
          return 0;
        });

        if (!cancelled) {
          setHomeworks(allHomeworks);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? '載入作業失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [revision]);

  // 統計
  const pendingCount = useMemo(
    () =>
      homeworks.filter((hw) => {
        const hasSubmission = (hw.homework_submissions?.length ?? 0) > 0;
        const isEnded = hw.is_closed || (hw.end_time ? new Date(hw.end_time) < new Date() : false);
        return !hasSubmission && !isEnded;
      }).length,
    [homeworks],
  );
  const submittedCount = useMemo(
    () => homeworks.filter((hw) => (hw.homework_submissions?.length ?? 0) > 0).length,
    [homeworks],
  );

  if (loading) {
    return <LoadingState title="作業" subtitle="正在載入所有課程的作業..." rows={4} />;
  }

  if (error) {
    return (
      <ErrorState
        title="作業"
        subtitle="載入作業失敗"
        hint={error}
        actionText="重試"
        onAction={() => setRevision((value) => value + 1)}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }]}
      >
        {/* 統計概覽 */}
        <View style={s.summary} accessibilityRole="summary">
          <View style={s.summaryCell}>
            <Text style={s.summaryValue}>{homeworks.length}</Text>
            <Text style={s.summaryLabel}>全部作業</Text>
          </View>
          <View style={[s.summaryCell, s.summaryDivider]}>
            <Text
              style={[
                s.summaryValue,
                { color: pendingCount > 0 ? theme.colors.warning : theme.colors.muted },
              ]}
            >
              {pendingCount}
            </Text>
            <Text style={s.summaryLabel}>待繳交</Text>
          </View>
          <View style={[s.summaryCell, s.summaryDivider]}>
            <Text style={[s.summaryValue, { color: theme.colors.success }]}>{submittedCount}</Text>
            <Text style={s.summaryLabel}>已繳交</Text>
          </View>
        </View>

        {/* 作業列表 */}
        {homeworks.length > 0 ? (
          <View style={s.section}>
            <SectionTitle text={`共 ${homeworks.length} 份作業`} />
            <View style={s.group}>
              {homeworks.map((hw, index) => (
                <HomeworkRow
                  key={`hw-${hw.courseId}-${hw.id}`}
                  hw={hw}
                  first={index === 0}
                  isCurrent={() => active.current}
                />
              ))}
            </View>
          </View>
        ) : (
          <Card title="目前沒有作業" subtitle="所有課程都沒有指派作業">
            <Text style={s.emptyText}>當老師在 TronClass 上指派作業時，會顯示在這裡。</Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    scroll: { flex: 1 },
    content: {
      gap: theme.layout.sectionGap,
      padding: theme.layout.screenPadding,
    },
    summary: {
      flexDirection: 'row',
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    summaryCell: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: theme.space.md,
    },
    summaryDivider: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.separator,
    },
    summaryValue: {
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 22,
      lineHeight: 28,
    },
    summaryLabel: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    section: { gap: theme.space.sm },
    group: {
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm + 4,
      minHeight: 56,
      paddingVertical: theme.layout.listItemVertical,
      paddingHorizontal: theme.space.md,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    rowPressed: { backgroundColor: theme.colors.surfaceInteractive },
    rowBody: { flex: 1 },
    rowTitle: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 15,
      lineHeight: 21,
    },
    rowMeta: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },
    rowStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rowStatusText: { fontWeight: '600', fontSize: 13 },
    emptyText: { color: theme.colors.textSecondary, lineHeight: 22 },
  });
