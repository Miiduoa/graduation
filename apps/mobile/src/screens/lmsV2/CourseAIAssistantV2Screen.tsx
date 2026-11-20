/**
 * CourseAIAssistantV2Screen — LMS 課程頁的 AI 助教按鈕入口
 * ──────────────────────────────────────────────
 * 本 Screen 不自己處理對話 — 它組裝 per-course AIContext 後,
 * navigate 到既有的 AIChat (舊版 chatWithCampusAssistant)。
 *
 * 這就是「LMS 內嵌對話 = 舊 AI 助理」的關鍵橋接。
 */
import React, { useEffect } from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useCourseV2Params, useCourseV2Nav } from './_courseV2Shell';
import { buildPerCourseAIContext, buildPerCourseSystemHint } from '../../services/perCourseAIContext';

export default function CourseAIAssistantV2Screen() {
  const styles = useThemeStyleSheet(createStyles);
  const { courseId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();

  useEffect(() => {
    (async () => {
      const ctx = await buildPerCourseAIContext(courseId!);
      const hint = buildPerCourseSystemHint({
        courseId: courseId!,
        courseName,
      });
      // 替換 (replace) 而非 push,避免按返回回到空殼畫面
      const args = {
        seedContext: ctx,
        systemPromptPrefix: hint,
        courseId,
        title: `${courseName ?? '課程'} · 課程助理`,
      };
      if (typeof nav.replace === 'function') {
        nav.replace('AIChat', args);
      } else {
        nav.navigate('AIChat', args);
      }
    })();
  }, [courseId, courseName, nav]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.label}>正在開啟課程助理…</Text>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  label: { color: theme.colors.muted },
});
