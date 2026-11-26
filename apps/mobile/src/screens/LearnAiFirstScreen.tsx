import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { STUDENT_ACADEMIC_SECTIONS } from '@campus/shared/src/academicSections';
import { AIScreen } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { navigateFromInboxTask } from '../services/inboxActions';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { SchoolLearningLinks } from '../components/SchoolLearningLinks';
import { LearningNextClassCard } from '../components/LearningNextClassCard';
import { buildLearningWorkspace, describeLearningTask, filterLearningTasks, type LearningTaskFilter } from '../features/learningWorkspace';

const STUDENT_SECTION_SUBTITLE: Record<(typeof STUDENT_ACADEMIC_SECTIONS)[number]['id'], string> = {
  timetable: '一週、單日、匯入與空堂',
  coursework: '本頁課程、作業與待辦',
  grades: '學期成績與課程回饋',
  credits: '依修課資料檢查畢業條件',
  calendar: '學校行事曆與自己的安排',
};

type LearningData = Awaited<ReturnType<typeof loadStudentHome>>;

type RowTone = 'ai' | 'success' | 'warning' | 'danger' | 'muted';

function toneColor(tone: RowTone | undefined): string {
  if (tone === 'ai') return theme.colors.accent;
  if (tone === 'success') return theme.colors.success;
  if (tone === 'warning') return theme.colors.warning;
  if (tone === 'danger') return theme.colors.danger;
  return theme.colors.textSecondary;
}

/** Hairline list row: status line, bold title, readable metadata, optional chevron. */
function LearnRow(props: {
  title: string;
  subtitle?: string;
  status?: string;
  tone?: RowTone;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { styles: s } = props;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <View style={s.rowCopy}>
        {props.status ? (
          <Text style={[s.rowStatus, { color: toneColor(props.tone) }]}>{props.status}</Text>
        ) : null}
        <Text style={s.rowTitle}>{props.title}</Text>
        {props.subtitle ? <Text style={s.rowMeta}>{props.subtitle}</Text> : null}
      </View>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={s.chevron}
      >
        ›
      </Text>
    </Pressable>
  );
}

/** Text tab: bold label, underline marks the active item. */
function LearnTab(props: {
  label: string;
  active: boolean;
  role: 'tab' | 'button';
  hint?: string;
  accessibilityLabel?: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { styles: s } = props;
  return (
    <Pressable
      accessibilityRole={props.role}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.hint}
      accessibilityState={{ selected: props.active }}
      onPress={props.onPress}
      style={({ pressed }) => [s.tab, props.active && s.tabActive, pressed && s.pressed]}
    >
      <Text style={[s.tabLabel, props.active && s.tabLabelActive]}>{props.label}</Text>
    </Pressable>
  );
}

export default function LearnAiFirstScreen() {
  const s = useThemeStyleSheet(createStyles);
  const navigation = useNavigation();
  const auth = useAuth();
  const uid = auth.user?.uid;
  const schoolId = auth.profile?.uid === uid ? auth.profile?.schoolId : undefined;
  const scope = JSON.stringify([uid, schoolId, auth.profile?.role]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const [filter, setFilter] = useState<LearningTaskFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    setFilter('all');
    setQuery('');
    setSelectedCourse('');
    setVisibleCount(20);
  }, [scope]);
  useEffect(() => {
    setVisibleCount(20);
  }, [filter, query, selectedCourse]);
  const [state, setState] = useState<{
    scope: string;
    data: LearningData | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const workspace = useMemo(
    () => visible?.data ? buildLearningWorkspace(visible.data.courses, visible.data.tasks, clock) : null,
    [visible?.data, clock],
  );
  const selectedGroupId = workspace?.courses.some((course) => course.groupId === selectedCourse)
    ? selectedCourse : '';
  const filteredTasks = useMemo(
    () => workspace
      ? filterLearningTasks(workspace.tasks, filter, clock, { query, groupId: selectedGroupId })
      : [],
    [workspace, filter, clock, query, selectedGroupId],
  );

  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, data: null, loading: true, error: null });
    try {
      if (!uid || !schoolId) throw new Error('missing-session');
      const data = await loadStudentHome(uid, schoolId, 'learning');
      const courseIds = new Set(data.courses.map((course) => course.groupId));
      const tasks = data.tasks.filter(
        (task) => task.kind !== 'assistant_queue' && courseIds.has(task.groupId),
      );
      if (generation.current === request && currentScope.current === scope) {
        setState({ scope, data: { courses: data.courses, tasks }, loading: false, error: null });
      }
    } catch {
      if (generation.current === request && currentScope.current === scope) {
        setState({
          scope,
          data: null,
          loading: false,
          error: '無法讀取課程與待辦，請確認登入狀態與網路後重試。',
        });
      }
    }
  }, [uid, schoolId, scope]);

  useFocusEffect(
    useCallback(() => {
      void load();
      setClock(new Date());
      const ticker = setInterval(() => setClock(new Date()), 60_000);
      return () => {
        generation.current += 1;
        clearInterval(ticker);
      };
    }, [load]),
  );

  const openTask = (task: InboxTask) => {
    const courseRole = workspace?.courses.find((course) => course.groupId === task.groupId)?.role;
    const isTeachingRole =
      courseRole === 'owner' || courseRole === 'instructor' || courseRole === 'moderator';
    if (
      navigateFromInboxTask(navigation, task, {
        role: auth.profile?.role,
        isTeachingRole,
      })
    ) {
      return;
    }
    safeNavigate(navigation, 'CourseHub', {
      groupId: task.groupId,
      groupName: task.groupName,
    });
  };

  const typeFilters: Array<[LearningTaskFilter, string]> = [
    ['all', '全部'],
    ['week', '7 天內'],
    ['assignment', '作業'],
    ['quiz', '測驗'],
    ['live', '點名'],
  ];
  const courseFilters = workspace
    ? [
        { id: '', name: '所有課程' },
        ...workspace.courses.map((course) => ({ id: course.groupId, name: '只看：' + course.name })),
      ]
    : [];

  return (
    <AIScreen
      refreshControl={
        <RefreshControl
          refreshing={visible?.loading ?? false}
          onRefresh={() => void load()}
          tintColor={theme.colors.accent}
        />
      }
    >
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>
          課務
        </Text>
        {workspace ? (
          <Text style={s.summary} accessibilityLabel="課務進度摘要">
            {workspace.courses.length + ' 門課程 · ' + workspace.upcomingCount + ' 項 7 天內到期 · '}
            <Text style={workspace.overdueCount > 0 ? s.summaryAlert : undefined}>
              {workspace.overdueCount + ' 項逾期可補交'}
            </Text>
          </Text>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabs}
        contentContainerStyle={s.tabsContent}
        accessibilityRole="tablist"
      >
        {STUDENT_ACADEMIC_SECTIONS.map((section) => (
          <LearnTab
            key={section.id}
            role="tab"
            label={section.label}
            accessibilityLabel={section.label}
            hint={STUDENT_SECTION_SUBTITLE[section.id]}
            active={section.id === 'coursework'}
            onPress={() => {
              if (section.id !== 'coursework') safeNavigate(navigation, section.mobileScreen);
            }}
            styles={s}
          />
        ))}
      </ScrollView>

      <LearningNextClassCard
        onOpenTimetable={() => safeNavigate(navigation, 'PersonalTimetable')}
        onImportTimetable={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
      />

      {!visible || visible.loading ? (
        <ActivityIndicator accessibilityLabel="讀取課程" color={theme.colors.accent} style={s.spinner} />
      ) : visible.error ? (
        <View accessibilityRole="alert" style={s.errorBlock}>
          <Text style={s.errorText}>{visible.error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [s.primaryAction, pressed && s.pressed]}
          >
            <Text style={s.primaryActionText}>重新讀取</Text>
          </Pressable>
        </View>
      ) : visible.data && workspace ? (
        <>
          <View style={s.filters}>
            <TextInput
              accessibilityLabel="搜尋課務"
              placeholder="搜尋作業、測驗或課程"
              placeholderTextColor={theme.colors.muted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
              style={s.search}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.subTabs}
            contentContainerStyle={s.tabsContent}
            accessibilityLabel="依課程篩選"
          >
            {courseFilters.map((course) => (
              <LearnTab
                key={course.id || 'all-courses'}
                role="button"
                label={course.name}
                active={selectedGroupId === course.id}
                onPress={() => setSelectedCourse(course.id)}
                styles={s}
              />
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.subTabs}
            contentContainerStyle={s.tabsContent}
            accessibilityLabel="篩選近期課務"
          >
            {typeFilters.map(([key, label]) => (
              <LearnTab
                key={key}
                role="button"
                label={label}
                active={filter === key}
                onPress={() => setFilter(key)}
                styles={s}
              />
            ))}
          </ScrollView>

          <View style={s.section}>
            <Text accessibilityRole="header" style={s.sectionTitle}>
              近期課務
            </Text>
            <Text style={s.sectionMeta}>
              {'目前符合條件：' + filteredTasks.length + ' 項 · 依優先處理順序排列'}
            </Text>
            {filteredTasks.length ? (
              filteredTasks.slice(0, visibleCount).map((task) => {
                const status = describeLearningTask(task, clock);
                return (
                  <LearnRow
                    key={task.id + ':' + task.groupId}
                    title={task.title}
                    subtitle={task.groupName + (task.subtitle ? ' · ' + task.subtitle : '')}
                    status={status.label}
                    tone={status.tone}
                    onPress={() => openTask(task)}
                    styles={s}
                  />
                );
              })
            ) : (
              <Text style={s.empty}>
                {filter === 'all' && !query && !selectedGroupId
                  ? '已載入的課程目前沒有待處理的事項。'
                  : '目前沒有符合條件的課務，請調整搜尋或篩選。'}
              </Text>
            )}
            {visibleCount < filteredTasks.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setVisibleCount((count) => count + 20)}
                style={({ pressed }) => [s.moreAction, pressed && s.pressed]}
              >
                <Text style={s.moreActionText}>
                  {'顯示更多（尚有 ' + (filteredTasks.length - visibleCount) + ' 項）'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={s.section}>
            <Text accessibilityRole="header" style={s.sectionTitle}>
              課程與作業
            </Text>
            {visible.data.courses.length ? (
              visible.data.courses.map((course) => {
                const counts =
                  [
                    course.assignmentCount > 0 ? String(course.assignmentCount) + ' 份作業' : null,
                    course.quizCount > 0 ? String(course.quizCount) + ' 項測驗' : null,
                    course.unreadCount > 0 ? String(course.unreadCount) + ' 則未讀' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '開啟課程查看最新教材與內容';
                return (
                  <View key={course.groupId} style={s.course}>
                    <Text style={s.rowTitle}>{course.name}</Text>
                    <Text style={s.rowMeta}>{counts}</Text>
                    <View style={s.courseActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={course.name + '，教材'}
                        onPress={() =>
                          safeNavigate(navigation, 'CourseHub', {
                            groupId: course.groupId,
                            groupName: course.name,
                          })
                        }
                        style={({ pressed }) => [s.actionPrimary, pressed && s.pressed]}
                      >
                        <Text style={s.actionPrimaryText}>教材</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={course.name + '，課程動態'}
                        onPress={() =>
                          safeNavigate(navigation, 'GroupDetail', { groupId: course.groupId })
                        }
                        style={({ pressed }) => [s.actionSecondary, pressed && s.pressed]}
                      >
                        <Text style={s.actionSecondaryText}>課程動態</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={course.name + '，課程成績'}
                        onPress={() =>
                          safeNavigate(navigation, 'CourseGradebook', {
                            groupId: course.groupId,
                            groupName: course.name,
                            sourceSystem: 'workspace',
                          })
                        }
                        style={({ pressed }) => [s.actionSecondary, pressed && s.pressed]}
                      >
                        <Text style={s.actionSecondaryText}>課程成績</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={s.empty}>尚未加入課程。若已選課，請向授課教師確認成員名單。</Text>
            )}
          </View>
        </>
      ) : null}

      <View style={s.section}>
        <Text accessibilityRole="header" style={s.sectionTitle}>
          其他入口
        </Text>
        <LearnRow
          title="TronClass 課程與作業"
          subtitle="獨立連接校方帳號，查看課務、準備與核對作業"
          onPress={() => safeNavigate(navigation, 'TronClassWorkspace')}
          styles={s}
        />
        <LearnRow
          title="匯入我的資料"
          subtitle="截圖、文字、檔案；課表、成績與行事曆"
          onPress={() => safeNavigate(navigation, 'PersonalImport')}
          styles={s}
        />
        <LearnRow
          title="課程申訴"
          subtitle="看申訴處理到哪"
          onPress={() => safeNavigate(navigation, 'CourseAppeals')}
          styles={s}
        />
        <LearnRow
          title="課綱查詢"
          subtitle="搜尋課程內容與授課資訊"
          onPress={() => safeNavigate(navigation, 'CourseCatalog')}
          styles={s}
        />
        {schoolId ? (
          <View style={s.platform}>
            <Text style={s.platformTitle}>本校教學平台</Text>
            <SchoolLearningLinks key={scope} schoolId={schoolId} />
          </View>
        ) : null}
      </View>
    </AIScreen>
  );
}

const createStyles = () => {
  const pad = theme.layout.screenHorizontalPadding;
  const hairline = StyleSheet.hairlineWidth;
  return StyleSheet.create({
    header: { paddingHorizontal: pad, paddingTop: 20, paddingBottom: 6 },
    title: {
      color: theme.colors.text,
      fontSize: 30,
      lineHeight: 38,
      fontWeight: '800',
      letterSpacing: 0,
    },
    summary: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 4,
    },
    summaryAlert: { color: theme.colors.danger, fontWeight: '700' },
    tabs: {
      flexGrow: 0,
      borderBottomWidth: hairline,
      borderBottomColor: theme.colors.border,
    },
    subTabs: { flexGrow: 0, marginTop: 4 },
    tabsContent: { paddingHorizontal: pad - 12, gap: 4 },
    tab: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderBottomWidth: 3,
      borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: theme.colors.accent },
    tabLabel: {
      color: theme.colors.textSecondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '500',
    },
    tabLabelActive: { color: theme.colors.text, fontWeight: '800' },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
    spinner: { marginVertical: 32 },
    filters: { paddingHorizontal: pad, paddingTop: 16 },
    search: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      fontSize: 15,
    },
    section: { paddingHorizontal: pad, marginTop: 28 },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '800',
    },
    sectionMeta: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 2,
      marginBottom: 4,
    },
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: hairline,
      borderBottomColor: theme.colors.border,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    rowStatus: { fontSize: 12, lineHeight: 17, fontWeight: '700', marginBottom: 2 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '700',
    },
    rowMeta: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 2,
    },
    chevron: { color: theme.colors.muted, fontSize: 22, lineHeight: 26 },
    empty: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 22,
      paddingVertical: 14,
    },
    moreAction: { minHeight: 48, justifyContent: 'center' },
    moreActionText: { color: theme.colors.accent, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    course: {
      paddingTop: 14,
      borderBottomWidth: hairline,
      borderBottomColor: theme.colors.border,
    },
    courseActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      marginLeft: -12,
      marginTop: 4,
    },
    actionPrimary: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
    actionPrimaryText: {
      color: theme.colors.accent,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '800',
    },
    actionSecondary: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
    actionSecondaryText: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '600',
    },
    errorBlock: {
      marginHorizontal: pad,
      marginTop: 20,
      paddingLeft: 12,
      paddingVertical: 4,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
      gap: 8,
    },
    errorText: { color: theme.colors.text, fontSize: 14, lineHeight: 22 },
    primaryAction: {
      alignSelf: 'flex-start',
      minHeight: 44,
      paddingHorizontal: 18,
      justifyContent: 'center',
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.accent,
    },
    primaryActionText: {
      color: theme.colors.onAccent,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
    },
    platform: { marginTop: 20, gap: 4 },
    platformTitle: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '700',
    },
  });
};
