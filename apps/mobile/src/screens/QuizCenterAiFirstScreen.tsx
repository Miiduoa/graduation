import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import { loadCourseQuizNotices, type CourseQuizNotices } from '../features/courseQuizzes';

type Props = {
  navigation?: Parameters<typeof safeNavigate>[0] & { goBack?: () => void };
  route?: { params?: { groupId?: unknown; courseSpaceId?: unknown; quizId?: unknown } };
};
function parameter(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export default function QuizCenterAiFirstScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const owner = useRef({ params: route?.params, scope, allowed: true });
  if (owner.current.params !== route?.params)
    owner.current = { params: route?.params, scope, allowed: true };
  else if (owner.current.scope !== scope)
    owner.current = { params: route?.params, scope, allowed: false };
  const params = owner.current.allowed ? route?.params : undefined;
  const groupId = parameter(params?.groupId) || parameter(params?.courseSpaceId);
  const quizId = parameter(params?.quizId);
  return (
    <QuizNotices
      key={JSON.stringify([scope, groupId, quizId])}
      uid={user?.uid ?? ''}
      schoolId={school.id}
      groupId={groupId}
      quizId={quizId}
      navigation={navigation}
    />
  );
}

function QuizNotices({
  uid,
  schoolId,
  groupId,
  quizId,
  navigation,
}: {
  uid: string;
  schoolId: string;
  groupId: string;
  quizId: string;
  navigation: Props['navigation'];
}) {
  const theme = useTheme();
  const [data, setData] = useState<CourseQuizNotices | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!uid || !groupId) return;
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    loadCourseQuizNotices(uid, schoolId, groupId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError('無法載入測驗通知，請確認網路與課程權限後再試一次。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [uid, schoolId, groupId, attempt]);
  const body = { ...theme.typography.body, color: theme.colors.text };
  const secondary = { ...theme.typography.bodySmall, color: theme.colors.muted };
  const notices = data?.notices.filter((notice) => !quizId || notice.id === quizId) ?? [];
  return (
    <AIDetailScreen
      title="課程測驗"
      subtitle={data?.groupName ?? '查看教師發布的測驗通知與應試說明。'}
      onBack={() => navigation?.goBack?.()}
    >
      {!uid ? (
        <AICard title="登入後查看">
          <Text style={body}>請登入學校帳號，查看所屬課程的測驗通知。</Text>
        </AICard>
      ) : !groupId ? (
        <AICard title="先選擇課程">
          <View style={{ gap: theme.space.md }}>
            <Text style={body}>請從我的課程開啟測驗通知。</Text>
            <AIButton label="查看我的課程" onPress={() => safeNavigate(navigation, 'LearnHome')} />
          </View>
        </AICard>
      ) : loading ? (
        <AICard>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={secondary}>正在載入測驗通知…</Text>
        </AICard>
      ) : error ? (
        <AICard title="暫時無法載入">
          <View style={{ gap: theme.space.md }}>
            <Text accessibilityRole="alert" style={body}>
              {error}
            </Text>
            <AIButton label="重新載入" onPress={() => retry((value) => value + 1)} />
          </View>
        </AICard>
      ) : data ? (
        <>
          <AICard title="應試方式">
            <Text style={body}>
              請依教師公告的方式應試。目前未提供 App
              內作答與成績回傳；測驗時間、繳交狀態及成績以授課教師或校方教學平台為準。
            </Text>
          </AICard>
          {!notices.length ? (
            <AICard title={quizId ? '找不到這份測驗通知' : '尚無已發布的測驗通知'}>
              <Text style={secondary}>請確認課程公告，或向授課教師詢問。</Text>
            </AICard>
          ) : (
            notices.map((notice) => (
              <AICard key={notice.id} title={notice.title}>
                <View style={{ gap: theme.space.sm }}>
                  <Text style={secondary}>
                    {notice.type === 'exam' ? '考試' : '測驗'} ·{' '}
                    {notice.dueAt
                      ? `公告截止時間：${new Date(notice.dueAt).toLocaleString('zh-TW')}`
                      : '尚未公告截止時間'}
                  </Text>
                  <Text style={body}>
                    {notice.description || '教師尚未提供應試說明，請查看課程公告。'}
                  </Text>
                </View>
              </AICard>
            ))
          )}
          {data.hasMore ? (
            <AICard>
              <Text style={secondary}>
                這門課的通知較多，目前僅顯示部分紀錄。完整安排請向授課教師確認。
              </Text>
            </AICard>
          ) : null}
        </>
      ) : null}
    </AIDetailScreen>
  );
}
