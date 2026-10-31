import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIScreen, AIHero, AISection, AICard, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { rootNavigateMeScreen } from '../app/rootNavigation';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { navigateFromInboxTask } from '../services/inboxActions';
import { theme } from '../ui/theme';
import { LearningNextClassCard } from '../components/LearningNextClassCard';
import { buildLearningWorkspace, describeLearningTask, filterLearningTasks, type LearningTaskFilter } from '../features/learningWorkspace';

type LearningData = Awaited<ReturnType<typeof loadStudentHome>>;

export default function LearnAiFirstScreen() {
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

  return (
    <AIScreen refreshControl={<RefreshControl refreshing={visible?.loading ?? false} onRefresh={() => void load()} tintColor={theme.colors.accent} />}>
      <AIHero
        eyebrow="CAMPUS ONE"
        title="課務"
        subtitle="先看自己的課表，再處理這堂課要做的事。"
      />
      <AISection title="課程空間">
        <AIRow
          title="LMS 課程"
          subtitle="教材、作業與測驗 · Google 帳號"
          onPress={() => rootNavigateMeScreen('NuniWorkspace', { tab: 'courses' })}
        />
      </AISection>
      {workspace ? (
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 14, gap: 8 }} accessibilityLabel="課務進度摘要">
          {[
            { value: workspace.courses.length, label: '我的課程' },
            { value: workspace.upcomingCount, label: '7 天內到期' },
            { value: workspace.overdueCount, label: '逾期可補交' },
          ].map((metric) => (
            <View
              key={metric.label}
              style={{
                flex: 1,
                backgroundColor: aiTokens.surface,
                paddingVertical: 15,
                paddingHorizontal: 10,
                borderRadius: 12,
                borderColor: aiTokens.border,
                borderWidth: 0.5,
              }}
            >
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: '700',
                  color: metric.label === '逾期可補交' && metric.value > 0 ? aiTokens.danger : aiTokens.text,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {metric.value}
              </Text>
              <Text style={{ color: aiTokens.muted, fontSize: 12, marginTop: 4 }}>{metric.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <LearningNextClassCard
        onOpenTimetable={() => safeNavigate(navigation, 'PersonalTimetable')}
        onImportTimetable={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
      />

      {!visible || visible.loading ? (
        <ActivityIndicator accessibilityLabel="讀取課程" color={aiTokens.ai} />
      ) : visible.error ? (
        <AISection title="課程資料">
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>{visible.error}</Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        </AISection>
      ) : visible.data && workspace ? (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            <TextInput
              accessibilityLabel="搜尋課務"
              placeholder="搜尋作業、測驗或課程"
              placeholderTextColor={theme.colors.muted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                borderColor: theme.colors.border,
                borderWidth: 1,
                paddingHorizontal: 16,
                minHeight: 48,
                color: theme.colors.text,
                fontSize: 15,
              }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 12 }}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
              accessibilityLabel="依課程篩選"
            >
              {[
                { id: '', name: '所有課程' },
                ...workspace.courses.map((course) => ({
                  id: course.groupId, name: '只看：' + course.name,
                })),
              ].map((course) => {
                const selected = selectedGroupId === course.id;
                return (
                  <Pressable
                    key={course.id || 'all-courses'}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setSelectedCourse(course.id)}
                    style={{
                      minHeight: 40,
                      paddingHorizontal: 14,
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                      backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface,
                      borderRadius: 20,
                    }}
                  >
                    <Text style={{
                      color: selected ? theme.colors.accent : theme.colors.textSecondary,
                      fontSize: 13,
                      fontWeight: selected ? '700' : '500',
                    }}>
                      {course.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 }} accessibilityLabel="篩選近期課務">
            {([
              ['all', '全部'],
              ['week', '7 天內'],
              ['assignment', '作業'],
              ['quiz', '測驗'],
              ['live', '點名'],
            ] as Array<[LearningTaskFilter, string]>).map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === key }}
                onPress={() => setFilter(key)}
                style={{
                  minHeight: 40,
                  borderRadius: 24,
                  borderWidth: 0.5,
                  borderColor: filter === key ? aiTokens.ai : aiTokens.border,
                  backgroundColor: filter === key ? aiTokens.ai : aiTokens.surface,
                  paddingHorizontal: 16,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: filter === key ? theme.colors.onAccent : aiTokens.text, fontSize: 13, fontWeight: '600' }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <AISection
            title="近期課務"
            subtitle={'目前符合條件：' + filteredTasks.length + ' 項 · 依優先處理順序排列'}
          >
            {filteredTasks.length
              ? filteredTasks.slice(0, visibleCount).map((task) => {
                  const status = describeLearningTask(task, clock);
                  return (
                    <AIRow
                      key={task.id + ':' + task.groupId}
                      title={task.title}
                      subtitle={task.groupName + (task.subtitle ? ' · ' + task.subtitle : '')}
                      tag={status.label}
                      tagTone={status.tone}
                      onPress={() => openTask(task)}
                    />
                  );
                })
              : (
                <Text style={{ color: aiTokens.muted, padding: 16 }}>
                  {filter === 'all' && !query && !selectedGroupId
                    ? '已載入的課程目前沒有待處理的事項。'
                    : '目前沒有符合條件的課務，請調整搜尋或篩選。'}
                </Text>
              )}
            {visibleCount < filteredTasks.length ? (
              <View style={{ padding: 12 }}>
                <AIButton
                  label={'顯示更多（尚有 ' + (filteredTasks.length - visibleCount) + ' 項）'}
                  variant="ghost"
                  onPress={() => setVisibleCount((count) => count + 20)}
                />
              </View>
            ) : null}
          </AISection>
          <AISection title="我的課程">
            {visible.data.courses.length ? (
              visible.data.courses.map((course) => (
                <AICard key={course.groupId} title={course.name}>
                  <Text style={{ color: aiTokens.muted, fontSize: 13, marginBottom: 9 }}>
                    {[
                      course.assignmentCount > 0 ? String(course.assignmentCount) + ' 份作業' : null,
                      course.quizCount > 0 ? String(course.quizCount) + ' 項測驗' : null,
                      course.unreadCount > 0 ? String(course.unreadCount) + ' 則未讀' : null,
                    ].filter(Boolean).join(' · ') || '開啟課程查看最新教材與內容'}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <AIButton
                      label="教材"
                      onPress={() =>
                        safeNavigate(navigation, 'CourseHub', {
                          groupId: course.groupId,
                          groupName: course.name,
                        })
                      }
                    />
                    <AIButton
                      label="課程動態"
                      variant="ghost"
                      onPress={() =>
                        safeNavigate(navigation, 'GroupDetail', { groupId: course.groupId })
                      }
                    />
                    <AIButton
                      label="課程成績"
                      variant="ghost"
                      onPress={() =>
                        safeNavigate(navigation, 'CourseGradebook', {
                          groupId: course.groupId,
                          groupName: course.name,
                          sourceSystem: 'workspace',
                        })
                      }
                    />
                  </View>
                </AICard>
              ))
            ) : (
              <Text style={{ color: aiTokens.muted, padding: 16 }}>
                尚未加入課程。若已選課，請向授課教師確認成員名單。
              </Text>
            )}
          </AISection>
        </>
      ) : null}
      <AISection title="常用工具">
        <AIRow title="匯入我的資料" subtitle="截圖、文字、檔案；課表、成績與行事曆" onPress={() => safeNavigate(navigation, 'PersonalImport')} />
        <AIRow
          title="我的課表"
          subtitle="一週、單日、匯入與空堂"
          onPress={() => safeNavigate(navigation, 'PersonalTimetable')}
        />
        <AIRow
          title="行事曆"
          subtitle="學校行事曆與自己的安排"
          onPress={() => safeNavigate(navigation, 'Calendar')}
        />
        <AIRow
          title="課程申訴"
          subtitle="看申訴處理到哪"
          onPress={() => safeNavigate(navigation, 'CourseAppeals')}
        />
        <AIRow
          title="課綱查詢"
          subtitle="搜尋課程內容與授課資訊"
          onPress={() => safeNavigate(navigation, 'CourseCatalog')}
        />
      </AISection>
    </AIScreen>
  );
}
