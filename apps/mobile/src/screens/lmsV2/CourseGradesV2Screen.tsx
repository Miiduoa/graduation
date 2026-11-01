import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import React, { useState } from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useAuth } from '../../state/auth';
import { getSupabaseClient } from '../../services/supabaseClient';
import { CourseV2Header, CourseV2List, useCourseV2Params, useLoadable } from './_courseV2Shell';

type GradeItem = {
  id: string;
  title: string;
  max_points: number | null;
  grade_categories: { weight: number };
  grade_scores: { score: number | null; updated_at?: string | null }[];
};

type CourseGrades = {
  rollup: { weighted_percent: number | null } | null;
  items: GradeItem[];
};

const displayTime = (value?: string | null) => (value ? formatTaipeiDateTime(value) : '') || '未知';

export async function loadCourseGrades(courseId: string): Promise<CourseGrades> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('尚未取得成績資料，請稍後重試。');
  const { data: identity, error: identityError } = await sb.auth.getUser();
  if (identityError) throw identityError;
  const studentId = identity?.user?.id;
  if (!studentId) throw new Error('請先登入，再查看成績。');
  const { data: rollup, error: rollupError } = await sb
    .from('course_grade_rollups')
    .select('course_id, weighted_percent')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (rollupError) throw rollupError;
  const items: GradeItem[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb
      .from('grade_items')
      .select(
        'id, title, max_points, grade_categories!inner(course_id, weight), grade_scores(score, updated_at)',
      )
      .eq('grade_categories.course_id', courseId)
      .eq('grade_scores.student_id', studentId)
      .order('id')
      .range(offset, offset + 99);
    if (error) throw error;
    items.push(...(data ?? []));
    if (!data || data.length < 100) break;
  }
  return { rollup, items };
}

export default function CourseGradesV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const auth = useAuth();
  const studentId = auth.user?.uid ?? '';
  return (
    <CourseGradesContent
      key={JSON.stringify([courseId, studentId])}
      courseId={courseId}
      courseName={courseName}
      studentId={studentId}
    />
  );
}

function CourseGradesContent({
  courseId,
  courseName,
  studentId,
}: {
  courseId: string;
  courseName?: string;
  studentId: string;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const [recordId, setRecordId] = useState<string | null>(null);
  const loadable = useLoadable(async () => {
    if (!studentId) throw new Error('請先登入，再查看成績。');
    return loadCourseGrades(courseId);
  });

  const contributingItems = loadable.data?.items.filter((item) => item.grade_categories.weight > 0) ?? [];
  const completeScores = contributingItems.length > 0 && contributingItems.every((item) =>
    item.grade_scores?.length === 1 &&
    typeof item.grade_scores[0].score === 'number' &&
    Number.isFinite(item.grade_scores[0].score),
  );
  const total = completeScores && Number.isFinite(loadable.data?.rollup?.weighted_percent)
    ? loadable.data?.rollup?.weighted_percent
    : null;

  const selectedItem = loadable.data?.items.find((item) => item.id === recordId);
  const record = selectedItem
    ? {
        id: selectedItem.id,
        title: selectedItem.title,
        score: selectedItem.grade_scores?.[0]?.score,
        updatedAt: selectedItem.grade_scores?.[0]?.updated_at,
      }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title="成績" subtitle={courseName} />
      <Text style={styles.meta}>
        來源：nuni 課程 ·
        更新時間：依各筆紀錄；未取得顯示未知，待評不算零分。總分依課程權重加總；應計項目待評或未取得時，總分為未知。
      </Text>
      {!loadable.loading && !loadable.error && loadable.data?.rollup ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>學期加權總分</Text>
          <Text style={styles.summaryValue} accessibilityLabel={`學期加權總分：${total ?? '未知'}`}>
            {total == null
              ? '未知'
              : Math.round(total * 100) / 100}
            <Text style={styles.max}> / 100</Text>
          </Text>
        </View>
      ) : null}
      <CourseV2List
        loadable={{
          ...loadable,
          data: loadable.data?.items ?? null,
        }}
        emptyLabel="尚無已發布成績"
        renderItem={(g: GradeItem) => {
          const score = Array.isArray(g.grade_scores) ? g.grade_scores[0]?.score : null;
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{g.title}</Text>
                <Pressable accessibilityRole="button" onPress={() => setRecordId(g.id)}>
                  <Text style={styles.meta}>查看原始評分紀錄</Text>
                </Pressable>
                <Text style={styles.meta}>
                  滿分 {g.max_points ?? '未知'} · 更新時間：
                  {displayTime(g.grade_scores?.[0]?.updated_at)}
                </Text>
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
      <Modal
        visible={!!record && !loadable.loading && !loadable.error}
        transparent={false}
        onRequestClose={() => setRecordId(null)}
      >
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{record?.title}</Text>
            <Text style={styles.meta}>來源：nuni 課程 · 原始評分項目：{record?.id}</Text>
            <Text style={styles.meta}>分數：{record?.score ?? '未知（待評或尚未取得）'}</Text>
            <Text style={styles.meta}>更新時間：{displayTime(record?.updatedAt)}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRecordId(null)}>
              <Text style={styles.title}>返回成績</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
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
