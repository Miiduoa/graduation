import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseGradesV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return { rollup: null, items: [] };
    // rollup 只有 weighted_percent;個別 grade items 在 grade_items + grade_scores 表
    const { data: rollup } = await sb
      .from('course_grade_rollups')
      .select('course_id, weighted_percent')
      .eq('course_id', courseId)
      .maybeSingle();
    const { data: items } = await sb
      .from('grade_items')
      .select('id, title, max_points, grade_scores!inner(score, updated_at)')
      .eq('course_id', courseId)
      .limit(100);
    return { rollup, items: items ?? [] };
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <CourseV2Header title="成績" subtitle={courseName} />
      {loadable.data?.rollup ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>學期加權總分</Text>
          <Text style={styles.summaryValue}>
            {Math.round((loadable.data.rollup.weighted_percent ?? 0) * 100) / 100}
            <Text style={styles.max}> / 100</Text>
          </Text>
        </View>
      ) : null}
      <CourseV2List
        loadable={{
          ...loadable,
          data: loadable.data?.items ?? null,
        } as any}
        emptyLabel="尚無已發布成績"
        renderItem={(g: any) => {
          const score = Array.isArray(g.grade_scores) ? g.grade_scores[0]?.score : null;
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{g.title}</Text>
                <Text style={styles.meta}>滿分 {g.max_points ?? 100}</Text>
              </View>
              <View style={styles.scoreBox}>
                <Text style={styles.score}>
                  {score ?? '—'}
                  <Text style={styles.max}> / {g.max_points ?? 100}</Text>
                </Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
  scoreBox: { alignItems: 'flex-end' },
  score: { fontSize: 22, fontWeight: '700', color: '#007AFF' },
  max: { fontSize: 12, color: '#AEAEB2', fontWeight: '400' },
  summary: {
    margin: 12,
    padding: 14,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 13, color: '#1E40AF' },
  summaryValue: { fontSize: 32, fontWeight: '800', color: '#1E3A8A', marginTop: 4 },
});
