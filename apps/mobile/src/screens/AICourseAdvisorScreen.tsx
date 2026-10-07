import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { AIScreen, AIHero, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import type { CatalogCourse, CatalogQueryResult } from '../services/courseCatalogClient';
import {
  AdvisorError,
  askCourseAdvisor,
  currentAdvisorSemester,
  loadAdvisorCatalog,
  loadAdvisorCourse,
  OFFICIAL_CATALOG_URL,
  officialSyllabusUrl,
  type AdvisorScope,
  type AdvisorMessage,
} from '../features/courseAdvisor';

type Props = { route?: { params?: { groupId?: string; groupName?: string } } };
type ActiveScope = React.MutableRefObject<string>;

export function AICourseAdvisorScreen({ route }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope: AdvisorScope = {
    userId: user?.uid ?? '',
    schoolId: school.id,
    groupId: route?.params?.groupId,
  };
  const scopeKey = JSON.stringify(scope);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  return (
    <AdvisorContent key={scopeKey} scope={scope} scopeKey={scopeKey} activeScope={activeScope} />
  );
}

function AdvisorContent({
  scope,
  scopeKey,
  activeScope,
}: {
  scope: AdvisorScope;
  scopeKey: string;
  activeScope: ActiveScope;
}) {
  const [semester, setSemester] = useState(currentAdvisorSemester);
  const [keyword, setKeyword] = useState('');
  const [catalog, setCatalog] = useState<CatalogQueryResult | null>(null);
  const [selected, setSelected] = useState<CatalogCourse | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<{ id: string; name: string } | null>(null);
  const [focusError, setFocusError] = useState('');
  const [focusLoading, setFocusLoading] = useState(Boolean(scope.groupId));
  const [conversationVersion, setConversationVersion] = useState(0);
  const conversationGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const isCurrent = () => mounted.current && activeScope.current === scopeKey;

  useEffect(() => {
    mounted.current = true;
    if (scope.groupId && scope.userId) {
      void loadAdvisorCourse(scope, isCurrent)
        .then((course) => {
          if (isCurrent()) setFocused(course);
        })
        .catch((reason) => {
          if (isCurrent()) setFocusError(messageFor(reason, '目前無法載入這門課，請稍後再試。'));
        })
        .finally(() => {
          if (isCurrent()) setFocusLoading(false);
        });
    } else setFocusLoading(false);
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
    // This component is remounted whenever the account, school or focused course changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetConversation = () => {
    conversationGeneration.current += 1;
    setConversationVersion(conversationGeneration.current);
  };
  const invalidateSearch = () => {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setError('');
    setCatalog(null);
    setSelected(null);
    resetConversation();
  };
  const search = async () => {
    if (!isCurrent() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setCatalog(null);
    setSelected(null);
    resetConversation();
    try {
      const result = await loadAdvisorCatalog(
        scope.schoolId,
        semester.trim(),
        keyword,
        controller.signal,
      );
      if (isCurrent() && request.current === controller) {
        setCatalog(result);
        setVisibleCount(20);
      }
    } catch (reason) {
      if (isCurrent() && request.current === controller) {
        setError(messageFor(reason, '目前無法查詢課程，請稍後再試。'));
      }
    } finally {
      if (isCurrent() && request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  };
  const open = async (url: string) => {
    if (!isCurrent()) return;
    try {
      await Linking.openURL(url);
    } catch {
      if (isCurrent()) setError('無法開啟網頁，請確認網路連線後重試。');
    }
  };
  const inputStyle = {
    color: aiTokens.text,
    backgroundColor: aiTokens.surface,
    borderColor: aiTokens.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 48,
  };

  return (
    <AIScreen keyboardShouldPersistTaps="handled">
      <AIHero
        eyebrow="CAMPUS ONE"
        title="課程顧問"
        subtitle="從課程內容與上課時間，找到適合自己的安排。"
      />
      {scope.groupId ? (
        <AICard title={focused?.name ?? '目前課程'}>
          <Text style={{ color: aiTokens.muted }}>
            {focusLoading
              ? '正在確認課程…'
              : focusError || '可以討論這門課的學習問題；未載入的作業與成績不會當作已知資料。'}
          </Text>
        </AICard>
      ) : null}
      <AICard title="找課程">
        <View style={{ gap: 12 }}>
          <Text style={{ color: aiTokens.muted }}>
            輸入想學的主題、課程名稱或老師，查詢校方課程目錄。
          </Text>
          <Text style={{ color: aiTokens.text }}>
            學期代碼（例如 1151 代表 115 學年度第 1 學期）
          </Text>
          <TextInput
            accessibilityLabel="學期代碼"
            value={semester}
            maxLength={4}
            keyboardType="number-pad"
            style={inputStyle}
            onChangeText={(value) => {
              invalidateSearch();
              setSemester(value);
            }}
          />
          <TextInput
            accessibilityLabel="課程關鍵字"
            placeholder="課名、老師或想學的主題"
            placeholderTextColor={aiTokens.muted}
            value={keyword}
            maxLength={80}
            style={inputStyle}
            onChangeText={(value) => {
              invalidateSearch();
              setKeyword(value);
            }}
          />
          {scope.schoolId === 'pu' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <AIButton
                label={loading ? '查詢中' : '查詢課程'}
                onPress={() => void search()}
                disabled={loading}
              />
              <AIButton
                label="校方課程查詢"
                variant="ghost"
                onPress={() => void open(OFFICIAL_CATALOG_URL)}
              />
            </View>
          ) : (
            <Text style={{ color: aiTokens.muted }}>
              這所學校的課程查詢尚未開放，你仍可以在下方討論學習問題。
            </Text>
          )}
          {loading ? (
            <ActivityIndicator color={aiTokens.ai} accessibilityLabel="查詢課程中" />
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
              {error}
            </Text>
          ) : null}
        </View>
      </AICard>
      {catalog ? (
        <AICard
          title={`查到 ${catalog.courses.length} 門課`}
          source={`靜宜大學課程目錄 · ${catalog.source === 'cache' ? '快取' : '查詢'}時間 ${new Date(catalog.fetchedAt).toLocaleString('zh-TW')}`}
        >
          <View style={{ gap: 16 }}>
            <Text style={{ color: aiTokens.muted }}>
              依校方順序顯示，最多載入 200 門。課程與名額仍以學校選課系統為準。
            </Text>
            {catalog.courses.length === 0 ? (
              <Text style={{ color: aiTokens.text }}>
                沒有符合條件的課程，試著更換關鍵字或學期。
              </Text>
            ) : null}
            {catalog.courses.slice(0, visibleCount).map((course, index) => (
              <View
                key={`${course.semester}-${course.code}-${index}`}
                style={{ gap: 8, borderTopWidth: 1, borderColor: aiTokens.border, paddingTop: 14 }}
              >
                <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 17 }}>
                  {course.name}
                </Text>
                <Text style={{ color: aiTokens.muted }}>
                  {course.code} · {course.teacher || '授課老師未提供'} ·{' '}
                  {Number.isFinite(course.credits) ? `${course.credits} 學分` : '學分未提供'}
                </Text>
                <Text style={{ color: aiTokens.muted }}>
                  {course.timePlaceRaw || '上課時間與地點未提供'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <AIButton
                    label={`討論${course.name}`}
                    variant="ghost"
                    onPress={() => {
                      setSelected(course);
                      resetConversation();
                    }}
                  />
                  {officialSyllabusUrl(course) ? (
                    <AIButton
                      label={`查看${course.name}課綱`}
                      variant="ghost"
                      onPress={() => void open(officialSyllabusUrl(course)!)}
                    />
                  ) : null}
                </View>
              </View>
            ))}
            {visibleCount < catalog.courses.length ? (
              <AIButton
                label="顯示更多課程"
                variant="ghost"
                onPress={() => setVisibleCount((value) => value + 20)}
              />
            ) : null}
          </View>
        </AICard>
      ) : null}
      <AdvisorConversation
        key={conversationVersion}
        scope={scope}
        isScopeCurrent={() => isCurrent() && conversationGeneration.current === conversationVersion}
        course={selected}
        catalog={catalog}
        blocked={
          !scope.userId
            ? '請先登入學校帳號，再開始對話。'
            : focusLoading
              ? '正在確認課程，請稍候。'
              : focusError
        }
      />
    </AIScreen>
  );
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof AdvisorError ? error.message : fallback;
}

function AdvisorConversation({
  scope,
  isScopeCurrent,
  course,
  catalog,
  blocked,
}: {
  scope: AdvisorScope;
  isScopeCurrent: () => boolean;
  course: CatalogCourse | null;
  catalog: CatalogQueryResult | null;
  blocked: string;
}) {
  const [history, setHistory] = useState<AdvisorMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = () => mounted.current && isScopeCurrent();
  const send = async () => {
    if (!isCurrent() || blocked || lock.current || !question.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const text = question.trim();
    try {
      const answer = await askCourseAdvisor({
        scope,
        history,
        question: text,
        course,
        catalog,
        isCurrent,
      });
      if (!isCurrent()) return;
      setHistory(
        (prior) =>
          [...prior, { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(
            -20,
          ) as AdvisorMessage[],
      );
      setQuestion('');
    } catch (reason) {
      if (isCurrent()) setError(messageFor(reason, '目前無法取得回覆，問題已保留，請稍後重試。'));
    } finally {
      if (isCurrent()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <AICard title={course ? `討論：${course.name}` : '聊聊你的選課與學習安排'}>
      <View style={{ gap: 14 }}>
        <Text style={{ color: aiTokens.muted }}>
          告訴我你的考量，例如想學的內容或可上課的時間。回覆僅供規劃參考，正式加退選請至學校系統辦理。
        </Text>
        {history.map((message, index) => (
          <View
            key={index}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: message.role === 'user' ? aiTokens.aiSoft : aiTokens.panel,
            }}
          >
            <Text style={{ color: aiTokens.muted, marginBottom: 6 }}>
              {message.role === 'user' ? '你' : '課程顧問'}
            </Text>
            <Text selectable style={{ color: aiTokens.text, lineHeight: 23 }}>
              {message.content}
            </Text>
          </View>
        ))}
        {blocked ? <Text style={{ color: aiTokens.muted }}>{blocked}</Text> : null}
        <TextInput
          accessibilityLabel="課程問題"
          placeholder="想討論什麼？"
          placeholderTextColor={aiTokens.muted}
          value={question}
          maxLength={800}
          multiline
          editable={!blocked && !busy}
          onChangeText={setQuestion}
          style={{
            color: aiTokens.text,
            borderColor: aiTokens.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            minHeight: 90,
          }}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            {error}
          </Text>
        ) : null}
        <AIButton
          label={busy ? '等待回覆中' : '送出問題'}
          onPress={() => void send()}
          disabled={Boolean(blocked) || busy || !question.trim()}
        />
      </View>
    </AICard>
  );
}
