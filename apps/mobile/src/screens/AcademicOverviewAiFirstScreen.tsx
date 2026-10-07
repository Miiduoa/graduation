import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIDetailScreen, AISection, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { usePermissions } from '../hooks/usePermissions';
import { loadStudentHome } from '../data/studentHome';
import { safeNavigate } from '../utils/safeNavigate';

type AcademicData = Awaited<ReturnType<typeof loadStudentHome>>;

export default function AcademicOverviewAiFirstScreen() {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const navigation = useNavigation();
  const auth = useAuth();
  const { isStudent } = usePermissions();
  const uid = auth.user?.uid;
  const profile = auth.profile?.uid === uid ? auth.profile : null;
  const schoolId = profile?.schoolId;
  const scope = JSON.stringify([uid, schoolId, profile?.role]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    data: AcademicData | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const visible = state?.scope === scope ? state : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, data: null, loading: true, error: false });
    try {
      if (!uid || !schoolId || uid.startsWith('demo_')) throw new Error('missing-account');
      const data = await loadStudentHome(uid, schoolId);
      const courseIds = new Set(data.courses.map((course) => course.groupId));
      const tasks = data.tasks.filter(
        (task) => task.kind !== 'assistant_queue' && courseIds.has(task.groupId),
      );
      if (currentScope.current === scope && generation.current === request) {
        setState({ scope, data: { courses: data.courses, tasks }, loading: false, error: false });
      }
    } catch {
      if (currentScope.current === scope && generation.current === request) {
        setState({ scope, data: null, loading: false, error: true });
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

  return (
    <AIDetailScreen
      title="學業總覽"
      subtitle="從課程、近期課務與已同步成績掌握學習進度"
      onBack={() => navigation.goBack()}
    >
      <AISection title="學業工具">
        <AIRow
          title="我的成績"
          subtitle="查看已同步的成績紀錄"
          onPress={() => safeNavigate(navigation, 'Grades')}
        />
        <AIRow
          title="行事曆"
          subtitle="查看課程時間與自己的安排"
          onPress={() => safeNavigate(navigation, 'Calendar')}
        />
        {isStudent && profile ? (
          <AIRow
            title="學分試算"
            subtitle="依修課資料檢查畢業條件"
            onPress={() => safeNavigate(navigation, 'CreditAuditStack')}
          />
        ) : null}
      </AISection>
      {!visible || visible.loading ? (
        <ActivityIndicator accessibilityLabel="讀取學業資料" color={aiTokens.ai} />
      ) : visible.error ? (
        <AISection title="課程資料">
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>
              無法讀取學業資料，請確認登入狀態與網路後重試。
            </Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        </AISection>
      ) : visible.data ? (
        <>
          <AISection title="我的課程">
            {visible.data.courses.length ? (
              visible.data.courses.map((course) => (
                <AIRow
                  key={course.groupId}
                  title={course.name}
                  subtitle="查看課程動態"
                  onPress={() =>
                    safeNavigate(navigation, 'GroupDetail', { groupId: course.groupId })
                  }
                />
              ))
            ) : (
              <Text style={{ padding: 16, color: aiTokens.muted }}>目前沒有已加入的課程。</Text>
            )}
          </AISection>
          <AISection title="近期課務">
            {visible.data.tasks.length ? (
              visible.data.tasks.map((task) => (
                <AIRow
                  key={task.id}
                  title={task.title}
                  subtitle={task.groupName}
                  onPress={() =>
                    safeNavigate(
                      navigation,
                      task.kind === 'live' && task.sessionId ? 'Classroom' : 'GroupDetail',
                      task.kind === 'live' && task.sessionId
                        ? {
                            groupId: task.groupId,
                            groupName: task.groupName,
                            sessionId: task.sessionId,
                          }
                        : { groupId: task.groupId },
                    )
                  }
                />
              ))
            ) : (
              <Text style={{ padding: 16, color: aiTokens.muted }}>
                目前沒有可列出的近期課務，仍可從課程查看最新內容。
              </Text>
            )}
          </AISection>
        </>
      ) : null}
    </AIDetailScreen>
  );
}
