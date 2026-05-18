import React from 'react';
import { View } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseQuestionBankV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
    // 跨 quiz 取所有題目,給教師快速瀏覽題庫
    const { data, error } = await sb
      .from('quiz_questions')
      .select('id, prompt, type, points, quiz_id, quizzes!inner(course_id)')
      .eq('quizzes.course_id', courseId)
      .limit(300);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header title="題庫" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無題目"
        renderItem={(q: any) => (
          <CourseV2Card
            title={String(q.prompt ?? '').slice(0, 80)}
            subtitle={`類型: ${q.type ?? '未知'} · ${q.points ?? 0} 分`}
          />
        )}
      />
    </View>
  );
}
