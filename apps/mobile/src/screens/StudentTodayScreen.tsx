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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { CourseSpace, InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { OpenOrderCard } from '../components/OpenOrderCard';
import { TodayTimetablePanel } from '../components/TodayTimetablePanel';
import { rootNavigateNested } from '../app/rootNavigation';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { navigateFromInboxTask, resolveInboxAction } from '../services/inboxActions';
import { TodaySensePanel } from '../components/TodaySensePanel';

type HomeState =
  | { scope: string; status: 'loading' | 'error' }
  | { scope: string; status: 'ready'; courses: CourseSpace[]; tasks: InboxTask[] };

export default function StudentTodayScreen() {
  const s = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const navigation = useNavigation();
  const bottom = useTabBarContentBottomPadding();
  const uid = auth.user?.uid;
  const schoolId = auth.profile?.schoolId;
  const scope = JSON.stringify([uid, schoolId, auth.profile?.role]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<HomeState>({ scope, status: 'loading' });
  const [now, setNow] = useState<Date | null>(null);
  const [timetableRefresh, setTimetableRefresh] = useState(0);
  const generation = useRef(0);
  const current = state.scope === scope ? state : null;
  const data = current?.status === 'ready' ? current : null;
  const loading = !current || current.status === 'loading';
  const error =
    current?.status === 'error' ? '無法讀取校務課程。請確認登入狀態與網路連線後重試。' : '';
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, status: 'loading' });
    try {
      if (!uid) throw new Error('請先登入。');
      const { courses, tasks } = await loadStudentHome(uid, schoolId);
      if (request === generation.current && currentScope.current === scope)
        setState({ scope, status: 'ready', courses, tasks });
    } catch {
      if (request === generation.current && currentScope.current === scope)
        setState({ scope, status: 'error' });
    }
  }, [uid, schoolId, scope]);
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        generation.current += 1;
      };
    }, [load]),
  );
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const openCourse = (courseId: string) =>
    safeNavigate(navigation, 'CourseHub', { courseSpaceId: courseId, groupId: courseId });
  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              setTimetableRefresh((key) => key + 1);
              void load();
            }}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={s.topLine}>
          <Text style={s.brand}>CAMPUS ONE</Text>
          <Text style={s.date}>
            {now?.toLocaleDateString('zh-TW', {
              timeZone: 'Asia/Taipei',
              month: 'numeric',
              day: 'numeric',
              weekday: 'short',
            }) ?? ''}
          </Text>
        </View>
        <Text accessibilityRole="header" style={s.heading}>
          今天
        </Text>
        <Text style={s.caption}>從課程、作業或校務服務開始。</Text>
        <TodayTimetablePanel
          refreshKey={timetableRefresh}
          onOpenImport={() => rootNavigateNested('學習', 'PersonalImport', { kind: 'timetable' })}
          onOpenTimetable={(term) =>
            rootNavigateNested('學習', 'PersonalTimetable', term ? { term } : undefined)
          }
        />
        <OpenOrderCard navigation={navigation} />
        <View style={s.entry}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Campus One 課程與作業"
            onPress={() => safeNavigate(navigation, 'NuniWorkspace')}
            style={({ pressed }) => [s.tool, s.workspaceEntry, pressed && s.pressed]}
          >
            <View style={s.entryCopy}>
              <Text style={s.toolText}>Campus One 課程與作業</Text>
              <Text style={s.taskMeta}>加入課程、查看教材、繳交作業與測驗</Text>
            </View>
            <Text accessibilityElementsHidden importantForAccessibility="no" style={s.arrow}>
              →
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="校務服務"
            onPress={() => safeNavigate(navigation, 'CoursesHome')}
            style={({ pressed }) => [s.tool, pressed && s.pressed]}
          >
            <View style={s.entryCopy}>
              <Text style={s.toolText}>校務服務</Text>
              <Text style={s.taskMeta}>已連結學校的課表、成績與出缺紀錄</Text>
            </View>
            <Text accessibilityElementsHidden importantForAccessibility="no" style={s.arrow}>
              →
            </Text>
          </Pressable>
        </View>
        <View style={s.tools}>
          {(
            [
              ['Map', '校園地圖'],
              ['PersonalTimetable', '我的課表'],
              ['AIAgentConsole', '校園助理'],
            ] as const
          ).map(([route, label]) => (
            <Pressable
              key={route}
              accessibilityRole="button"
              onPress={() =>
                route === 'PersonalTimetable'
                  ? rootNavigateNested('學習', 'PersonalTimetable')
                  : safeNavigate(navigation, route)
              }
              style={({ pressed }) => [s.quickTool, pressed && s.pressed]}
            >
              <Text style={s.quickToolText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {!!error && (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={load}
              style={({ pressed }) => [s.retry, pressed && s.pressed]}
            >
              <Text style={s.link}>重新讀取</Text>
            </Pressable>
          </View>
        )}
        {loading && !data ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 36 }} />
        ) : (
          <>
            {data && (
              <>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  校務待辦
                </Text>
                {data.tasks.length ? (
                  data.tasks.map((task) => (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${task.title}，${resolveInboxAction(task)?.label ?? '查看課程'}`}
                      style={({ pressed }) => [s.task, pressed && s.pressed]}
                      onPress={() => {
                        if (
                          !navigateFromInboxTask(navigation, task, {
                            role: auth.profile?.role,
                            isTeachingRole: false,
                          })
                        )
                          openCourse(task.groupId);
                      }}
                    >
                      <View style={s.taskMarker} accessibilityElementsHidden />
                      <View style={{ flex: 1 }}>
                        <Text style={s.taskTitle}>{task.title}</Text>
                        <Text style={s.taskMeta}>
                          {task.groupName}
                          {task.dueAt ? ` · ${task.dueAt.toLocaleDateString('zh-TW')} 截止` : ''}
                        </Text>
                      </View>
                      <Text
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                        style={s.arrow}
                      >
                        →
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>
                    目前沒有校務待辦。Campus One 作業與測驗請到「課程與作業」查看。
                  </Text>
                )}
                <TodaySensePanel
                  uid={uid}
                  schoolId={schoolId}
                  tasks={data.tasks}
                  phase="ready"
                  now={now}
                  navigation={navigation}
                  role={auth.profile?.role}
                />
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  校務課程
                </Text>
                {data.courses.length ? (
                  data.courses.map((course) => (
                    <Pressable
                      key={course.id}
                      accessibilityRole="button"
                      style={({ pressed }) => [s.course, pressed && s.pressed]}
                      onPress={() => openCourse(course.groupId)}
                    >
                      <View style={s.courseTop}>
                        <Text style={s.label}>課程</Text>
                        <Text
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                          style={s.arrow}
                        >
                          →
                        </Text>
                      </View>
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: {
      paddingHorizontal: 24,
      paddingTop: 22,
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
    },
    topLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      marginBottom: 18,
    },
    brand: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 2,
      color: theme.colors.textSecondary,
    },
    date: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 19,
      fontVariant: ['tabular-nums'],
    },
    heading: {
      color: theme.colors.text,
      fontSize: 32,
      lineHeight: 42,
      fontWeight: '600',
      letterSpacing: -0.6,
    },
    caption: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 23,
      marginTop: 8,
      marginBottom: 6,
    },
    entry: { marginTop: 10, marginBottom: 10 },
    entryCopy: { flex: 1, gap: 4, minWidth: 0 },
    workspaceEntry: {
      backgroundColor: theme.colors.focusSurface,
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.accent,
      borderRadius: 10,
      marginBottom: 6,
    },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    label: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 26,
      marginBottom: 14,
      lineHeight: 26,
    },
    task: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'center',
      minHeight: 76,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    taskMarker: {
      width: 3,
      height: 28,
      backgroundColor: theme.colors.accent,
      borderRadius: 2,
    },
    taskTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 24 },
    taskMeta: { fontSize: 12, lineHeight: 20, color: theme.colors.muted, marginTop: 5 },
    arrow: { color: theme.colors.accent, fontSize: 21 },
    courseTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    course: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 10,
      padding: 20,
      marginBottom: 10,
    },
    courseTitle: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 18,
      lineHeight: 27,
      marginTop: 8,
    },
    empty: { color: theme.colors.muted, fontSize: 13, lineHeight: 23, paddingVertical: 16 },
    tools: { flexDirection: 'row', gap: 8, marginTop: 2, marginBottom: 16 },
    quickTool: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      paddingHorizontal: 6,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
    },
    quickToolText: {
      color: theme.colors.text,
      fontSize: 13,
      lineHeight: 20,
      fontWeight: '600',
      textAlign: 'center',
    },
    tool: {
      paddingVertical: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 60,
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    toolText: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 23,
      fontWeight: '600',
      flexShrink: 1,
    },
    retry: {
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      marginLeft: -8,
      marginTop: 6,
    },
    error: {
      padding: 16,
      backgroundColor: theme.colors.dangerSoft,
      marginBottom: 18,
      borderRadius: 4,
    },
    errorText: { color: theme.colors.text, fontSize: 13, lineHeight: 22 },
    link: { color: theme.colors.accent, marginTop: 10, fontWeight: '600' },
  });
