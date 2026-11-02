import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { navigateFromInboxTask } from '../services/inboxActions';
import { hasTCSession } from '../services/tronClassClient';
import { useTodayTimetableData } from '../hooks/useTodayTimetableData';
import {
  formatClassMeta,
  formatClock,
  formatTodayHeaderDate,
  formatTodoDeadlineLabel,
  formatTodoDueLine,
  formatUpcomingDueLine,
  formatUpdatedAt,
  isDueWithinHours,
  isTodoOverdue,
  pickNextAction,
  sortTodayClasses,
  sortTodayTodos,
  TODAY_COPY,
  type NextAction,
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
  const schoolId = auth.profile?.schoolId;
  const scope = JSON.stringify([uid, schoolId, auth.profile?.role]);
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
          loadStudentHome(uid, schoolId),
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
      const stopClock = () => clearTimeout(timer);
      const tick = () => {
        stopClock();
        const instant = new Date();
        setNow(instant);
        if (active) timer = setTimeout(tick, 60_000 - (instant.getTime() % 60_000));
      };
      tick();
      const subscription = AppState.addEventListener('change', (state) => {
        active = state === 'active';
        if (active) tick();
        else stopClock();
      });
      const y = scrollY.current;
      const frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: false });
      });
      void load(true);
      return () => {
        stopClock();
        subscription.remove();
        cancelAnimationFrame(frame);
        generation.current += 1;
        refreshGeneration.current += 1;
      };
    }, [load]),
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

  const action = pickNextAction(classes, todos, now);
  const classRows = sortTodayClasses(classes, now);
  const todoRows = sortTodayTodos(todos) as TodoRow[];
  const todosExpanded = expandedTodoScope === scope;
  const firstLoad = unsigned
    ? timetableStatus === 'loading'
    : !updatedAt && (loading || timetableStatus === 'loading');
  const lmsUnconnected = !unsigned && !error && lmsConnected === false && todos.length === 0;

  const openCourse = (courseId?: string) => {
    if (courseId)
      safeNavigate(navigation, 'CourseHub', {
        courseSpaceId: courseId,
        groupId: courseId,
        section: 'week',
      });
    else rootNavigateNested('學習', 'PersonalTimetable', termKey ? { term: termKey } : undefined);
  };
  const openTodo = (row: TodoRow, scrollToSubmit = false) => {
    if (row.task) {
      // The task carries its real assignment / quiz ID and destination.
      // If opening fails, the navigation helper explains why; never invent a submit ID.
      navigateFromInboxTask(navigation, row.task, {
        role: auth.profile?.role,
        isTeachingRole: false,
        scrollToSubmit,
      });
      return;
    }
    if (row.courseId) {
      safeNavigate(navigation, 'CourseHub', {
        groupId: row.courseId,
        groupName: row.courseName,
      });
    }
  };
  const openWeek = () =>
    rootNavigateNested('學習', 'PersonalTimetable', termKey ? { term: termKey } : undefined);
  const openImport = () => rootNavigateNested('學習', 'PersonalImport', { kind: 'timetable' });
  const openQuickAction = (quick: MobileQuickAction) => {
    if (quick.destination === '/classroom' && todoRows.length === 1) {
      // Use the current user's real assignment or quiz, never fabricate a submit id.
      openTodo(todoRows[0], true);
      return;
    }
    safeNavigate(navigation, quick.route);
  };
  const refresh = async () => {
    setNow(new Date());
    const request = ++refreshGeneration.current;
    setRefreshState({ scope, request });
    await Promise.allSettled([load(true), retryTimetable()]);
    if (currentScope.current === scope && refreshGeneration.current === request) {
      setRefreshState(null);
    }
  };

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
        <View>
          <Text style={s.date}>{formatTodayHeaderDate(now)}</Text>
          <Text accessibilityRole="header" style={s.heading}>
            今天
          </Text>
          {updatedAt ? <Text style={s.updated}>{formatUpdatedAt(updatedAt)}</Text> : null}
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
              onOpenTodo={(todo) => openTodo(todo, true)}
              onOpenWeek={openWeek}
            />
            <QuickCampusEntry
              key={scope}
              uid={uid}
              schoolId={schoolId}
              onOpen={openQuickAction}
              onAsk={(question) => safeNavigate(navigation, 'AIChat', { prompt: question })}
            />
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
  onOpenClass: (courseId?: string) => void;
  onOpenTodo: (todo: TodoRow) => void;
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
  if (action.type === 'allDone' && action.todo) {
    const todo = action.todo as TodoRow;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpenTodo(todo)}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
        testID="next-action"
      >
        <Animated.View style={{ opacity: fade, flex: 1 }}>
          <Text style={s.kind}>{TODAY_COPY.allClassesDone}</Text>
          <Text style={s.headline}>{todo.title}</Text>
          <Text style={s.meta}>{formatTodoDueLine(todo, now)}</Text>
          <View style={s.cardButton}>
            <Text style={s.cardButtonText}>{TODAY_COPY.goSubmit}</Text>
          </View>
        </Animated.View>
      </Pressable>
    );
  }
  if (action.type === 'class') {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpenClass(action.class.courseId)}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
        testID="next-action"
      >
        <Animated.View style={{ opacity: fade, flex: 1 }}>
          <Text style={s.kind}>{TODAY_COPY.nextClass}</Text>
          <Text style={s.headline}>{action.class.title}</Text>
          <Text style={s.meta}>{formatClassMeta(action.class)}</Text>
          <View style={s.cardButton}>
            <Text style={s.cardButtonText}>{TODAY_COPY.viewCourse}</Text>
          </View>
        </Animated.View>
      </Pressable>
    );
  }
  if (action.type !== 'assignment' && action.type !== 'overdue' && action.type !== 'upcoming')
    return null;
  const todo = action.todo as TodoRow;
  const overdue = action.type === 'overdue';
  const kind = overdue
    ? TODAY_COPY.overdue
    : action.type === 'upcoming'
      ? TODAY_COPY.nextAssignment
      : formatTodoDeadlineLabel(todo, now);
  const meta =
    action.type === 'upcoming' ? formatUpcomingDueLine(todo, now) : formatTodoDueLine(todo, now);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenTodo(todo)}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
      testID="next-action"
    >
      <Animated.View style={{ opacity: fade, flex: 1 }}>
        <Text style={s.kind}>{kind}</Text>
        <Text style={s.headline}>{todo.title}</Text>
        <Text style={[s.meta, overdue ? s.metaDanger : null]}>{meta}</Text>
        <View style={s.cardButton}>
          <Text style={s.cardButtonText}>{TODAY_COPY.goSubmit}</Text>
        </View>
      </Animated.View>
    </Pressable>
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
  classes: ReturnType<typeof sortTodayClasses>;
  status: string;
  now: Date;
  styles: ReturnType<typeof createStyles>;
  onOpenClass: (courseId?: string) => void;
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
                onPress={() => onOpenClass(item.courseId)}
                style={({ pressed }) => [
                  s.row,
                  index > 0 && s.rowBorder,
                  ended && s.ended,
                  pressed && s.pressed,
                ]}
              >
                <Text style={s.time}>{formatClock(item.startAt)}</Text>
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{item.title}</Text>
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
  onOpen: (todo: TodoRow) => void;
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
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${item.courseName}`}
                onPress={() => onOpen(item)}
                style={({ pressed }) => [
                  s.row,
                  index > 0 && s.rowBorder,
                  leaving.has(item.id) && s.leaving,
                  pressed && s.pressed,
                ]}
              >
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>{item.title}</Text>
                  <Text style={[s.rowMeta, overdue ? s.overdue : soon ? s.dueSoon : null]}>
                    {item.courseName} · {formatTodoDueLine(item, now)}
                  </Text>
                </View>
              </Pressable>
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
    content: {
      paddingHorizontal: 20,
      paddingTop: 22,
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      gap: 28,
    },
    date: {
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 18,
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
      marginTop: 4,
    },
    card: {
      backgroundColor: BRAND,
      minHeight: 132,
      borderRadius: 16,
      padding: 20,
      shadowOpacity: 0,
    },
    cardLight: {
      backgroundColor: theme.mode === 'dark' ? theme.colors.surface2 : CREAM,
      minHeight: 132,
      borderRadius: 16,
      padding: 20,
    },
    kind: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18, fontWeight: '600' },
    headline: { color: '#FFFFFF', fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 6 },
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
      marginTop: 16,
      alignSelf: 'flex-end',
      height: 44,
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
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
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      textTransform: 'none',
    },
    list: {
      backgroundColor: theme.mode === 'dark' ? theme.colors.surface : CREAM,
      borderRadius: 12,
      overflow: 'hidden',
    },
    row: {
      minHeight: 56,
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    time: {
      width: 52,
      color: theme.colors.muted,
      fontSize: 13,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
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
    ended: { opacity: 0.48 },
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
