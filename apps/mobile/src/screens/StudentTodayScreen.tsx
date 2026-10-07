import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

export default function StudentTodayScreen() {
  const s = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const navigation = useNavigation();
  const bottom = useTabBarContentBottomPadding();
  const [result, setResult] = useState<{
    uid: string;
    courses: CourseSpace[];
    tasks: InboxTask[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const uid = auth.user?.uid;
  const data = result?.uid === uid ? result : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      if (!uid) throw new Error('請先登入。');
      const { courses, tasks } = await loadStudentHome(uid, auth.profile?.schoolId);
      if (request === generation.current) setResult({ uid, courses, tasks });
    } catch {
      if (request === generation.current)
        setError('無法讀取課程。請確認登入狀態與網路連線後重試。');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [uid, auth.profile?.schoolId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const openCourse = (courseId: string) =>
    safeNavigate(navigation, 'CourseHub', { courseSpaceId: courseId, groupId: courseId });
  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 22, paddingBottom: bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.accent} />
        }
      >
        <Text style={s.brand}>CAMPUS ONE</Text>
        <Text style={s.heading}>今天的課程與待辦</Text>
        <Text style={s.caption}>查看作業期限與課程最新動態。</Text>
        {!!error && (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={load}>
              <Text style={s.link}>重新讀取</Text>
            </Pressable>
          </View>
        )}
        {loading && !data ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 36 }} />
        ) : (
          <>
            <View style={s.focus}>
              <Text style={s.label}>接下來要做的事</Text>
              <Text style={s.focusTitle}>
                {data
                  ? data.tasks.length
                    ? `${data.tasks.length} 項待辦`
                    : '從你的課程開始'
                  : '登入後查看課程'}
              </Text>
              <Text style={s.focusBody}>查看課程內容，掌握作業期限與最新動態。</Text>
              <Pressable
                accessibilityRole="button"
                style={s.primary}
                onPress={() => safeNavigate(navigation, 'CoursesHome')}
              >
                <Text style={s.primaryText}>開啟課程 ↗</Text>
              </Pressable>
            </View>
            {data && (
              <>
                <Text style={s.sectionTitle}>待辦事項</Text>
                {data.tasks.length ? (
                  data.tasks.map((task) => (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      style={s.task}
                      onPress={() =>
                        task.kind === 'assistant_queue'
                          ? safeNavigate(navigation, 'AIAgentConsole')
                          : openCourse(task.groupId)
                      }
                    >
                      <View style={s.square} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.taskTitle}>{task.title}</Text>
                        <Text style={s.taskMeta}>
                          {task.groupName}
                          {task.dueAt ? ` · ${task.dueAt.toLocaleDateString('zh-TW')} 截止` : ''}
                        </Text>
                      </View>
                      <Text style={s.arrow}>↗</Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>目前沒有待處理事項。</Text>
                )}
                <Text style={s.sectionTitle}>我的課程</Text>
                {data.courses.length ? (
                  data.courses.map((course) => (
                    <Pressable
                      key={course.id}
                      accessibilityRole="button"
                      style={s.course}
                      onPress={() => openCourse(course.groupId)}
                    >
                      <Text style={s.label}>課程</Text>
                      <Text style={s.courseTitle}>{course.name}</Text>
                      <Text style={s.taskMeta}>
                        {course.unreadCount ? `${course.unreadCount} 則新動態` : '查看課程內容'}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>尚未加入課程。若已選課，請向授課教師確認成員名單。</Text>
                )}
              </>
            )}
            <View style={s.tools}>
              {(
                [
                  ['Map', '校園地圖'],
                  ['CourseSchedule', '課表'],
                  ['AIAgentConsole', '校園助理'],
                ] as const
              ).map(([route, label]) => (
                <Pressable
                  key={route}
                  accessibilityRole="button"
                  onPress={() => safeNavigate(navigation, route)}
                  style={s.tool}
                >
                  <Text style={s.toolText}>{label}</Text>
                  <Text style={s.arrow}>↗</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    brand: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
      color: theme.colors.textSecondary,
      marginBottom: 28,
    },
    heading: { color: theme.colors.text, fontSize: 28, fontWeight: '600', letterSpacing: -1 },
    caption: { color: theme.colors.muted, fontSize: 13, marginTop: 10, marginBottom: 26 },
    focus: {
      backgroundColor: theme.colors.focusSurface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 24,
    },
    label: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1 },
    focusTitle: { color: theme.colors.text, fontSize: 25, fontWeight: '600', marginVertical: 14 },
    focusBody: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 22 },
    primary: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.accent,
      borderRadius: 4,
      paddingHorizontal: 18,
      paddingVertical: 12,
      marginTop: 22,
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 32,
      marginBottom: 12,
    },
    task: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'center',
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    square: {
      width: 16,
      height: 16,
      borderWidth: 1,
      borderColor: theme.colors.muted,
      borderRadius: 3,
    },
    taskTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text, lineHeight: 22 },
    taskMeta: { fontSize: 12, color: theme.colors.muted, marginTop: 5 },
    arrow: { color: theme.colors.muted, fontSize: 19 },
    course: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: 20,
      marginBottom: 10,
    },
    courseTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 17, marginTop: 9 },
    empty: { color: theme.colors.muted, fontSize: 13, lineHeight: 23, paddingVertical: 16 },
    tools: { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 30 },
    tool: {
      paddingVertical: 18,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    toolText: { color: theme.colors.text, fontSize: 14 },
    error: {
      padding: 16,
      backgroundColor: theme.colors.dangerSoft,
      marginBottom: 18,
      borderRadius: 4,
    },
    errorText: { color: theme.colors.text, fontSize: 13, lineHeight: 22 },
    link: { color: theme.colors.accent, marginTop: 10, fontWeight: '600' },
  });
