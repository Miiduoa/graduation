import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIScreen, AIHero, AISection, AICard, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { loadStudentHome } from '../data/studentHome';
import type { InboxTask } from '../data/types';
import { safeNavigate } from '../utils/safeNavigate';

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
  const [state, setState] = useState<{
    scope: string;
    data: LearningData | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;

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
    if (task.kind === 'live' && task.sessionId) {
      safeNavigate(navigation, 'Classroom', {
        groupId: task.groupId,
        groupName: task.groupName,
        sessionId: task.sessionId,
      });
    } else {
      safeNavigate(navigation, 'GroupDetail', { groupId: task.groupId });
    }
  };

  return (
    <AIScreen>
      <AIHero
        eyebrow="CAMPUS ONE"
        title="課程與學習"
        subtitle="查看已加入的課程、成績與近期課務。"
      />
      <AISection title="常用工具">
        <AIRow
          title="行事曆"
          subtitle="查看課程時間與自己的安排"
          onPress={() => safeNavigate(navigation, 'Calendar')}
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
      ) : visible.data ? (
        <>
          <AISection title="近期課務" subtitle="依目前課程資料列出">
            {visible.data.tasks.length ? (
              visible.data.tasks.map((task) => (
                <AIRow
                  key={task.id}
                  title={task.title}
                  subtitle={task.groupName}
                  tag={task.kind === 'live' ? '進行中' : undefined}
                  onPress={() => openTask(task)}
                />
              ))
            ) : (
              <Text style={{ color: aiTokens.muted, padding: 16 }}>
                目前沒有可列出的近期課務，仍可從課程查看最新內容。
              </Text>
            )}
          </AISection>
          <AISection title="我的課程">
            {visible.data.courses.length ? (
              visible.data.courses.map((course) => (
                <AICard key={course.groupId} title={course.name}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <AIButton
                      label="課程動態"
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
