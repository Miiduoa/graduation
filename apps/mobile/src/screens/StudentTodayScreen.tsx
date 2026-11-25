import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
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
import { CampusPersonalization } from '../components/CampusPersonalization';
import { getMobileActionsForDestinations, type MobileQuickAction } from '../services/quickCampusActions';
import { TODAY_SERVICE_SHORTCUTS, TODAY_TIMETABLE_SETUP_DETAIL } from '@campus/shared/src/todayServiceShortcuts';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { rootNavigateNested } from '../app/rootNavigation';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
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
import { isCurrentPriorityTerm, pickTodayPriority } from '@campus/shared/src/todayPriority';
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
      tasksComplete: boolean;
      updatedAt: Date | null;
      lmsConnected: boolean | null;
    };

type TodoRow = TodayTodo & { task?: InboxTask };

const shortcutIcons: Record<
  (typeof TODAY_SERVICE_SHORTCUTS)[number]['destination'],
  React.ComponentProps<typeof Ionicons>['name']
> = {
  '/map': 'map-outline',
  '/bus': 'bus-outline',
  '/cafeteria': 'restaurant-outline',
  '/library': 'library-outline',
};

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
    refreshing: timetableRefreshing,
    scope: timetableScope,
    classes,
    termKey,
    retry: retryTimetable,
  } = useTodayTimetableData(now);

  const load = useCallback(
    async (silent = false) => {
      const request = ++generation.current;
      setState(previous => silent && previous.scope === scope && previous.status === 'ready'
        ? { ...previous, tasksComplete: false }
        : { scope, status: 'loading' });
      try {
        if (!uid) {
          if (request === generation.current && currentScope.current === scope)
            setState({ scope, status: 'ready', tasks: [], tasksComplete: false, updatedAt: null, lmsConnected: null });
          return;
        }
        const [{ tasks, tasksComplete }, connected] = await Promise.all([
          loadStudentHome(uid, schoolId, 'today'),
          hasTCSession().catch(() => false),
        ]);
        if (request === generation.current && currentScope.current === scope) {
          setState({
            scope,
            status: 'ready',
            tasks,
            tasksComplete: tasksComplete === true,
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
      let day = new Date();
      let foreground = AppState.currentState !== 'inactive' && AppState.currentState !== 'background';
      setNow(day);
      if (foreground) void load(true);
      const subscription = AppState.addEventListener('change', state => {
        if (state !== 'active') {
          if (foreground) {
            foreground = false;
            generation.current += 1;
            setState(previous => previous.status === 'ready' && previous.tasksComplete
              ? { ...previous, tasksComplete: false } : previous);
          }
          return;
        }
        if (foreground) return;
        foreground = true;
        day = new Date();
        setNow(day);
        void load(true);
      });
      const timer = setInterval(() => {
        if (!foreground) return;
        const next = new Date();
        if (!isSameTaipeiDay(day.getTime(), next.getTime())) {
          void load(true);
          void retryTimetable();
        }
        day = next;
        setNow(next);
      }, 60_000);
      return () => {
        clearInterval(timer);
        subscription.remove();
        cancelAnimationFrame(frame);
        generation.current += 1;
        refreshGeneration.current += 1;
      };
    }, [load, retryTimetable]),
  );

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
  const pulling = refreshState?.scope === scope && refreshState.request === refreshGeneration.current;
  const priority = !auth.loading && uid && schoolId && data?.tasksComplete && !timetableRefreshing && !pulling &&
    timetableStatus === 'ready' && isCurrentPriorityTerm(termKey, now) &&
    timetableScope?.owner === `firebase:${uid}` && timetableScope.schoolId === schoolId
    ? pickTodayPriority(classes, todos, now) : null;
  const reminder = priority?.kind === 'deadline-during-class'
    ? todos.find(row => row.id === priority.todo.id && row.courseId === priority.todo.courseId) : undefined;
  const activeReminder = useRef(reminder);
  activeReminder.current = reminder;
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
      return navigateFromInboxTask(navigation, row.task, {
        role: auth.profile?.role,
        isTeachingRole: false,
        scrollToSubmit,
      });
    }
    const target = todayCourseWorkNavigateTarget(resolveTimetableClassroomNav({
      // Inbox tasks already carry the real course/group ID; never infer it from a title.
      linkedCourseId: row.courseId,
      courseName: row.courseName,
    }));
    return safeNavigate(navigation, target.screen, target.params);
  };
  const openWeek = () =>
    rootNavigateNested('學習', 'PersonalTimetable', termKey ? { term: termKey } : undefined);
  const openImport = () => rootNavigateNested('學習', 'PersonalImport', { kind: 'timetable' });
  const openQuickAction = (quick: MobileQuickAction) => {
    if (quick.destination === '/classroom' && todos.length === 1) {
      // Use the current user's real assignment or quiz, never fabricate a submit id.
      return openTodo(todos[0], true);
    }
    return safeNavigate(navigation, quick.route);
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
      onOpenCalendar={() => safeNavigate(navigation, 'SmartCalendarScreen')}
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
            refreshing={pulling}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={s.dayHeader}>
          <View style={s.dayTitleBlock}>
            <Text style={s.date}>{formatTodayHeaderDate(now)}</Text>
            <Text accessibilityRole="header" style={s.heading}>今天</Text>
            {updatedAt ? <Text style={s.updated}>{formatUpdatedAt(updatedAt)}</Text> : null}
          </View>
          {profile?.role === 'student' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="開啟數位學生證"
              onPress={() => rootNavigateNested('我的', 'StudentCard')}
              style={({ pressed }) => [s.studentCard, pressed && s.rowPressed]}
            >
              <Ionicons name="id-card-outline" size={17} color={theme.colors.accent} />
              <Text style={s.studentCardLabel}>學生證</Text>
            </Pressable>
          )}
        </View>
        <QuickCampusEntry
          key={scope}
          uid={uid}
          schoolId={schoolId}
          presentation="workspace"
          navigation={navigation}
          onOpen={openQuickAction}
          onOpenAssistantRoute={(route) => safeNavigate(navigation, route)}
          onExplore={() => safeNavigate(navigation, 'Explore', { workContext: 'student' })}
        />
        {firstLoad ? (
          <TodaySkeleton styles={s} />
        ) : (
          <>
            {priority && reminder?.task?.assignmentId?.trim() && reminder.task.groupId.trim() ? (
              <View style={s.reminder}>
                <Text accessibilityRole="header" style={s.reminderTitle}>nuni 提醒</Text>
                <Text style={s.reminderHeading}>{priority.title}</Text>
                <Text style={s.reminderReason}>{priority.reason}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`查看提醒的${reminder.task.kind === 'quiz' ? '測驗' : '作業'}，${reminder.title}`}
                  onPress={() => { if (activeReminder.current === reminder) openTodo(reminder, true); }}
                  style={({ pressed }) => [s.reminderAction, pressed && s.reminderActionPressed]}
                >
                  <Text style={s.reminderActionText}>
                    {reminder.task.kind === 'quiz' ? '查看測驗' : '查看作業'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {urgentWorkFirst && todoSection}
            {scheduleSection}
            {!urgentWorkFirst && todoSection}
          </>
        )}
        <View style={s.section} testID="today-service-shortcuts">
          <Text accessibilityRole="header" style={s.sectionTitle}>校園服務</Text>
          <View style={s.shortcutGrid}>
            {TODAY_SERVICE_SHORTCUTS.map(item => (
              <Pressable
                key={item.destination}
                accessibilityRole="button"
                accessibilityLabel={`校園服務：${item.label}`}
                accessibilityHint={item.detail}
                onPress={() => {
                  const action = getMobileActionsForDestinations([item.destination])[0];
                  if (action) openQuickAction(action);
                }}
                style={({ pressed }) => [s.shortcut, pressed && s.pressed]}
              >
                <Ionicons name={shortcutIcons[item.destination]} size={22} color={theme.colors.accent} />
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{item.label}</Text>
                  <Text style={s.rowMeta}>{item.detail}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
        <CampusPersonalization now={now} />
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
          <Text style={s.rowTitle}>{TODAY_COPY.noTimetable}</Text>
          <Text style={s.rowMeta}>{TODAY_TIMETABLE_SETUP_DETAIL}</Text>
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
                <View
                  style={[
                    s.timeRail,
                    ongoing ? s.timeRailOngoing : ended ? s.timeRailEnded : undefined,
                  ]}
                  accessibilityElementsHidden
                />
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
            <Text style={s.overflowNote}>還有 {classes.length - visible.length} 堂課，可在完整課表查看。</Text>
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
  onOpenCalendar,
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
  onOpenCalendar: () => void;
  onToggleExpanded: () => void;
  onRetry: () => void;
}) {
  const visible = expanded ? todos : todos.slice(0, 3);
  const extra = Math.max(0, todos.length - 3);
  const leaving = new Set(leavingIds);
  return (
    <View style={s.section}>
      <View style={s.sectionHeader}>
        <Text accessibilityRole="header" style={s.sectionTitle}>
          待處理
        </Text>
        {!unsigned && (
          <Pressable accessibilityRole="button" onPress={onOpenCalendar} style={s.textButton}>
            <Text style={s.link}>查看行事曆</Text>
          </Pressable>
        )}
      </View>
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
                  style={({ pressed }) => [s.row, s.todoBody, pressed && s.rowPressed]}
                >
                  <View
                    style={[
                      s.todoMarker,
                      overdue ? s.todoMarkerOverdue : soon ? s.todoMarkerSoon : undefined,
                    ]}
                    accessibilityElementsHidden
                  />
                  <View style={s.rowBody}>
                    <Text style={s.rowTitle}>{item.title}</Text>
                    {!!item.courseName && <Text style={s.rowMeta}>{item.courseName}</Text>}
                    <Text style={[s.rowMeta, overdue ? s.overdue : soon ? s.dueSoon : undefined]}>{due}</Text>
                  </View>
                </Pressable>
                {direct && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${direct.label}，${item.title}`}
                    onPress={() => onOpen(item, true)}
                    style={({ pressed }) => [s.inlineAction, pressed && s.rowPressed]}
                  >
                    <Text style={s.inlineActionText}>{direct.label}</Text>
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

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: {
      paddingHorizontal: 22,
      paddingTop: 18,
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      gap: 26,
    },
    dayHeader: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12,
      paddingBottom: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    dayTitleBlock: {
      flexShrink: 1,
      gap: 2,
    },
    studentCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    studentCardLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.text,
    },
    date: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    heading: {
      fontFamily: pageTitleFont,
      color: theme.colors.text,
      fontSize: 32,
      lineHeight: 40,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    updated: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },
    section: { gap: 6 },
    shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
    shortcut: {
      flexBasis: '46%', flexGrow: 1, minHeight: 64, minWidth: 0,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      padding: 12, borderRadius: 8, borderWidth: 1,
      borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    },
    reminder: {
      gap: 6,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.accent,
      backgroundColor: theme.colors.surface,
    },
    reminderTitle: {
      color: theme.colors.accent,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
    },
    reminderHeading: {
      color: theme.colors.text,
      fontSize: 17,
      lineHeight: 24,
      fontWeight: '700',
    },
    reminderReason: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      fontVariant: ['tabular-nums'],
    },
    reminderAction: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginTop: 6,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    reminderActionPressed: {
      backgroundColor: theme.colors.accentHover,
    },
    reminderActionText: {
      color: theme.colors.onAccent,
      fontSize: 14,
      fontWeight: '600',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    row: {
      minHeight: 68,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    timeColumn: {
      minWidth: 48,
      flexShrink: 0,
      gap: 2,
    },
    time: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 15,
      lineHeight: 21,
      fontVariant: ['tabular-nums'],
    },
    timeRail: {
      width: 3,
      alignSelf: 'stretch',
      borderRadius: 2,
      backgroundColor: theme.colors.border,
      marginVertical: 2,
    },
    timeRailOngoing: {
      backgroundColor: theme.colors.accent,
    },
    timeRailEnded: {
      backgroundColor: 'transparent',
    },
    classStatus: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '500',
    },
    ongoing: {
      color: theme.colors.accent,
      fontWeight: '600',
    },
    todoRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 10,
    },
    todoBody: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 160,
    },
    todoMarker: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
      marginTop: 2,
    },
    todoMarkerSoon: {
      backgroundColor: theme.colors.accent,
    },
    todoMarkerOverdue: {
      backgroundColor: theme.colors.danger,
    },
    inlineAction: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    inlineActionText: {
      color: theme.colors.accent,
      fontWeight: '600',
      fontSize: 13,
      lineHeight: 19,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '600',
    },
    rowMeta: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 19,
      fontVariant: ['tabular-nums'],
    },
    overflowNote: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 19,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    dueSoon: { color: theme.colors.accent, fontWeight: '600' },
    overdue: { color: theme.colors.danger, fontWeight: '600' },
    endedTitle: { color: theme.colors.muted },
    leaving: { opacity: 0 },
    more: {
      minHeight: 44,
      justifyContent: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    empty: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 22,
      paddingVertical: 10,
    },
    textButton: {
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    link: {
      color: theme.colors.accent,
      fontWeight: '600',
      fontSize: 13,
      lineHeight: 19,
    },
    skeletonHeading: {
      width: '32%',
      height: 18,
      borderRadius: 4,
      backgroundColor: theme.colors.surface2,
      marginBottom: 16,
    },
    skeletonLine: {
      height: 44,
      borderRadius: 4,
      backgroundColor: theme.colors.surface2,
      marginBottom: 12,
    },
    rowPressed: { backgroundColor: theme.colors.surfaceInteractive },
    pressed: { opacity: 0.65 },
  });
