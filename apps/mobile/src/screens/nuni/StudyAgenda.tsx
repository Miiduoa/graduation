import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  sortStudyTasks,
  studyTaskStatus,
  studyTaskTiming,
  type NuniStudyAgenda,
  type NuniStudyTask,
} from '@campus/shared/src/nuniStudyAgenda';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { feedbackPredatesSubmission } from '@campus/shared/src/lmsReviewQueue';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { useTheme } from '../../state/theme';

type Filter = 'pending' | 'soon' | 'overdue' | 'feedback' | 'submitted' | 'closed' | 'all';
const FILTERS: [Filter, string][] = [
  ['pending', '待完成'],
  ['soon', '未來七天'],
  ['overdue', '已過建議時間'],
  ['feedback', '老師回饋'],
  ['submitted', '已有繳交紀錄'],
  ['closed', '已停止收件'],
  ['all', '全部'],
];
const belongs = (task: NuniStudyTask, filter: Filter, now: number) => {
  if (filter === 'all') return true;
  const status = studyTaskStatus(task);
  if (filter === 'submitted') return status === 'submitted' || status === 'feedback';
  if (filter === 'soon' || filter === 'overdue') {
    if (status !== 'pending') return false;
    const timing = studyTaskTiming(task, now);
    return filter === 'soon' ? timing === 'today' || timing === 'week' : timing === 'overdue';
  }
  return status === filter;
};

export function StudyAgenda({
  data,
  loading,
  error,
  retry,
  open,
}: {
  data: NuniStudyAgenda | null;
  loading: boolean;
  error: string;
  retry(): void;
  open(courseId: string, activityId?: string): void;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useNuniDraftState<Filter>('courses:agenda-filter', 'pending');
  const [courseFilter, setCourseFilter] = useNuniDraftState<string>('courses:agenda-course', 'all');
  const [limit, setLimit] = useState(8);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const tasks = sortStudyTasks(data?.tasks ?? [], now);
  const studentCourses = (data?.workspaces ?? []).filter(
    (course) => course.state === 'active' && course.memberRole === 'student',
  );
  const selectedCourse =
    courseFilter === 'all' || studentCourses.some((course) => course.id === courseFilter)
      ? courseFilter
      : 'all';
  const scopedTasks =
    selectedCourse === 'all' ? tasks : tasks.filter((task) => task.courseId === selectedCourse);
  const visible = scopedTasks.filter((task) => belongs(task, filter, now));
  const failedCourseIds =
    data?.failedCourseIds.filter((id) => selectedCourse === 'all' || id === selectedCourse) ?? [];
  const limitedCourseIds =
    data?.limitedCourseIds.filter((id) => selectedCourse === 'all' || id === selectedCourse) ?? [];
  const partial = failedCourseIds.length > 0 || limitedCourseIds.length > 0;
  const copy = { color: theme.colors.text, fontSize: 15, lineHeight: 23 };
  if (!loading && !data && !error) return null;
  return (
    <View
      style={{
        gap: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 14,
        padding: 18,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ gap: 5 }}>
        <Text
          accessibilityRole="header"
          style={{ ...copy, fontWeight: '600', fontSize: 21, lineHeight: 29 }}
        >
          先處理這些
        </Text>
        <Text style={{ ...copy, color: theme.colors.muted }}>
          修習課程的作業與測驗，依參考期限排列。
        </Text>
      </View>
      {loading ? (
        <Text accessibilityLiveRegion="polite" style={copy}>
          {data ? '正在更新待辦…' : '正在整理待辦…'}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ ...copy, color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      {failedCourseIds.length ? (
        <Text accessibilityRole="alert" style={{ ...copy, color: theme.colors.danger }}>
          有 {failedCourseIds.length} 門課程尚未完整載入，以下保留已確認的項目。
        </Text>
      ) : null}
      {limitedCourseIds.length ? (
        <Text style={{ ...copy, color: theme.colors.muted }}>
          部分課程還可能有較早內容；這裡的數量只計算已載入項目。
        </Text>
      ) : null}
      {error || failedCourseIds.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          disabled={loading}
          onPress={retry}
          style={{ paddingVertical: 12 }}
        >
          <Text style={{ ...copy, color: theme.colors.accent, fontWeight: '600' }}>
            重新讀取待辦
          </Text>
        </Pressable>
      ) : null}
      {data ? (
        <>
          {studentCourses.length > 1 ? (
            <View style={{ gap: 7 }}>
              <Text style={{ ...copy, color: theme.colors.muted, fontSize: 13 }}>依課程查看</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
              >
                {[{ id: 'all', title: '所有課程' }, ...studentCourses].map((course) => (
                  <Pressable
                    key={course.id}
                    accessibilityRole="button"
                    accessibilityLabel={'篩選課程：' + course.title}
                    accessibilityState={{ selected: selectedCourse === course.id }}
                    onPress={() => {
                      setCourseFilter(course.id);
                      setLimit(8);
                    }}
                    style={{
                      borderRadius: 9,
                      borderWidth: 1,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderColor:
                        selectedCourse === course.id ? theme.colors.accent : theme.colors.border,
                      backgroundColor:
                        selectedCourse === course.id ? theme.colors.accentSoft : theme.colors.bg,
                    }}
                  >
                    <Text
                      style={{
                        ...copy,
                        fontSize: 14,
                        color:
                          selectedCourse === course.id ? theme.colors.accent : theme.colors.muted,
                      }}
                    >
                      {course.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          <View style={{ gap: 7 }}>
            <Text style={{ ...copy, color: theme.colors.muted, fontSize: 13 }}>依進度篩選</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {FILTERS.map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === value }}
                  onPress={() => {
                    setFilter(value);
                    setLimit(8);
                  }}
                  style={{
                    borderRadius: 9,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    borderWidth: 1,
                    borderColor: filter === value ? theme.colors.accent : theme.colors.border,
                    backgroundColor: filter === value ? theme.colors.accentSoft : theme.colors.bg,
                  }}
                >
                  <Text
                    style={{
                      ...copy,
                      fontSize: 14,
                      color: filter === value ? theme.colors.accent : theme.colors.muted,
                    }}
                  >
                    {label} {scopedTasks.filter((task) => belongs(task, value, now)).length}
                    {partial ? '+' : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {visible.length ? (
            visible.slice(0, limit).map((task) => {
              const status = studyTaskStatus(task);
              const timing = studyTaskTiming(task, now);
              const kind = task.kind === 'assignment' ? '作業' : '測驗';
              const label =
                status === 'submitted' &&
                !!task.feedback?.trim() &&
                feedbackPredatesSubmission(task.reviewedAt, task.submittedAt)
                  ? '已繳交 · 有較早版本的回饋'
                  : status === 'feedback'
                    ? '老師已回饋'
                    : status === 'submitted'
                      ? task.kind === 'quiz'
                        ? '已作答'
                        : '已繳交'
                      : status === 'closed'
                        ? task.kind === 'quiz'
                          ? '已結束 · 未作答'
                          : '已停止收件 · 未繳交'
                        : timing === 'overdue'
                          ? task.kind === 'quiz'
                            ? '參考期限已過 · 仍可作答'
                            : '參考期限已過 · 仍可繳交'
                          : timing === 'today'
                            ? '建議今天完成'
                            : timing === 'week'
                              ? '建議七天內完成'
                              : '待完成';
              return (
                <Pressable
                  key={`${task.kind}:${task.courseId}:${task.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`開啟${kind}：${task.title}`}
                  onPress={() => open(task.courseId, task.id)}
                  style={({ pressed }) => ({
                    paddingVertical: 14,
                    paddingHorizontal: 2,
                    borderTopWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 5,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <Text style={{ ...copy, color: theme.colors.muted, fontSize: 13 }}>
                    {task.courseTitle} · {kind}
                  </Text>
                  <Text style={{ ...copy, fontWeight: '600', fontSize: 17, lineHeight: 26 }}>
                    {task.title}
                  </Text>
                  <Text
                    style={{
                      ...copy,
                      color:
                        status === 'pending' && timing === 'overdue'
                          ? theme.colors.warning
                          : status === 'feedback' || status === 'submitted'
                            ? theme.colors.success
                            : theme.colors.text,
                      fontSize: 14,
                    }}
                  >
                    {label}
                  </Text>
                  <Text style={{ ...copy, color: theme.colors.muted, fontSize: 13 }}>
                    {task.dueAt
                      ? `參考期限 ${formatTaipeiDateTime(task.dueAt, { seconds: false })}`
                      : '未設定參考期限'}
                  </Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={{ ...copy, color: theme.colors.muted }}>
              {!partial && data.studiedCourseCount === 0
                ? '還沒加入 nuni 課程。請到下方課程區輸入邀請碼，加入後就能看到作業與測驗。'
                : partial
                  ? '已載入的內容中沒有這類項目，其他課程仍待確認。'
                  : filter === 'pending'
                    ? '目前沒有待完成項目。可以從下方課程繼續閱讀教材。'
                    : filter === 'soon'
                      ? '未來七天內沒有待完成的項目。'
                      : filter === 'overdue'
                        ? '目前沒有已過建議時間且尚未完成的項目。'
                        : filter === 'feedback'
                          ? '目前沒有新的老師回饋。'
                          : filter === 'closed'
                            ? '目前沒有已停止收件且尚未繳交的項目。'
                            : filter === 'submitted'
                              ? '目前還沒有繳交紀錄。'
                              : '目前沒有課業活動。'}
            </Text>
          )}
          {visible.length > limit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setLimit((value) => value + 8)}
              style={{ paddingVertical: 12 }}
            >
              <Text style={{ ...copy, color: theme.colors.accent, fontWeight: '600' }}>
                再顯示 {Math.min(8, visible.length - limit)} 項
              </Text>
            </Pressable>
          ) : null}
          <Text style={{ ...copy, fontSize: 12, lineHeight: 20, color: theme.colors.muted }}>
            參考期限用於安排進度；是否能繳交，以老師的收件狀態為準。
          </Text>
        </>
      ) : null}
    </View>
  );
}
