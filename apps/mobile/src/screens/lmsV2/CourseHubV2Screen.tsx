/**
 * CourseHubV2Screen — 新版課程主頁
 * 取代:CourseHubScreen.tsx + CourseModulesScreen.tsx 的 entry 角色
 * 邏輯:取課程資訊 + 顯示 8 個 chip:教材/作業/測驗/討論/公告/成績/AI 助教/直播
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  CourseV2Header,
  useCourseV2Nav,
  useCourseV2Params,
  useLoadable,
  CourseV2Loading,
  CourseV2Error,
} from './_courseV2Shell';

type Chip = { key: string; label: string; emoji: string; route: string };

const CHIPS: Chip[] = [
  { key: 'materials', label: '教材', emoji: '📚', route: 'CourseMaterialsV2' },
  { key: 'assignments', label: '作業', emoji: '📝', route: 'CourseAssignmentsV2' },
  { key: 'quizzes', label: '測驗', emoji: '❓', route: 'CourseQuizzesV2' },
  { key: 'forum', label: '討論', emoji: '💬', route: 'CourseForumV2' },
  { key: 'announcements', label: '公告', emoji: '📢', route: 'CourseAnnouncementsV2' },
  { key: 'grades', label: '成績', emoji: '💯', route: 'CourseGradesV2' },
  { key: 'ai', label: 'AI 助教', emoji: '🤖', route: 'CourseAIAssistantV2' },
  { key: 'live', label: '直播', emoji: '🎥', route: 'CourseLiveV2' },
];

export default function CourseHubV2Screen() {
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return { title: courseName ?? '(無連線)', catalog_summary: '' };
    const { data } = await sb
      .from('courses')
      .select('id, title, description, catalog_summary, credit_hours, term_id')
      .eq('id', courseId)
      .maybeSingle();
    return data ?? { title: courseName ?? '(無資料)', catalog_summary: '' };
  });

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const course = loadable.data!;

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <CourseV2Header
        title={course.title}
        subtitle={course.catalog_summary || (course.credit_hours ? `${course.credit_hours} 學分` : String(courseId))}
      />
      <ScrollView contentContainerStyle={styles.grid}>
        {CHIPS.map(chip => (
          <Pressable
            key={chip.key}
            style={styles.chip}
            onPress={() => nav.navigate(chip.route, { courseId, courseName: course.title })}
          >
            <Text style={styles.chipEmoji}>{chip.emoji}</Text>
            <Text style={styles.chipLabel}>{chip.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  chip: {
    width: '46%',
    aspectRatio: 1.4,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chipEmoji: { fontSize: 36 },
  chipLabel: { fontSize: 14, fontWeight: '600' },
});
