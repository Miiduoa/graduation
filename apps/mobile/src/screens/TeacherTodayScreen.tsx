import React, { useCallback, useRef, useState } from 'react';
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
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

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
  const generation = useRef(0);
  const attendanceRequests = useRef<{ scope: string; keys: Map<string, string> }>({
    scope,
    keys: new Map(),
  });
  if (attendanceRequests.current.scope !== scope)
    attendanceRequests.current = { scope, keys: new Map() };
  const inFlight = useRef<{ scope: string; groupId: string } | null>(null);
  const [starting, setStarting] = useState<{ scope: string; groupId: string } | null>(null);
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);
  const [state, setState] = useState<HomeState>({ scope, status: 'loading' });
  const current = state.scope === scope ? state : null;
  const data = current?.status === 'ready' ? current.data : null;
  const loading = !current || current.status === 'loading';

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

  const openClassroom = (groupId: string, groupName: string, sessionId?: string) =>
    safeNavigate(navigation, 'Classroom', { groupId, groupName, sessionId });
  const openGradebook = (groupId: string, groupName: string) =>
    safeNavigate(navigation, 'CourseGradebook', { groupId, groupName, sourceSystem: 'workspace' });
  const startClassroom = async (groupId: string, groupName: string) => {
    if (inFlight.current?.scope === scope) return;
    const requestGeneration = generation.current;
    const operation = { scope, groupId };
    inFlight.current = operation;
    setStarting(operation);
    setActionError(null);
    const keys = attendanceRequests.current.keys;
    const requestId = keys.get(groupId) ?? randomUUID();
    keys.set(groupId, requestId);
    try {
      const session = await startAttendanceSession({ courseSpaceId: groupId, requestId });
      if (!session.success || !session.sessionId) throw new Error('attendance-session-unconfirmed');
      if (currentScope.current !== scope || generation.current !== requestGeneration) return;
      keys.delete(groupId);
      openClassroom(groupId, groupName, session.sessionId);
    } catch {
      if (currentScope.current === scope && generation.current === requestGeneration) {
        setActionError({ scope, message: `無法開始「${groupName}」的點名，請確認連線後重試。` });
      }
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
        contentContainerStyle={{ padding: 22, paddingBottom: bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.accent} />
        }
      >
        <Text style={s.brand}>CAMPUS ONE</Text>
        <Text accessibilityRole="header" style={s.heading}>
          今天的教學工作
        </Text>
        <Text style={s.caption}>查看課程動態、學生繳交與課堂點名。</Text>

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
            <View style={s.focus}>
              <Text style={s.label}>我的授課</Text>
              <Text style={s.focusTitle}>
                {data.courses.length ? `${data.courses.length} 門課程` : '尚未加入授課課程'}
              </Text>
              <Text style={s.body}>
                {data.courses.length
                  ? '先查看需要處理的課務，或選擇一門課開啟課堂。'
                  : '課程管理員加入你的授課帳號後，課程會顯示在這裡。'}
              </Text>
            </View>

            {data.courses.length ? (
              <>
                <Text accessibilityRole="header" style={s.sectionTitle}>
                  近期教學待辦
                </Text>
                {data.tasks.length ? (
                  data.tasks.map((task) => (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      style={s.task}
                      onPress={() => openTask(task)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.taskTitle}>{task.title}</Text>
                        <Text style={s.meta}>{task.groupName}</Text>
                        <Text style={s.taskAction}>
                          {task.kind === 'live'
                            ? '進入課堂'
                            : task.kind === 'group'
                              ? '查看課程動態'
                              : '查看成績簿'}
                        </Text>
                      </View>
                      <Text accessibilityElementsHidden style={s.arrow}>
                        ↗
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={s.empty}>可從下方課程查看點名與評分狀態。</Text>
                )}

                <Text accessibilityRole="header" style={s.sectionTitle}>
                  授課課程
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
                          accessibilityLabel={`${course.name}，${activeSession?.sessionId ? '進入課堂' : '開始點名'}`}
                          accessibilityState={{
                            disabled: starting?.scope === scope,
                            busy: isStarting,
                          }}
                          disabled={starting?.scope === scope}
                          onPress={() =>
                            activeSession?.sessionId
                              ? openClassroom(course.groupId, course.name, activeSession.sessionId)
                              : void startClassroom(course.groupId, course.name)
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
    brand: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
      color: theme.colors.textSecondary,
      marginBottom: 28,
    },
    heading: { color: theme.colors.text, fontSize: 28, fontWeight: '600', letterSpacing: -1 },
    caption: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 22,
      marginTop: 10,
      marginBottom: 26,
    },
    spinner: { marginVertical: 36 },
    focus: {
      backgroundColor: theme.colors.focusSurface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 24,
    },
    label: { color: theme.colors.textSecondary, fontSize: 11, letterSpacing: 1 },
    focusTitle: { color: theme.colors.text, fontSize: 25, fontWeight: '600', marginVertical: 14 },
    body: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 22 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginTop: 32,
      marginBottom: 12,
    },
    task: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 18,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    taskTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text, lineHeight: 22 },
    meta: { fontSize: 12, color: theme.colors.muted, marginTop: 5 },
    taskAction: { fontSize: 12, color: theme.colors.accent, marginTop: 10 },
    arrow: { color: theme.colors.muted, fontSize: 19 },
    empty: { color: theme.colors.muted, fontSize: 13, lineHeight: 23, paddingVertical: 16 },
    course: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: 20,
      marginBottom: 10,
    },
    courseTitle: { color: theme.colors.text, fontWeight: '600', fontSize: 17, lineHeight: 24 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
    primary: {
      backgroundColor: theme.colors.accent,
      borderRadius: 4,
      paddingHorizontal: 18,
      paddingVertical: 13,
      minHeight: 44,
    },
    primaryText: { color: theme.colors.onAccent, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.55 },
    secondary: { justifyContent: 'center', paddingHorizontal: 14, minHeight: 44 },
    error: {
      padding: 16,
      backgroundColor: theme.colors.dangerSoft,
      marginBottom: 18,
      borderRadius: 4,
    },
    errorText: { color: theme.colors.text, fontSize: 13, lineHeight: 22 },
    retry: { paddingVertical: 13, alignSelf: 'flex-start', minHeight: 44 },
    link: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  });
