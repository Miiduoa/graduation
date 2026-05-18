import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseAnnouncementsV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return [];
    // 沒 status / published_at 欄位;用 scheduled_at <= now 或無 scheduled_at 為已發布
    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from('announcements')
      .select('id, title, body, body_html, created_at, scheduled_at')
      .eq('course_id', courseId)
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <CourseV2Header title="公告" subtitle={courseName} />
      <CourseV2List
        loadable={loadable}
        emptyLabel="尚無公告"
        renderItem={(a: any) => (
          <View style={styles.card}>
            <Text style={styles.title}>{a.title}</Text>
            <Text style={styles.body} numberOfLines={6}>
              {a.body}
            </Text>
            <Text style={styles.time}>
              {a.scheduled_at
                ? new Date(a.scheduled_at).toLocaleString()
                : a.created_at
                  ? new Date(a.created_at).toLocaleString()
                  : ''}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  title: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 14, color: '#374151', marginTop: 6, lineHeight: 20 },
  time: { fontSize: 11, color: '#9CA3AF', marginTop: 8 },
});
