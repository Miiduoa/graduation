import React from 'react';
import { theme } from '../../ui/theme';
import { useThemeMode } from '../../state/theme';
import { View } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import { COURSE_V2_ROUTES } from './courseV2Routes';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useCourseV2Nav,
  useLoadable,
} from './_courseV2Shell';

function formatDue(due: string | null | undefined): string {
  if (!due) return '未設定參考時間';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return '未設定參考時間';
  const remainingMs = d.getTime() - Date.now();
  if (remainingMs < 0) return '已過參考時間';
  const days = Math.ceil(remainingMs / 86_400_000);
  if (days <= 1) return '參考時間在 24 小時內';
  if (days <= 7) return `約 ${days} 天後`;
  return d.toLocaleDateString();
}

export default function CourseAssignmentsV2Screen() {
  useThemeMode();
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error('LMS 服務尚未連線，請確認設定後重試。');
    const { data, error } = await sb
      .from('assignments')
      .select('id, title, description, due_at, max_points, is_group_submission')
      .eq('course_id', courseId)
      .order('due_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title="作業" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無作業"
        renderItem={(a: any) => (
          <CourseV2Card
            title={a.title}
            subtitle={`${formatDue(a.due_at)} · 滿分 ${a.max_points ?? 100}`}
            badge={a.is_group_submission ? '小組' : undefined}
            onPress={() =>
              nav.navigate(COURSE_V2_ROUTES.assignmentDetail, {
                courseId,
                courseName,
                assignmentId: a.id,
              })
            }
          />
        )}
      />
    </View>
  );
}
