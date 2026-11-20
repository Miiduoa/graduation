/**
 * CourseHubV2Screen — 新版課程主頁
 * 取代:CourseHubScreen.tsx + CourseModulesScreen.tsx 的 entry 角色
 * 邏輯:取課程資訊 + 顯示 8 個 chip:教材/作業/測驗/討論/公告/成績/AI 助教/直播
 */
import React from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import { COURSE_V2_SHORTCUT_GROUPS } from './courseV2Routes';
import {
  CourseV2Header,
  useCourseV2Nav,
  useCourseV2Params,
  useLoadable,
  CourseV2Loading,
  CourseV2Error,
} from './_courseV2Shell';

export default function CourseHubV2Screen() {
  const styles = useThemeStyleSheet(createStyles);
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!courseId) throw new Error('找不到課程代碼，請返回課程列表重新選擇。');
    if (!sb) throw new Error('課程服務尚未連線，請確認 LMS 設定後重試。');
    const { data, error } = await sb
      .from('courses')
      .select('id, title, description, catalog_summary, credit_hours, term_id')
      .eq('id', courseId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('找不到這門課，或目前沒有存取權限。');
    return data;
  });

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const course = loadable.data!;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header
        title={course.title}
        subtitle={course.catalog_summary || (course.credit_hours ? `${course.credit_hours} 學分` : courseName)}
      />
      <ScrollView contentContainerStyle={styles.page}>
        {COURSE_V2_SHORTCUT_GROUPS.map((group) => (
          <View key={group.title} style={styles.section}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{group.title}</Text>
              <Text style={styles.sectionDescription}>{group.description}</Text>
            </View>
            <View style={styles.grid}>
              {group.shortcuts.map((shortcut) => (
                <Pressable
                  key={shortcut.key}
                  style={({ pressed }) => [styles.shortcut, pressed && styles.shortcutPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`開啟${shortcut.label}`}
                  onPress={() =>
                    nav.navigate(shortcut.route, { courseId, courseName: course.title })
                  }
                >
                  <Text style={styles.shortcutTitle}>{shortcut.label}</Text>
                  <Text style={styles.shortcutDetail}>{shortcut.detail}</Text>
                  <Text style={styles.shortcutArrow} accessibilityElementsHidden>
                    →
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  page: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: 24,
    paddingBottom: 48,
    gap: 28,
  },
  section: { gap: 14 },
  sectionHeading: { gap: 4 },
  sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  sectionDescription: { color: theme.colors.muted, fontSize: 13, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  shortcut: {
    flexGrow: 1,
    width: '46%',
    minHeight: 118,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  shortcutPressed: { opacity: 0.72 },
  shortcutTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  shortcutDetail: { color: theme.colors.muted, fontSize: 12, lineHeight: 18 },
  shortcutArrow: { alignSelf: 'flex-end', color: theme.colors.muted, fontSize: 17 },
});
