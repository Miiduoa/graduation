import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
  type NextAction,
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

  const action = pickNextAction(classes, todos, now);
  const classRows = sortTodayClasses(classes, now);
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
      todos={todos}
      showUrgentAction={action.type === 'class'}
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
    <SafeAreaView style={s.page} edges={['top']}>
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
            <NextActionCard
              action={action}
              unsigned={unsigned}
              todosError={error}
              timetableReady={timetableStatus === 'ready'}
              now={now}
              styles={s}
              onOpenClass={openCourse}
              onOpenTodo={openTodo}
              onOpenWeek={openWeek}
            />
            <QuickCampusEntry
              key={scope}
              uid={uid}
              schoolId={schoolId}
              onOpen={openQuickAction}
              onOpenAssistantRoute={(route) => safeNavigate(navigation, route)}
            />
            {urgentWorkFirst && todoSection}
            {scheduleSection}
            {!urgentWorkFirst && todoSection}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TodaySkeleton({ styles: s }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View accessibilityState={{ busy: true }} testID="today-skeleton">
      <View style={s.skeletonCard} />
      <View style={s.skeletonLine} />
      <View style={s.skeletonLine} />
      <View style={s.skeletonLine} />
    </View>
  );
}

function NextActionCard({
  action,
  unsigned,
  todosError,
  timetableReady,
  now,
  styles: s,
  onOpenClass,
  onOpenTodo,
  onOpenWeek,
}: {
  action: NextAction;
  unsigned: boolean;
  todosError: boolean;
  timetableReady: boolean;
  now: Date;
  styles: ReturnType<typeof createStyles>;
  onOpenClass: (item: TodayClass & { courseWorkNav?: TimetableClassroomDestination; courseCode?: string }) => void;
  onOpenTodo: (todo: TodoRow, scrollToSubmit?: boolean) => void;
  onOpenWeek: () => void;
}) {
  const fade = useRef(new Animated.Value(1)).current;
  const key =
    unsigned && action.type !== 'class'
      ? 'unsigned'
      : action.type === 'class'
        ? `class:${action.class.id}`
        : action.type === 'assignment'
          ? `todo:${action.todo.id}`
          : action.type === 'upcoming'
            ? `upcoming:${action.todo.id}`
            : action.type === 'overdue'
              ? `overdue:${action.todo.id}`
              : action.type === 'allDone'
                ? `done:${action.todo?.id ?? ''}`
                : 'empty';
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current === key) return;
    const from = prev.current;
    prev.current = key;
    const content = (value: string) =>
      value.startsWith('class:') ||
      value.startsWith('todo:') ||
      value.startsWith('upcoming:') ||
      value.startsWith('overdue:') ||
      value.startsWith('done:');
    if (!content(from) || !content(key)) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const anim = Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [fade, key]);

  if (unsigned && action.type !== 'class') {
    return (
      <Animated.View style={[s.cardLight, { opacity: fade }]} testID="next-action">
        <Text style={s.lightHeadline}>{TODAY_COPY.unsigned}</Text>
      </Animated.View>
    );
  }
  if (action.type === 'empty') {
    if (todosError || !timetableReady) return null;
    return (
      <Animated.View style={[s.cardLight, { opacity: fade }]} testID="next-action">
        <Text style={s.lightHeadline}>{TODAY_COPY.emptyDay}</Text>
        <Pressable accessibilityRole="button" onPress={onOpenWeek} style={s.lightButton}>
          <Text style={s.lightButtonText}>{TODAY_COPY.viewWeek}</Text>
        </Pressable>
      </Animated.View>
    );
  }
  if (action.type === 'allDone' && !action.todo) {
    return (
      <Animated.View style={[s.cardLight, { opacity: fade }]} testID="next-action">
        <Text style={s.lightHeadline}>{TODAY_COPY.allClassesDone}</Text>
      </Animated.View>
    );
  }
  if (action.type === 'class') {
    const ongoing = action.class.startAt <= now.getTime() && action.class.endAt > now.getTime();
    const classTime = `${formatClock(action.class.startAt)}–${formatClock(action.class.endAt)}`;
    const classCta = action.class.courseId ? TODAY_COPY.viewCourse : TODAY_COPY.findCourse;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpenClass(action.class)}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
        testID="next-action"
      >
        <Animated.View style={{ opacity: fade, flex: 1 }}>
          <View style={s.focusLine}>
            <Text style={s.kind}>{ongoing ? '上課中' : TODAY_COPY.nextClass}</Text>
            <Text style={s.cardLink}>{classCta}</Text>
          </View>
          <Text style={s.headline}>{action.class.title}</Text>
          <Text style={s.meta}>{[classTime, action.class.location.trim()].filter(Boolean).join(' · ')}</Text>
        </Animated.View>
      </Pressable>
    );
  }
  const todo = action.todo as TodoRow;
  const kind = {
    allDone: TODAY_COPY.allClassesDone,
    assignment: todo.dueAt !== null && !isSameTaipeiDay(todo.dueAt, now.getTime())
      ? '明天截止'
      : TODAY_COPY.dueToday,
    overdue: TODAY_COPY.overdue,
    upcoming: todo.task?.kind === 'quiz' ? '下一個測驗' : TODAY_COPY.nextAssignment,
  }[action.type];
  const meta =
    action.type === 'upcoming' ? formatUpcomingDueLine(todo) : formatTodoDueLine(todo, now);
  const courseAction = todo.courseId?.trim() ? TODAY_COPY.viewCourse : TODAY_COPY.findCourse;
  const workAction = todo.task && resolveInboxAction(todo.task);
  return (
    <View style={s.workLayout}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${kind}，${todo.title}，${todo.courseName}，${meta}，${courseAction}`}
        onPress={() => onOpenTodo(todo)}
        style={({ pressed }) => [s.workDetails, pressed && s.pressed]}
        testID="next-action"
      >
        <Animated.View style={{ opacity: fade }}>
          <View style={s.focusLine}>
            <Text style={s.kind}>{kind}</Text>
            <Text style={s.cardLink}>{courseAction}</Text>
          </View>
          <Text style={s.headline}>{todo.title}</Text>
          {!!todo.courseName && <Text style={s.courseName}>{todo.courseName}</Text>}
          <Text style={[s.meta, action.type === 'overdue' && s.metaDanger]}>{meta}</Text>
        </Animated.View>
      </Pressable>
      {workAction && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenTodo(todo, true)}
          style={({ pressed }) => [s.cardButton, pressed && s.pressed]}
        >
          <Animated.Text style={[s.cardButtonText, { opacity: fade }]}>{workAction.label}</Animated.Text>
        </Pressable>
      )}
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
  const extra = classes.length > 4;
  return (
    <View style={s.section}>
      <Text accessibilityRole="header" style={s.sectionTitle}>
        今天課表
      </Text>
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
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onOpenClass(item)}
                style={({ pressed }) => [
                  s.row,
                  index > 0 && s.rowBorder,
                  pressed && s.pressed,
                ]}
              >
                <View style={s.timeColumn}>
                  <Text style={s.time}>{formatClock(item.startAt)}</Text>
                  <Text style={s.rowMeta}>{ended ? '已結束' : formatClock(item.endAt)}</Text>
                </View>
                <View style={s.rowBody}>
                  <Text style={[s.rowTitle, ended && s.endedTitle]}>{item.title}</Text>
                  <Text style={s.rowMeta}>{item.location || '教室未填'}</Text>
                </View>
              </Pressable>
            );
          })}
          {extra ? (
            <Pressable accessibilityRole="button" onPress={onOpenTimetable} style={s.more}>
              <Text style={s.link}>{TODAY_COPY.viewFullTimetable}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function TodoList({
  todos,
  showUrgentAction,
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
  showUrgentAction: boolean;
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
            const due = formatTodoDueLine(item, now);
            const direct = showUrgentAction && index === 0 && item.task && isDueWithinHours(item, now, 24)
              ? resolveInboxAction(item.task) : null;
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
                    <Text style={s.rowMeta}>
                      {item.courseName ? item.courseName + ' · ' : ''}
                      <Text style={overdue ? s.overdue : soon ? s.dueSoon : undefined}>{due}</Text>
                    </Text>
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

const CREAM = '#FFFDF8';
const BRAND = '#314D40';

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    dayHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    dateBlock: { flexShrink: 1, alignItems: 'flex-end' },
    content: {
      paddingHorizontal: 20,
      paddingTop: 22,
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      gap: 20,
    },
    studentCard: {
      flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14,
      borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface,
    },
    studentCardLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
    date: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    heading: {
      color: theme.colors.text,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
    },
    updated: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
    card: {
      backgroundColor: BRAND,
      borderRadius: 14,
      padding: 18,
    },
    focusLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    cardLink: { color: CREAM, fontSize: 13, lineHeight: 18, fontWeight: '600', textDecorationLine: 'underline' },
    workLayout: { backgroundColor: BRAND, borderRadius: 14, overflow: 'hidden' },
    workDetails: { padding: 18 },
    courseName: { color: CREAM, fontSize: 14, lineHeight: 21 },
    cardLight: {
      backgroundColor: theme.mode === 'dark' ? theme.colors.surface2 : CREAM,
      minHeight: 64,
      borderRadius: 14,
      padding: 18,
    },
    kind: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18, fontWeight: '600' },
    headline: { color: '#FFFFFF', fontSize: 24, lineHeight: 31, fontWeight: '700', marginTop: 8 },
    lightHeadline: {
      color: theme.colors.text,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '700',
    },
    meta: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 13,
      lineHeight: 18,
      marginTop: 6,
      fontVariant: ['tabular-nums'],
    },
    cardButton: {
      alignSelf: 'flex-start',
      marginHorizontal: 18,
      marginBottom: 14,
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 9,
      backgroundColor: CREAM,
      justifyContent: 'center',
    },
    cardButtonText: { color: BRAND, fontSize: 15, fontWeight: '700' },
    lightButton: {
      marginTop: 16,
      alignSelf: 'flex-end',
      height: 44,
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: BRAND,
      justifyContent: 'center',
    },
    lightButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    section: { gap: 8 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '700',
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    row: {
      minHeight: 56,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    timeColumn: { minWidth: 54, flexShrink: 0, gap: 2 },
    time: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 13,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
    todoRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10 },
    todoBody: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
    inlineAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
    rowMeta: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
    dueSoon: { color: theme.colors.accent, fontWeight: '700' },
    overdue: { color: theme.colors.danger, fontWeight: '700' },
    metaDanger: { color: '#FFD9D0', fontWeight: '700' },
    endedTitle: { color: theme.colors.muted },
    leaving: { opacity: 0 },
    more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
    empty: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
    textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { color: theme.colors.accent, fontWeight: '600', fontSize: 13, lineHeight: 18 },
    skeletonCard: {
      height: 132,
      borderRadius: 16,
      backgroundColor: theme.colors.surface2,
      marginBottom: 12,
    },
    skeletonLine: {
      height: 16,
      borderRadius: 8,
      backgroundColor: theme.colors.surface2,
      marginBottom: 10,
    },
    pressed: { opacity: 0.86 },
  });
