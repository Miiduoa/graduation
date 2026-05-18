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

export default function CourseForumV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from('forum_topics')
      .select('id, title, created_at, locked_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <CourseV2Header title="討論區" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無討論串"
        renderItem={(t: any) => (
          <CourseV2Card
            title={t.title}
            subtitle={t.created_at ? new Date(t.created_at).toLocaleDateString() : '剛建立'}
            badge={t.locked_at ? '已鎖' : undefined}
            onPress={() =>
              nav.navigate('CourseForumTopicV2', { courseId, courseName, topicId: t.id })
            }
          />
        )}
      />
    </View>
  );
}
