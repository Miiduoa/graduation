/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import { Screen, Card, Pill, LoadingState, ErrorState, SectionTitle } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { getCachedTCCourses, refreshTCCourses } from '../services/puDataCache';
import { tcFetchHomeworkActivities } from '../services/tronClassClient';
import type { TCCourse } from '../services/tronClassClient';

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

// ── 作業卡片 ────────────────────────────────────
function HomeworkCard(props: { hw: TCHomework }) {
  const { hw } = props;
  const now = new Date();
  const endTime = hw.end_time ? new Date(hw.end_time) : null;
  const isOverdue = endTime ? endTime < now : false;
  const hasSubmission = (hw.homework_submissions?.length ?? 0) > 0;

  let statusColor = theme.colors.accent;
  let statusText = '進行中';
  let statusIcon: keyof typeof Ionicons.glyphMap = 'time-outline';

  if (hasSubmission) {
    statusColor = '#16A34A';
    statusText = '已繳交';
    statusIcon = 'checkmark-circle';
  } else if (hw.is_closed || isOverdue) {
    statusColor = '#DC2626';
    statusText = '已截止';
    statusIcon = 'close-circle-outline';
  } else if (endTime) {
    // 檢查是否快到截止時間（24小時內）
    const hoursLeft = (endTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursLeft <= 24 && hoursLeft > 0) {
      statusColor = '#F59E0B';
      statusText = `剩 ${Math.floor(hoursLeft)} 小時`;
      statusIcon = 'alarm-outline';
    }
  }

  const onPress = () => {
    const url = `https://tronclass.pu.edu.tw/course/${hw.courseId}/content#/homework/${hw.id}`;
    WebBrowser.openBrowserAsync(url).catch(() => {});
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: pressed ? theme.colors.surface3 : theme.colors.surface2,
        borderWidth: 1,
        borderColor: hasSubmission
          ? '#16A34A30'
          : hw.is_closed || isOverdue
            ? '#DC262620'
            : theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: `${statusColor}14`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={statusIcon} size={20} color={statusColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}
          numberOfLines={2}
        >
          {hw.title}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
          {hw.courseName}
        </Text>
        {hw.end_time ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            截止：{formatDate(hw.end_time)}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: statusColor, fontWeight: '700', fontSize: 13 }}>{statusText}</Text>
        <Ionicons name="open-outline" size={12} color={theme.colors.muted} />
      </View>
    </Pressable>
  );
}

// ── 主畫面 ──────────────────────────────────────
export function GroupAssignmentsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();

  const [homeworks, setHomeworks] = useState<TCHomework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 載入所有課程的作業
  useEffect(() => {
    if (!auth.user) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 先取得課程列表
        let courses: TCCourse[] = (await getCachedTCCourses().catch(() => null)) ?? [];
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
  }, [auth.user?.uid]);

  const reload = () => {
    setHomeworks([]);
    setLoading(true);
    setError(null);
    // 重新觸發 useEffect
    // trick: 透過設定一個 dummy 來觸發
    setTimeout(() => {
      setLoading(false);
      setLoading(true);
    }, 0);
  };

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

  if (!auth.user) {
    return (
      <Screen>
        <Card title="作業" subtitle="請先登入以查看作業">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            登入後即可查看各課程的作業繳交狀態。
          </Text>
        </Card>
      </Screen>
    );
  }

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
        onAction={reload}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 14,
          padding: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        {/* 統計概覽 */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '900', fontSize: 24 }}>
              {homeworks.length}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>全部作業</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                color: pendingCount > 0 ? '#F59E0B' : theme.colors.muted,
                fontWeight: '900',
                fontSize: 24,
              }}
            >
              {pendingCount}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>待繳交</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: '#16A34A', fontWeight: '900', fontSize: 24 }}>
              {submittedCount}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已繳交</Text>
          </View>
        </View>

        {/* 作業列表 */}
        {homeworks.length > 0 ? (
          <View style={{ gap: 8 }}>
            <SectionTitle text={`共 ${homeworks.length} 份作業`} />
            {homeworks.map((hw) => (
              <HomeworkCard key={`hw-${hw.courseId}-${hw.id}`} hw={hw} />
            ))}
          </View>
        ) : (
          <Card title="目前沒有作業" subtitle="所有課程都沒有指派作業">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              當老師在 TronClass 上指派作業時，會顯示在這裡。
            </Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
