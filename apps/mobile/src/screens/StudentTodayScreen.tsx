import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuickCampusEntry } from '../components/QuickCampusEntry';
import type { MobileQuickAction } from '../services/quickCampusActions';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { rootNavigateNested } from '../app/rootNavigation';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { navigateFromInboxTask, resolveInboxAction } from '../services/inboxActions';
import { hasTCSession } from '../services/tronClassClient';
import {
  courseWorkNavForClass,
  resolveTimetableClassroomNav,
  todayCourseWorkNavigateTarget,
  type TimetableClassroomDestination,
} from '../hooks/timetableClassroomNav';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import {
  formatClock,
  formatTodayHeaderDate,
  formatTodoDueLine,
  formatUpcomingDueLine,
  formatUpdatedAt,
  isDueWithinHours,
  isSameTaipeiDay,
  isTodoOverdue,
  pickNextAction,
  sortTodayClasses,
  TODAY_COPY,
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';

type HomeState =
  | { scope: string; status: 'loading' | 'error' }
  | {
      scope: string;
      status: 'ready';
      tasks: InboxTask[];
      updatedAt: Date | null;
      lmsConnected: boolean | null;
    };

type TodoRow = TodayTodo & { task?: InboxTask };

function todosFromInbox(tasks: InboxTask[]): TodoRow[] {
  return tasks.flatMap((task) => {
    if (task.kind !== 'assignment' && task.kind !== 'quiz') return [];
    // A malformed or missing deadline must not hide the work altogether.
    const rawDue = task.dueAt instanceof Date ? task.dueAt.getTime() : null;
    const due = rawDue !== null && Number.isFinite(rawDue) ? rawDue : null;
    return [
      {
        id: task.id,
        title: task.title,
        courseName: task.groupName,
        courseId: task.groupId,
        dueAt: due,
        task,
      },
    ];
  });
}

export default function StudentTodayScreen() {
  const s = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const navigation = useNavigation();
  const bottom = useTabBarContentBottomPadding();
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const schoolId = profile?.schoolId;
  const scope = JSON.stringify([uid, schoolId, profile?.role]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<HomeState>({ scope, status: 'loading' });
  const [now, setNow] = useState(() => new Date());
  const [refreshState, setRefreshState] = useState<{ scope: string; request: number } | null>(null);
  const refreshGeneration = useRef(0);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const [expandedTodoScope, setExpandedTodoScope] = useState<string | null>(null);
  const previousTodos = useRef<string[]>([]);
  const scrollY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const generation = useRef(0);
  const current = state.scope === scope ? state : null;
  const data = current?.status === 'ready' ? current : null;
  const updatedAt = data?.updatedAt ?? null;
  const lmsConnected = data?.lmsConnected ?? null;
  const loading = !current || current.status === 'loading';
  const error = current?.status === 'error';
  const unsigned = !uid;
  const {
    status: timetableStatus,
    classes,
    termKey,
    retry: retryTimetable,
  } = useTodayTimetableData(now);

  const load = useCallback(
    async (silent = false) => {
      const request = ++generation.current;
      if (!silent) setState({ scope, status: 'loading' });
      try {
        if (!uid) {
          if (request === generation.current && currentScope.current === scope)
            setState({ scope, status: 'ready', tasks: [], updatedAt: null, lmsConnected: null });
          return;
        }
        const [{ tasks }, connected] = await Promise.all([
          loadStudentHome(uid, schoolId, 'today'),
          hasTCSession().catch(() => false),
        ]);
        if (request === generation.current && currentScope.current === scope) {
          setState({
            scope,
            status: 'ready',
            tasks,
            lmsConnected: connected,
            updatedAt: new Date(),
          });
        }
      } catch {
        if (request === generation.current && currentScope.current === scope)
          setState({ scope, status: 'error' });
      }
    },
    [uid, schoolId, scope],
  );

  useFocusEffect(
    useCallback(() => {
      const y = scrollY.current;
      const frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: false });
      });
      void load(true);
      return () => {
        cancelAnimationFrame(frame);
        generation.current += 1;
        refreshGeneration.current += 1;
      };
    }, [load]),
  );
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const todos = useMemo(() => todosFromInbox(data?.tasks ?? []), [data?.tasks]);
  useEffect(() => {
    const ids = todos.map((item) => item.id);
    const gone = previousTodos.current.filter((id) => !ids.includes(id));
    previousTodos.current = ids;
    if (!gone.length) return;
    setLeavingIds(gone);
    const timer = setTimeout(() => setLeavingIds([]), 200);
    return () => clearTimeout(timer);
  }, [todos]);

  const classRows = sortTodayClasses(classes, now);
  const workAction = pickNextAction([], todos, now);
  const nextTodo = 'todo' in workAction ? workAction.todo : null;
  const firstTodo = todos.find(item => item.id === nextTodo?.id);
  const todoRows = firstTodo ? [firstTodo, ...todos.filter(item => item.id !== firstTodo.id)] : todos;
  const todosExpanded = expandedTodoScope === scope;
  const firstLoad = unsigned
    ? timetableStatus === 'loading'
    : !updatedAt && (loading || timetableStatus === 'loading');
  const lmsUnconnected = !unsigned && !error && lmsConnected === false && todos.length === 0;

  const openCourse = (
    item: TodayClass & { courseWorkNav?: TimetableClassroomDestination; courseCode?: string },
  ) => {
    const target = todayCourseWorkNavigateTarget(courseWorkNavForClass(item));
    safeNavigate(navigation, target.screen, target.params);
  };
  const openTodo = (row: TodoRow, scrollToSubmit = false) => {
    if (scrollToSubmit && row.task) {
      // The task carries its real assignment / quiz ID and destination.
      // If opening fails, the navigation helper explains why; never invent a submit ID.
      navigateFromInboxTask(navigation, row.task, {
        role: auth.profile?.role,
        isTeachingRole: false,
        scrollToSubmit,
      });
      return;
    }
    const target = todayCourseWorkNavigateTarget(resolveTimetableClassroomNav({
      // Inbox tasks already carry the real course/group ID; never infer it from a title.
      linkedCourseId: row.courseId,
      courseName: row.courseName,
    }));
    safeNavigate(navigation, target.screen, target.params);
  };
  const openWeek = () =>
    rootNavigateNested('學習', 'PersonalTimetable', termKey ? { term: termKey } : undefined);
  const openImport = () => rootNavigateNested('學習', 'PersonalImport', { kind: 'timetable' });
  const openQuickAction = (quick: MobileQuickAction) => {
    if (quick.destination === '/classroom' && todos.length === 1) {
      // Use the current user's real assignment or quiz, never fabricate a submit id.
      openTodo(todos[0], true);
      return;
    }
    safeNavigate(navigation, quick.route);
  };
  const refresh = async () => {
    const request = ++refreshGeneration.current;
    setRefreshState({ scope, request });
    await Promise.allSettled([load(true), retryTimetable()]);
    if (currentScope.current === scope && refreshGeneration.current === request) {
      setRefreshState(null);
    }
  };

  const urgentWorkFirst = todos.some(todo => isDueWithinHours(todo, now, 24) || isTodoOverdue(todo, now));
  const scheduleSection = (
    <TodayClassList
      classes={classRows}
      status={timetableStatus}
      now={now}
      styles={s}
      onOpenClass={openCourse}
      onRetry={() => void retryTimetable()}
      onImport={openImport}
      onOpenTimetable={openWeek}
    />
  );
  const todoSection = (
    <TodoList
      todos={todoRows}
      expanded={todosExpanded}
      unsigned={unsigned}
      error={error}
      lmsUnconnected={lmsUnconnected}
      leavingIds={leavingIds}
      now={now}
      styles={s}
      onOpen={openTodo}
      onToggleExpanded={() =>
        setExpandedTodoScope((previous) => (previous === scope ? null : scope))
      }
      onRetry={() => void load()}
    />
  );

  return (
    <SafeAreaView style={s.page} edges={['top']} testID="student-today">
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.content, { paddingBottom: bottom + 24 }]}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={
              refreshState?.scope === scope && refreshState.request === refreshGeneration.current
            }
            onRefresh={() => void refresh()}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={s.dayHeader}>
          <Text accessibilityRole="header" style={s.heading}>今天</Text>
          <View style={s.dateBlock}>
            <Text style={s.date}>{formatTodayHeaderDate(now)}</Text>
            {updatedAt ? <Text style={s.updated}>{formatUpdatedAt(updatedAt)}</Text> : null}
          </View>
          {profile?.role === 'student' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="開啟數位學生證"
              onPress={() => rootNavigateNested('我的', 'StudentCard')}
              style={s.studentCard}
            >
              <Ionicons name="id-card-outline" size={19} color={theme.colors.text} />
              <Text style={s.studentCardLabel}>學生證</Text>
            </Pressable>
          )}
        </View>
        {firstLoad ? (
          <TodaySkeleton styles={s} />
        ) : (
          <>
            {urgentWorkFirst && todoSection}
            {scheduleSection}
            {!urgentWorkFirst && todoSection}
            <QuickCampusEntry
              key={scope}
              uid={uid}
              schoolId={schoolId}
              onOpen={openQuickAction}
              onOpenAssistantRoute={(route) => safeNavigate(navigation, route)}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TodaySkeleton({ styles: s }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View accessibilityState={{ busy: true }} testID="today-skeleton">
      <View style={s.skeletonHeading} />
      <View style={s.skeletonLine} />
      <View style={s.skeletonLine} />
      <View style={s.skeletonLine} />
    </View>
  );
}

function TodayClassList({
  classes,
  status,
  now,
  styles: s,
  onOpenClass,
  onRetry,
  onImport,
  onOpenTimetable,
}: {
  classes: Array<TodayClass & { courseWorkNav?: TimetableClassroomDestination; courseCode?: string }>;
  status: string;
  now: Date;
  styles: ReturnType<typeof createStyles>;
  onOpenClass: (item: TodayClass & { courseWorkNav?: TimetableClassroomDestination; courseCode?: string }) => void;
  onRetry: () => void;
  onImport: () => void;
  onOpenTimetable: () => void;
}) {
  const visible = classes.slice(0, 4);
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text accessibilityRole="header" style={s.sectionTitle}>今天課表</Text>
        <Pressable accessibilityRole="button" onPress={onOpenTimetable} style={s.textButton}>
          <Text style={s.link}>{TODAY_COPY.viewFullTimetable}</Text>
        </Pressable>
      </View>
      {status === 'loading' ? (
        <>
          <View style={s.skeletonLine} />
          <View style={s.skeletonLine} />
        </>
      ) : status === 'error' ? (
        <>
          <Text accessibilityRole="alert" style={s.empty}>
            {TODAY_COPY.timetableUnavailable}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={s.textButton}>
            <Text style={s.link}>{TODAY_COPY.retry}</Text>
          </Pressable>
        </>
      ) : status === 'empty' ? (
        <>
          <Text style={s.empty}>{TODAY_COPY.noTimetable}</Text>
          <Pressable accessibilityRole="button" onPress={onImport} style={s.textButton}>
            <Text style={s.link}>{TODAY_COPY.importTimetable}</Text>
          </Pressable>
        </>
      ) : visible.length === 0 ? (
        <Text style={s.empty}>今天沒有排課。</Text>
      ) : (
        <View style={s.list}>
          {visible.map((item, index) => {
            const ended = item.endAt <= now.getTime();
            const ongoing = !ended && item.startAt <= now.getTime();
            const label = ongoing
              ? '上課中'
              : ended
                ? '已結束'
                : index === 0
                  ? TODAY_COPY.nextClass
                  : '';
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={[
                  label,
                  item.title,
                  formatClock(item.startAt) + ' 至 ' + formatClock(item.endAt),
                  item.location || '教室未填',
                ].filter(Boolean).join('，')}
                accessibilityHint={item.courseId ? TODAY_COPY.viewCourse : TODAY_COPY.findCourse}
                onPress={() => onOpenClass(item)}
                style={({ pressed }) => [
                  s.row,
                  index > 0 && s.rowBorder,
                  pressed && s.pressed,
                ]}
              >
                <View style={s.timeColumn}>
                  <Text style={[s.time, ended && s.endedTitle]}>{formatClock(item.startAt)}</Text>
                  <Text style={s.rowMeta}>{formatClock(item.endAt)}</Text>
                </View>
                <View style={s.rowBody}>
                  {!!label && <Text style={[s.classStatus, ongoing && s.ongoing]}>{label}</Text>}
                  <Text style={[s.rowTitle, ended && s.endedTitle]}>{item.title}</Text>
                  <Text style={s.rowMeta}>{item.location || '教室未填'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={s.rowMeta.color} />
              </Pressable>
            );
          })}
          {classes.length > visible.length && (
            <Text style={s.rowMeta}>還有 {classes.length - visible.length} 堂課，可在完整課表查看。</Text>
          )}
        </View>
      )}
    </View>
  );
}

function TodoList({
  todos,
  expanded,
  unsigned,
  error,
  lmsUnconnected,
  leavingIds,
  now,
  styles: s,
  onOpen,
  onToggleExpanded,
  onRetry,
}: {
  todos: TodoRow[];
  expanded: boolean;
  unsigned: boolean;
  error: boolean;
  lmsUnconnected: boolean;
  leavingIds: string[];
  now: Date;
  styles: ReturnType<typeof createStyles>;
  onOpen: (todo: TodoRow, scrollToSubmit?: boolean) => void;
  onToggleExpanded: () => void;
  onRetry: () => void;
}) {
  const visible = expanded ? todos : todos.slice(0, 3);
  const extra = Math.max(0, todos.length - 3);
  const leaving = new Set(leavingIds);
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        待處理
      </Text>
      {unsigned ? (
        <Text style={s.empty}>{TODAY_COPY.unsigned}</Text>
      ) : error ? (
        <>
          <Text accessibilityRole="alert" style={s.empty}>
            無法讀取校務課程。請確認登入狀態與網路連線後重試。
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={s.textButton}>
            <Text style={s.link}>{TODAY_COPY.retry}</Text>
          </Pressable>
        </>
      ) : lmsUnconnected && todos.length === 0 ? (
        <Text style={s.empty}>{TODAY_COPY.lmsUnconnected}</Text>
      ) : visible.length === 0 ? (
        <Text style={s.empty}>已載入的課程目前沒有待處理的作業或測驗。</Text>
      ) : (
        <View style={s.list}>
          {visible.map((item, index) => {
            const overdue = isTodoOverdue(item, now);
            const soon = isDueWithinHours(item, now, 6);
            const due = item.dueAt !== null && !overdue && !isSameTaipeiDay(item.dueAt, now.getTime())
              ? formatUpcomingDueLine(item)
              : formatTodoDueLine(item, now);
            const direct = item.task ? resolveInboxAction(item.task) : null;
            return (
              <View key={item.id} style={[s.todoRow, index > 0 && s.rowBorder, leaving.has(item.id) && s.leaving]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}，${item.courseName}`}
                  accessibilityValue={{ text: due }}
                  onPress={() => onOpen(item)}
                  style={({ pressed }) => [s.row, s.todoBody, pressed && s.pressed]}
                >
                  <View style={s.rowBody}>
                    <Text style={s.rowTitle}>{item.title}</Text>
                    {!!item.courseName && <Text style={s.rowMeta}>{item.courseName}</Text>}
                    <Text style={[s.rowMeta, overdue ? s.overdue : soon ? s.dueSoon : undefined]}>{due}</Text>
                  </View>
                </Pressable>
                {direct && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`${direct.label}，${item.title}`}
                    onPress={() => onOpen(item, true)} style={({ pressed }) => [s.inlineAction, pressed && s.pressed]}>
                    <Text style={s.link}>{direct.label}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {extra > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={onToggleExpanded}
              style={s.more}
            >
              <Text style={s.link}>
                {expanded ? '收合待辦' : TODAY_COPY.moreTodos(extra)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const createStyles = () => {
  const dark = theme.mode === 'dark';
  const text = dark ? '#F2F3F1' : '#252729';
  const muted = dark ? '#A5AAA7' : '#686C70';
  const border = dark ? '#292B2D' : '#E6E7E8';

  return StyleSheet.create({
    page: { flex: 1, backgroundColor: dark ? theme.colors.bg : '#FFFFFF' },
    dayHeader: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 4,
    },
    dateBlock: { flexShrink: 1, alignItems: 'flex-end', gap: 2 },
    content: {
      paddingHorizontal: 20,
      paddingTop: 22,
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      gap: 24,
    },
    studentCard: {
      flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14,
      borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    },
    studentCardLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
    date: {
      color: muted,
      fontSize: 13,
      lineHeight: 19,
      fontVariant: ['tabular-nums'],
    },
    heading: {
      color: text,
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '700',
    },
    updated: {
      color: muted,
      fontSize: 12,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
    section: { gap: 2 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      color: muted,
      fontSize: 14,
      lineHeight: 22,
      fontWeight: '500',
    },
    list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
    row: {
      minHeight: 68,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border },
    timeColumn: { minWidth: 52, flexShrink: 0, gap: 3 },
    time: {
      color: text,
      fontWeight: '500',
      fontSize: 15,
      lineHeight: 21,
      fontVariant: ['tabular-nums'],
    },
    classStatus: { color: muted, fontSize: 12, lineHeight: 17 },
    ongoing: { color: theme.colors.accent, fontWeight: '600' },
    todoRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10 },
    todoBody: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
    inlineAction: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 3 },
    rowTitle: { color: text, fontSize: 16, lineHeight: 23, fontWeight: '600' },
    rowMeta: {
      color: muted,
      fontSize: 13,
      lineHeight: 19,
      fontVariant: ['tabular-nums'],
    },
    dueSoon: { color: theme.colors.accent, fontWeight: '600' },
    overdue: { color: theme.colors.danger, fontWeight: '600' },
    endedTitle: { color: muted },
    leaving: { opacity: 0 },
    more: { minHeight: 44, justifyContent: 'center' },
    empty: { color: muted, fontSize: 14, lineHeight: 22, paddingVertical: 8 },
    textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { color: theme.colors.accent, fontWeight: '500', fontSize: 13, lineHeight: 19 },
    skeletonHeading: {
      width: '30%',
      height: 20,
      borderRadius: 3,
      backgroundColor: theme.colors.surface2,
      marginBottom: 20,
    },
    skeletonLine: {
      height: 40,
      borderRadius: 3,
      backgroundColor: theme.colors.surface2,
      marginBottom: 16,
    },
    pressed: { opacity: 0.65 },
  });
};
