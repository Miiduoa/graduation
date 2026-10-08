import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { AIDetailScreen, AICard, AIButton } from '../ui/aiFirst';
import { safeNavigate } from '../utils/safeNavigate';
import { resolveCourseHubTarget, type CourseHubTarget } from '../utils/courseHubRoute';
import { loadCourseHub, type CourseHubData, type CourseHubScope } from '../features/courseHub';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

type Props = {
  navigation?: Parameters<typeof safeNavigate>[0] & { goBack?: () => void };
  route?: { params?: Record<string, unknown> };
};
export default function CourseHubAiFirstScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const { school } = useSchool();
  const target = resolveCourseHubTarget(route?.params);
  const scopeKey = JSON.stringify([user?.uid, school.id, target]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <CourseContent
      key={scopeKey}
      uid={user?.uid ?? ''}
      schoolId={school.id}
      target={target}
      navigation={navigation}
      scopeKey={scopeKey}
      activeScope={activeScope}
    />
  );
}
function CourseContent({
  uid,
  schoolId,
  target,
  navigation,
  scopeKey,
  activeScope,
}: {
  uid: string;
  schoolId: string;
  target: CourseHubTarget | null;
  navigation: Props['navigation'];
  scopeKey: string;
  activeScope: React.MutableRefObject<string>;
}) {
  const theme = useTheme();
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const [data, setData] = useState<CourseHubData | null>(null);
  const [loading, setLoading] = useState(Boolean(target && uid));
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [opening, setOpening] = useState(false);
  const isCurrent = useCallback(
    () => mounted.current && activeScope.current === scopeKey,
    [activeScope, scopeKey],
  );
  const targetKey = JSON.stringify(target);
  const load = useCallback(async () => {
    const currentTarget = JSON.parse(targetKey) as CourseHubTarget | null;
    if (!currentTarget || !uid || !isCurrent()) return;
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setData(null);
    setLinkError('');
    try {
      const result = await loadCourseHub(
        { uid, schoolId, target: currentTarget } satisfies CourseHubScope,
        () => isCurrent() && request === generation.current,
      );
      if (isCurrent() && request === generation.current) setData(result);
    } catch (reason) {
      if (isCurrent() && request === generation.current)
        setError(reason instanceof Error ? reason.message : '目前無法讀取課程。');
    } finally {
      if (isCurrent() && request === generation.current) setLoading(false);
    }
  }, [uid, schoolId, targetKey, isCurrent]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);
  const open = async (url: string) => {
    if (!isCurrent() || pending.current || !data) return;
    pending.current = true;
    setOpening(true);
    setLinkError('');
    try {
      const opened = await webBrowserOpenWithPuTronClassGate(url);
      if (isCurrent() && !opened) setLinkError('目前無法開啟連結，請稍後再試。');
    } catch {
      if (isCurrent()) setLinkError('目前無法開啟連結，請稍後再試。');
    } finally {
      if (isCurrent()) setOpening(false);
      pending.current = false;
    }
  };
  const go = (screen: string) => {
    if (isCurrent() && data && target?.source === 'group')
      safeNavigate(navigation, screen, { groupId: target.groupId, groupName: data.name });
  };
  const body = { ...theme.typography.body, color: theme.colors.muted };
  const gap = { gap: theme.space.md };
  return (
    <AIDetailScreen
      title={data?.name ?? '課程總覽'}
      subtitle={target?.source === 'tronclass' ? '校方 TronClass 課程' : 'Campus One 課程'}
      onBack={() => navigation?.goBack?.()}
    >
      {!target || !uid ? (
        <AICard title={!uid ? '登入後查看課程' : '請先選擇課程'}>
          <View style={gap}>
            <Text style={body}>
              {!uid
                ? '請使用學校帳號登入，再從課程列表開啟。'
                : '這個連結沒有提供可辨識的課程，請回到列表重新選擇。'}
            </Text>
            <AIButton label="回到課程列表" onPress={() => safeNavigate(navigation, 'LearnHome')} />
          </View>
        </AICard>
      ) : loading ? (
        <AICard>
          <ActivityIndicator accessibilityLabel="讀取課程資料" color={theme.colors.accent} />
        </AICard>
      ) : error ? (
        <AICard title="目前無法讀取課程">
          <View style={gap}>
            <Text accessibilityRole="alert" style={body}>
              {error}
            </Text>
            <AIButton label="重新讀取課程" onPress={() => void load()} />
          </View>
        </AICard>
      ) : data ? (
        <>
          <AICard title="課程資訊">
            <View style={gap}>
              {data.details.length ? <Text style={body}>{data.details.join(' · ')}</Text> : null}
              <Text style={body}>
                {data.description ||
                  (target.source === 'tronclass'
                    ? '課程說明請見校方課程頁面。'
                    : '尚未提供課程說明。')}
              </Text>
              <AIButton label="更新課程資料" variant="ghost" onPress={() => void load()} />
            </View>
          </AICard>
          {target.source === 'tronclass' ? (
            <AICard title="校方課程內容">
              <View style={gap}>
                <Text style={body}>
                  教材、作業繳交、測驗與成績請在這門課的校方頁面查看；開啟後可能需要重新登入學校帳號。
                </Text>
                <AIButton
                  label="開啟校方課程"
                  disabled={opening}
                  onPress={() =>
                    void open(`https://tronclass.pu.edu.tw/course/${target.courseId}/content`)
                  }
                />
              </View>
            </AICard>
          ) : (
            <>
              <AICard title="課程入口">
                <View style={gap}>
                  <AIButton
                    label="課程群組與公告"
                    variant="ghost"
                    onPress={() => go('GroupDetail')}
                  />
                  <AIButton label="測驗通知" variant="ghost" onPress={() => go('QuizCenter')} />
                  <AIButton
                    label="課程顧問"
                    variant="ghost"
                    onPress={() => go('AICourseAdvisor')}
                  />
                </View>
              </AICard>
              <AICard title="教材與單元">
                <View style={gap}>
                  {data.materials.status === 'error' ? (
                    <Text accessibilityRole="alert" style={body}>
                      教材讀取失敗，請更新課程資料後重試。
                    </Text>
                  ) : data.materials.items.length === 0 ? (
                    <Text style={body}>尚未發布教材或單元。</Text>
                  ) : (
                    data.materials.items.map((item) => (
                      <View key={item.id} style={gap}>
                        <Text
                          style={{
                            ...theme.typography.body,
                            color: theme.colors.text,
                            fontWeight: '700',
                          }}
                        >
                          {item.title}
                        </Text>
                        {item.description ? <Text style={body}>{item.description}</Text> : null}
                        {item.url ? (
                          <AIButton
                            label={`開啟教材：${item.title}`}
                            variant="ghost"
                            disabled={opening}
                            onPress={() => void open(item.url!)}
                          />
                        ) : (
                          <Text style={body}>這個單元未附教材連結。</Text>
                        )}
                      </View>
                    ))
                  )}
                </View>
              </AICard>
              <AICard title="作業公告">
                <View style={gap}>
                  {data.assignments.status === 'error' ? (
                    <Text accessibilityRole="alert" style={body}>
                      作業讀取失敗，請更新課程資料後重試。
                    </Text>
                  ) : data.assignments.items.length === 0 ? (
                    <Text style={body}>尚未發布作業。</Text>
                  ) : (
                    <>
                      <Text style={body}>此處提供作業說明；繳交方式請依老師公告辦理。</Text>
                      {data.assignments.items.map((item) => (
                        <View key={item.id} style={gap}>
                          <Text
                            style={{
                              ...theme.typography.body,
                              color: theme.colors.text,
                              fontWeight: '700',
                            }}
                          >
                            {item.title}
                          </Text>
                          {item.description ? <Text style={body}>{item.description}</Text> : null}
                          <Text style={body}>
                            {item.closed
                              ? '已關閉'
                              : item.dueAt
                                ? `截止：${new Date(item.dueAt).toLocaleString('zh-TW')}`
                                : '未提供截止時間'}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              </AICard>
            </>
          )}
          {linkError ? (
            <AICard>
              <Text accessibilityRole="alert" style={body}>
                {linkError}
              </Text>
            </AICard>
          ) : null}
        </>
      ) : null}
    </AIDetailScreen>
  );
}
