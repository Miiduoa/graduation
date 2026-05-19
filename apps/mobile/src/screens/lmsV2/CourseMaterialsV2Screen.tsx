import React from 'react';
import { View, Linking } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  CourseV2Card,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseMaterialsV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from('course_materials')
      .select('id, title, storage_path, external_url, mime_type, description_html, publish_at, is_published, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header title="教材" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無教材"
        renderItem={(m: any) => {
          const url = m.external_url || m.storage_path;
          return (
            <CourseV2Card
              title={m.title}
              subtitle={`${m.mime_type ?? 'file'}${!m.is_published ? ' · 未發布' : ''}`}
              onPress={url ? () => Linking.openURL(url) : undefined}
            />
          );
        }}
      />
    </View>
  );
}
