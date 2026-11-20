import React from 'react';
import { theme } from '../../ui/theme';
import { useThemeMode } from '../../state/theme';
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

export default function CourseQuizzesV2Screen() {
  useThemeMode();
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error('LMS 服務尚未連線，請確認設定後重試。');
    if (!courseId) throw new Error('缺少課程識別資料，請返回重新選擇。');
    const { data, error } = await sb
      .from('quizzes')
      .select('id, title, description, time_limit_seconds, max_attempts, pool_pick_count, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title="測驗" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無測驗"
        renderItem={(q: any) => (
          <CourseV2Card
            title={q.title}
            subtitle={`${q.time_limit_seconds ? `${Math.round(q.time_limit_seconds / 60)} 分鐘` : '無時限'} · ${q.max_attempts ?? 1} 次機會`}
            onPress={() =>
              nav.navigate('QuizTaking', { courseId, courseName, quizId: q.id })
            }
          />
        )}
      />
    </View>
  );
}
