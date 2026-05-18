import React from 'react';
import { View } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useCourseV2Nav,
  useLoadable,
} from './_courseV2Shell';

function formatDue(due: string | null | undefined): string {
  if (!due) return '無截止';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return '無截止';
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return '已過期';
  if (days === 0) return '今日截止';
  if (days <= 7) return `${days} 天後截止`;
  return d.toLocaleDateString();
}

export default function CourseAssignmentsV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
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
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
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
              nav.navigate('CourseAssignmentDetailV2', {
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
