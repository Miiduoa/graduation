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
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { loadTeacherHome, type TeacherHomeData } from '../data/teacherHome';
import { startAttendanceSession } from '../data/courseSpaceSource';
import { createTeacherLiveSessionStarter } from '../services/teacherLiveSessionStarter';
import type { InboxTask } from '../data/types';
import { TEACHER_ACADEMIC_SECTIONS } from '@campus/shared/src/academicSections';
import { safeNavigate } from '../utils/safeNavigate';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

const TEACHER_TODAY_LABEL = TEACHER_ACADEMIC_SECTIONS[0].label;
const TEACHER_COURSES_LABEL = TEACHER_ACADEMIC_SECTIONS[1].label;
const TEACHER_TEACHING_TODOS_LABEL = TEACHER_ACADEMIC_SECTIONS[2].label;
const TEACHER_GRADING_LABEL = TEACHER_ACADEMIC_SECTIONS[3].label;

function isTeachingTodoKind(kind: InboxTask['kind']): boolean {
  return kind === 'live' || kind === 'group';
}

type HomeState =
  | { scope: string; status: 'loading' | 'error' }
  | { scope: string; status: 'ready'; data: TeacherHomeData };

export default function TeacherTodayScreen() {
  const s = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school } = useSchool();
  const navigation = useNavigation();
  const bottom = useTabBarContentBottomPadding();
  const uid = auth.user?.uid ?? '';
  const schoolId = auth.profile?.schoolId ?? school.id;
  const scope = JSON.stringify([uid, schoolId, auth.profile?.role, auth.profile?.roleGroup]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const identity = useRef({ uid, schoolId });
  identity.current = { uid, schoolId };
  const generation = useRef(0);
  const starter = useRef<ReturnType<typeof createTeacherLiveSessionStarter> | null>(null);
  const liveStarter = () => {
    if (!starter.current) {
      starter.current = createTeacherLiveSessionStarter({
        send: (input) =>
          startAttendanceSession({
            courseSpaceId: input.groupId,
            requestId: input.requestId,
            qrExpiryMinutes: input.qrExpiryMinutes,
          }),
        newRequestId: () => randomUUID(),
        currentScope: () => identity.current,
      });
    }
    return starter.current;
  };
  const inFlight = useRef<{ scope: string; groupId: string } | null>(null);
  const [starting, setStarting] = useState<{ scope: string; groupId: string } | null>(null);
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);
  const [state, setState] = useState<HomeState>({ scope, status: 'loading' });
  const current = state.scope === scope ? state : null;
  const data = current?.status === 'ready' ? current.data : null;
  const loading = !current || current.status === 'loading';
  const teachingTodos = data?.tasks.filter((task) => isTeachingTodoKind(task.kind)) ?? [];
  const gradingTasks = data?.tasks.filter((task) => !isTeachingTodoKind(task.kind)) ?? [];

  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, status: 'loading' });
    try {
      const result = await loadTeacherHome(uid, schoolId);
      if (request === generation.current && currentScope.current === scope) {
        setState({ scope, status: 'ready', data: result });
      }
    } catch {
      if (request === generation.current && currentScope.current === scope) {
        setState({ scope, status: 'error' });
      }
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
    liveStarter();
    return () => {
      starter.current?.dispose();
      starter.current = null;
    };
  }, []);

  const openClassroom = (groupId: string, groupName: string, sessionId?: string) =>
    safeNavigate(navigation, 'Classroom', { groupId, groupName, sessionId });
  const openGradebook = (groupId: string, groupName: string) =>
    safeNavigate(navigation, 'CourseGradebook', { groupId, groupName, sourceSystem: 'workspace' });
  const startClassroom = async (
    groupId: string,
    groupName: string,
    role: string | null | undefined,
  ) => {
    if (inFlight.current?.scope === scope) return;
    const requestGeneration = generation.current;
    const operation = { scope, groupId };
    inFlight.current = operation;
    setStarting(operation);
    setActionError(null);
    try {
      const session = await liveStarter().start({ uid, schoolId, groupId, role });
      if (currentScope.current !== scope || generation.current !== requestGeneration) return;
      if (!session || session.status === 'busy' || session.status === 'stale') return;
      if (session.status === 'started') {
        openClassroom(groupId, groupName, session.sessionId);
        return;
      }
      setActionError({ scope, message: `無法開始「${groupName}」的點名，請確認連線後重試。` });
    } finally {
      if (inFlight.current === operation) {
        inFlight.current = null;
        setStarting(null);
      }
    }
  };
  const openTask = (task: InboxTask) => {
    if (task.kind === 'live') openClassroom(task.groupId, task.groupName, task.sessionId);
    else if (task.kind === 'group') {
      safeNavigate(navigation, 'GroupDetail', { groupId: task.groupId });
    } else openGradebook(task.groupId, task.groupName);
  };

  return (
    <SafeAreaView style={s.page} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: 20,
          paddingBottom: bottom + 24,
        }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.accent} />
        }
      >
        <Text accessibilityRole="header" style={s.heading}>
          {TEACHER_TODAY_LABEL}
        </Text>
        {data ? (
          <Text style={s.meta}>
            {data.courses.length
              ? `${data.courses.length} 門課程 · ${teachingTodos.length} 項教學待辦 · ${gradingTasks.length} 項待批改`
              : '尚未加入授課課程'}
          </Text>
        ) : null}

        {loading ? <ActivityIndicator color={theme.colors.accent} style={s.spinner} /> : null}
        {current?.status === 'error' ? (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.errorText}>無法讀取教學資料。請確認登入狀態與網路連線後重試。</Text>
            <Pressable accessibilityRole="button" onPress={load} style={s.retry}>
              <Text style={s.link}>重新讀取</Text>
            </Pressable>
          </View>
        ) : null}
        {actionError?.scope === scope ? (
          <View accessibilityRole="alert" style={s.error}>
            <Text style={s.errorText}>{actionError.message}</Text>
          </View>
        ) : null}

        {data ? (
          <>
            {data.courses.length ? null : (
              <Text style={s.empty}>課程管理員加入你的授課帳號後，課程會顯示在這裡。</Text>
            )}

            {data.courses.length ? (
              <>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  {TEACHER_COURSES_LABEL}
                </Text>
                {data.courses.map((course) => {
                  const activeSession = data.tasks.find(
                    (task) => task.groupId === course.groupId && task.kind === 'live',
                  );
                  const isStarting =
                    starting?.scope === scope && starting.groupId === course.groupId;
                  return (
                    <View key={course.groupId} style={s.course}>
                      <Text style={s.courseTitle}>{course.name}</Text>
                      <View style={s.actions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${course.name}，開啟課程工作台`}
                          onPress={() =>
                            safeNavigate(navigation, 'CourseHub', {
                              groupId: course.groupId,
                              groupName: course.name,
                            })
                          }
                          style={s.secondary}
                        >
                          <Text style={s.link}>課程工作台</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${course.name}，${activeSession?.sessionId ? '進入課堂' : '開始點名'}`}
                          accessibilityState={{
                            disabled: starting?.scope === scope,
                            busy: isStarting,
                          }}
                          disabled={starting?.scope === scope}
                          onPress={() =>
                            activeSession?.sessionId
                              ? openClassroom(course.groupId, course.name, activeSession.sessionId)
                              : void startClassroom(course.groupId, course.name, course.role)
                          }
                          style={[s.primary, starting?.scope === scope && s.disabled]}
                        >
                          <Text style={s.primaryText}>
                            {isStarting
                              ? '正在開始…'
                              : activeSession?.sessionId
                                ? '進入課堂'
                                : '開始點名'}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${course.name}，成績簿`}
                          onPress={() => openGradebook(course.groupId, course.name)}
                          style={s.secondary}
                        >
                          <Text style={s.link}>成績簿</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}

                <Text accessibilityRole="header" style={s.sectionTitle}>
                  {TEACHER_TEACHING_TODOS_LABEL}
                </Text>
                {teachingTodos.length ? (
                  teachingTodos.map((task) => (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      style={s.task}
                      onPress={() => openTask(task)}
                    >
                      <View style={s.taskCopy}>
                        <Text style={s.taskTitle}>{task.title}</Text>
                        <Text style={s.meta}>{task.groupName}</Text>
                        <Text style={s.taskAction}>
                          {task.kind === 'live' ? '進入課堂' : '查看課程動態'}
                        </Text>
                      </View>
                      <Text
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={s.arrow}
                      >
                        ›
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>目前沒有點名或課程動態待辦。</Text>
                )}
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  {TEACHER_GRADING_LABEL}
                </Text>
                {gradingTasks.length ? (
                  gradingTasks.map((task) => (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      style={s.task}
                      onPress={() => openTask(task)}
                    >
                      <View style={s.taskCopy}>
                        <Text style={s.taskTitle}>{task.title}</Text>
                        <Text style={s.meta}>{task.groupName}</Text>
                        <Text style={s.taskAction}>查看成績簿</Text>
                      </View>
                      <Text
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={s.arrow}
                      >
                        ›
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>目前沒有待批改項目。</Text>
                )}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    heading: {
      fontFamily: pageTitleFont,
      color: theme.colors.text,
      fontSize: 30,
      lineHeight: 38,
      fontWeight: '800',
      letterSpacing: 0,
    },
    spinner: { marginVertical: 36 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '800',
      marginTop: 30,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    task: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 64,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    taskCopy: { flex: 1, minWidth: 0 },
    taskTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, lineHeight: 22 },
    meta: { fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary, marginTop: 6 },
    taskAction: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: theme.colors.accent,
      marginTop: 6,
    },
    arrow: { color: theme.colors.muted, fontSize: 22, lineHeight: 26 },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 22,
      paddingVertical: 14,
    },
    course: {
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    courseTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 17, lineHeight: 24 },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 4,
      rowGap: 4,
      marginTop: 12,
    },
    primary: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 18,
      minHeight: 44,
      justifyContent: 'center',
      marginRight: 8,
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    disabled: { opacity: 0.55 },
    secondary: { justifyContent: 'center', paddingHorizontal: 12, minHeight: 44 },
    error: {
      padding: 14,
      backgroundColor: theme.colors.dangerSoft,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
      marginTop: 16,
    },
    errorText: { color: theme.colors.text, fontSize: 14, lineHeight: 22 },
    retry: { paddingVertical: 10, alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    link: { color: theme.colors.accent, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  });
