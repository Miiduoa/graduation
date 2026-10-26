import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIScreen, AIHero, AISection, AICard, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';
import { navigateFromInboxTask } from '../services/inboxActions';
import { theme } from '../ui/theme';
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
  const [state, setState] = useState<{
    scope: string;
    data: LearningData | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const workspace = useMemo(() => visible?.data ? buildLearningWorkspace(visible.data.courses, visible.data.tasks) : null, [visible?.data]);
  const filteredTasks = useMemo(() => workspace ? filterLearningTasks(workspace.tasks, filter) : [], [workspace, filter]);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, data: null, loading: true, error: null });
    try {
      if (!uid || !schoolId) throw new Error('missing-session');
      const data = await loadStudentHome(uid, schoolId);
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
      return () => {
        generation.current += 1;
      };
    }, [load]),
  );

  const openTask = (task: InboxTask) => {
    if (
      navigateFromInboxTask(navigation, task, {
        role: auth.profile?.role,
        isTeachingRole: false,
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
    <AIScreen>
      <AIHero
        eyebrow="CAMPUS ONE"
        title="課務"
        subtitle="先看自己的課表，再處理這堂課要做的事。"
      />
      {workspace ? (
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginTop: 14, gap: 8 }} accessibilityLabel="課務進度摘要">
          {[
            { value: workspace.courses.length, label: '我的課程' },
            { value: workspace.upcomingCount, label: '7 天內到期' },
            { value: workspace.overdueCount, label: '已逾期' },
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
                  color: metric.label === '已逾期' && metric.value > 0 ? aiTokens.danger : aiTokens.text,
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 16 }} accessibilityLabel="篩選近期課務">
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
          <AISection title="近期課務" subtitle="依截止時間排列，只顯示目前修習的課程">
            {filteredTasks.length ? (
              filteredTasks.map((task) => (
                <AIRow
                  key={task.id}
                  title={task.title}
                  subtitle={task.groupName}
                  tag={describeLearningTask(task).label}
                  tagTone={describeLearningTask(task).tone}
                  onPress={() => openTask(task)}
                />
              ))
            ) : (
              <Text style={{ color: aiTokens.muted, padding: 16 }}>
                {filter === 'all' ? '目前沒有可列出的近期課務，仍可從課程查看最新內容。' : '此分類目前沒有待處理的事項。'}
              </Text>
            )}
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
    </AIScreen>
  );
}
