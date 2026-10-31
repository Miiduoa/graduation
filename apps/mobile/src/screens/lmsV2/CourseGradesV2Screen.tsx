import React, { useState } from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  CourseV2List,
  useCourseV2Params,
  useLoadable,
} from './_courseV2Shell';

export default function CourseGradesV2Screen() {
  const styles = useThemeStyleSheet(createStyles);
  const [record, setRecord] = useState<{ id: string; title: string; score: number | null; updatedAt: string | null } | null>(null);
  const { courseId, courseName } = useCourseV2Params();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error('尚未取得成績資料，請稍後重試。');
    // rollup 只有 weighted_percent;個別 grade items 在 grade_items + grade_scores 表
    const { data: rollup, error: rollupError } = await sb
      .from('course_grade_rollups')
      .select('course_id, weighted_percent')
      .eq('course_id', courseId)
      .maybeSingle();
    const { data: items, error: itemsError } = await sb
      .from('grade_items')
      .select('id, title, max_points, grade_scores(score, updated_at)')
      .eq('course_id', courseId)
      .limit(100);
    if (rollupError || itemsError) throw rollupError || itemsError;
    return { rollup, items: items ?? [] };
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title="成績" subtitle={courseName} />
      <Text style={styles.meta}>來源：nuni 課程 · 更新時間：依各筆紀錄；未取得顯示未知，待評不算零分。總分依課程設定的權重計算。</Text>
      {loadable.data?.rollup ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>學期加權總分</Text>
          <Text style={styles.summaryValue}>
            {loadable.data.rollup.weighted_percent == null ? '未知' : Math.round(loadable.data.rollup.weighted_percent * 100) / 100}
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
                <Pressable accessibilityRole="button" onPress={() => setRecord({ id: g.id, title: g.title, score, updatedAt: g.grade_scores?.[0]?.updated_at || null })}><Text style={styles.meta}>查看原始評分紀錄</Text></Pressable>
                <Text style={styles.meta}>滿分 {g.max_points ?? '未知'} · 更新時間：{g.grade_scores?.[0]?.updated_at || '未知'}</Text>
              </View>
              <View style={styles.scoreBox}>
                <Text style={styles.score}>
                  {score ?? '—'}
                  <Text style={styles.max}> / {g.max_points ?? '未知'}</Text>
                </Text>
              </View>
            </View>
          );
        }}
      />
      <Modal visible={!!record} transparent={false} onRequestClose={() => setRecord(null)}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{record?.title}</Text>
            <Text style={styles.meta}>來源：nuni 課程 · 原始評分項目：{record?.id}</Text>
            <Text style={styles.meta}>分數：{record?.score ?? '未知（待評或尚未取得）'}</Text>
            <Text style={styles.meta}>更新時間：{record?.updatedAt || '未知'}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRecord(null)}><Text style={styles.title}>返回成績</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: theme.colors.muted, marginTop: 2 },
  scoreBox: { alignItems: 'flex-end' },
  score: { fontSize: 22, fontWeight: '700', color: theme.colors.accent },
  max: { fontSize: 12, color: theme.colors.muted, fontWeight: '400' },
  summary: {
    margin: 12,
    padding: 14,
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 10,
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 13, color: theme.colors.accent },
  summaryValue: { fontSize: 32, fontWeight: '700', color: theme.colors.accent, marginTop: 4 },
});
