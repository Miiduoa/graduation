import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { askCampusAssistant, OnDeviceAssistantError, type CampusAssistantMessage } from '../features/campusAssistant';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import {
  getMobileActionsForDestinations,
  getMobileAssistantAction,
  getMobileQuickActions,
  type MobileQuickAction,
} from '../services/quickCampusActions';
import { interpretMobileCampusRequest } from '../services/campusIntentClient';
import { mobileWorkspaceSuggestions } from '../services/workspaceEntry';
import { AssistantServiceReply } from '../screens/AssistantServiceReply';
import type { ServiceScreenProps } from '../screens/UnavailableFeatureScreen';
import { useAssistantContinuation } from '../services/assistantContinuation';

const favorites = [
  { label: '課表', phrase: '我的課表' },
  { label: '交作業', phrase: '我要交作業' },
  { label: '公車', phrase: '公車到站時間' },
  { label: '餐廳', phrase: '校園餐廳' },
];

type AskFailure = OnDeviceAssistantError['code'] | 'unknown';

const deviceErrors: Partial<Record<AskFailure, string>> = {
  'model-required': '這個問題需要手機 AI 模型，請先到模型管理頁下載。你也可以直接問下一堂課在哪裡。',
  'native-unavailable': '這個版本無法執行手機 AI 模型。你仍可查詢手機已儲存的課表。',
  'model-busy': '手機 AI 正在處理其他工作，請稍後再送出。',
};

type Analysis = {
  query: string;
  status: 'loading' | 'ready' | 'error';
  result?: CampusSemanticResult;
};

function classQuestions(reply?: CampusAssistantMessage, uid?: string | null, schoolId?: string | null) {
  if (!reply) return ['我現在有課嗎？'];
  const read = reply.savedClassRead;
  if (!read || read.uid !== uid || read.schoolId !== schoolId) return [];
  if (!read.classes.length) return read.currentAt ? ['下一堂課是什麼？'] : [];
  const questions: string[] = [];
  if (read.focus !== 'room' && read.classes.some(item => item.room.trim())) questions.push('在哪間教室？');
  if (read.focus !== 'time') questions.push('幾點下課？');
  return questions;
}

type QuickCampusEntryProps = {
  uid?: string | null;
  schoolId?: string | null;
  /** The home workspace keeps the same scoped conversation and service actions. */
  presentation?: 'compact' | 'workspace';
  navigation?: ServiceScreenProps['navigation'];
  onOpen: (action: MobileQuickAction) => boolean | void;
  onOpenAssistantRoute?: (route: string) => boolean | void;
  onExplore?: () => void;
};

/** A new account or school must never inherit the previous conversation or draft. */
export function QuickCampusEntry(props: QuickCampusEntryProps) {
  return (
    <ScopedQuickCampusEntry
      key={JSON.stringify([props.uid ?? null, props.schoolId ?? null])}
      {...props}
    />
  );
}

function ScopedQuickCampusEntry({
  uid,
  schoolId,
  presentation = 'compact',
  navigation,
  onOpen,
  onOpenAssistantRoute,
  onExplore,
}: QuickCampusEntryProps) {
  useThemeVersion();
  const { colors, radius, typography } = theme;
  const dark = theme.mode === 'dark';
  const textColor = dark ? '#F2F3F1' : '#252729';
  const mutedColor = dark ? '#A5AAA7' : '#686C70';
  const borderColor = dark ? '#292B2D' : '#E6E7E8';
  const workspace = presentation === 'workspace';
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<CampusAssistantMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<AskFailure | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const openWithContinuation = useAssistantContinuation(navigation, () => mounted.current);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
      sequence.current += 1;
    };
  }, []);

  const phrase = query.trim();
  const shown = analysis?.query === phrase ? analysis : null;
  const semantic = shown?.status === 'ready' ? shown.result : undefined;
  const semanticActions = semantic?.status === 'understood'
    ? getMobileActionsForDestinations(semantic.destinations)
    : null;
  const suggestions = (semanticActions || getMobileQuickActions(phrase))
    .filter(action => action.destination !== '/ai-assistant');
  const lastQuestion = history.at(-2);
  const lastReply = history.at(-1);
  const replyAction = getMobileAssistantAction(lastReply?.route);
  const earlierTurns = Math.max(0, history.length / 2 - 1);
  const suggestedQuestions = classQuestions(lastReply, uid, schoolId);
  const signedIn = Boolean(uid);
  const canAsk = Boolean(uid && schoolId);
  const modelBusy = shown?.status === 'loading';
  const starters = canAsk
    ? mobileWorkspaceSuggestions('student', false)
    : ['圖書館開放時間', '公車到站時間'];

  function update(value: string) {
    sequence.current += 1;
    setSubmittedSearch(null);
    setAnalysis(null);
    setAskError(null);
    setQuery(value.slice(0, 160));
  }

  async function analyze(raw: string) {
    const utterance = raw.trim().slice(0, 160);
    if (!uid || !utterance) return;
    const requested = ++sequence.current;
    setSubmittedSearch(null);
    setAnalysis({ query: utterance, status: 'loading' });
    try {
      const result = await interpretMobileCampusRequest({
        uid,
        schoolId: schoolId || '',
        utterance,
        isCurrent: () => mounted.current && sequence.current === requested,
      });
      if (mounted.current && sequence.current === requested) {
        setAnalysis({ query: utterance, status: 'ready', result });
      }
    } catch {
      if (mounted.current && sequence.current === requested) {
        setAnalysis({ query: utterance, status: 'error' });
      }
    }
  }

  async function ask(question = phrase) {
    if (!uid || !schoolId || !question || pending.current) return;
    if (question !== phrase) setQuery(question);
    Keyboard.dismiss();
    sequence.current += 1;
    setAnalysis(null);
    setAskError(null);
    setAsking(true);
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && pending.current === controller;
    const asked: CampusAssistantMessage = { role: 'user', content: question };
    try {
      const reply = await askCampusAssistant({
        scope: { uid, schoolId }, messages: [...history.slice(-18), asked], mode: 'device',
        signal: controller.signal, isCurrent: current,
      });
      if (current()) {
        setHistory(previous => [...previous, asked, { ...reply, role: 'assistant' }]);
        setQuery('');
      }
    } catch (error) {
      if (current()) {
        setAskError(error instanceof OnDeviceAssistantError ? error.code : 'unknown');
      }
    } finally {
      if (mounted.current && pending.current === controller) {
        pending.current = null;
        setAsking(false);
      }
    }
  }

  function submitInput() {
    if (canAsk) {
      void ask();
      return;
    }
    if (!phrase) return;
    Keyboard.dismiss();
    sequence.current += 1;
    setAnalysis(null);
    setSubmittedSearch(phrase);
  }

  function cancelAnalysis() {
    sequence.current += 1;
    setAnalysis(null);
  }

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setAsking(false);
  }

  function open(action: MobileQuickAction) {
    if (!mounted.current) return;
    Keyboard.dismiss();
    openWithContinuation(() => onOpen(action) !== false);
  }

  function openReplyRoute(route: string) {
    if (!mounted.current || !onOpenAssistantRoute) return;
    Keyboard.dismiss();
    openWithContinuation(() => onOpenAssistantRoute(route) !== false);
  }

  return (
    <View
      style={{
        gap: workspace ? 12 : 8,
        borderTopWidth: workspace ? 0 : 1,
        borderTopColor: borderColor,
        paddingTop: workspace ? 0 : 20,
      }}
      accessibilityLabel="校園助理與常用服務"
      testID={workspace ? 'today-task-workspace' : undefined}
    >
      {workspace && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ fontSize: 23, lineHeight: 31, fontWeight: '600', color: textColor }}>
            {lastReply ? '接著想了解什麼？' : '今天想完成什麼？'}
          </Text>
          <Text style={{ ...typography.bodySmall, color: mutedColor }}>
            {lastReply
              ? '接著追問，沿用這次對話的內容。'
              : canAsk
                ? '問課表、找校園服務，接著在這裡追問。'
                : '輸入想找的服務，或直接開啟課表與校園資訊。'}
          </Text>
        </View>
      )}
      {earlierTurns > 0 && (
        <View style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={historyOpen ? '收合先前問答' : `查看前 ${earlierTurns} 組問答`}
            aria-expanded={historyOpen}
            onPress={() => setHistoryOpen(value => !value)}
            style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name={historyOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accent} />
            <Text style={{ ...typography.bodySmall, color: colors.accent }}>
              {historyOpen ? '收合先前問答' : `查看前 ${earlierTurns} 組問答`}
            </Text>
          </Pressable>
          {historyOpen && history.slice(0, -2).map((message, index) => (
            <View key={index} style={{ gap: 2 }}>
              <Text style={{ ...typography.caption, color: mutedColor }}>
                {message.role === 'user' ? `第 ${index / 2 + 1} 問` : '校園助理'}
              </Text>
              <Text selectable style={{ ...typography.bodySmall, color: textColor }}>{message.content}</Text>
            </View>
          ))}
        </View>
      )}
      {lastQuestion && lastReply && (
        <View style={{ gap: 8, paddingVertical: 8 }}>
          <Text style={{ ...typography.caption, color: mutedColor }}>{lastQuestion.content}</Text>
          <Text accessibilityLiveRegion="polite" selectable style={{ ...typography.body, color: textColor }}>
            {lastReply.content}
          </Text>
          {lastReply.serviceSelection ? (
            <AssistantServiceReply selection={lastReply.serviceSelection}
              audience={uid ? 'campus' : 'guest'} schoolId={schoolId} navigation={navigation}
              disabled={asking} isCurrent={() => mounted.current} />
          ) : null}
          {!lastReply.serviceSelection && replyAction && onOpenAssistantRoute && (
            <Pressable accessibilityRole="button" onPress={() => openReplyRoute(replyAction.route)}
              style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colors.accent, ...typography.bodySmall }}>開啟{replyAction.label}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: dark ? '#151617' : '#F5F6F7',
          borderRadius: workspace ? radius.lg : radius.md,
          borderWidth: workspace ? 1 : 0,
          borderColor,
          paddingLeft: 12,
          paddingRight: 6,
          gap: 8,
        }}
      >
        <Ionicons name={canAsk ? 'chatbubble-outline' : 'search-outline'} size={18} color={mutedColor} />
        <TextInput
          ref={input}
          accessibilityLabel="說出或輸入想做的事"
          accessibilityHint={canAsk ? '可使用鍵盤聽寫，送出後在這裡查看回答。' : '輸入需求，尋找校園服務。'}
          placeholder={lastReply ? '接著問…' : workspace ? '輸入想做的事…' : canAsk ? '問校園助理…' : '找校園服務'}
          placeholderTextColor={mutedColor}
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={160}
          editable={!asking}
          returnKeyType={canAsk ? "send" : "search"}
          value={query}
          onChangeText={update}
          onSubmitEditing={submitInput}
          style={{ flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 10, fontSize: 15, color: textColor }}
        />
        {query.length > 0 && !asking ? (
          <Pressable
            accessibilityLabel="清除快速需求"
            accessibilityRole="button"
            onPress={() => update('')}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close-circle-outline" size={21} color={mutedColor} />
          </Pressable>
        ) : null}
        {workspace && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={asking ? '停止回答' : canAsk ? '詢問手機助理' : '查看搜尋結果'}
            accessibilityState={{ disabled: !phrase && !asking }}
            disabled={!phrase && !asking}
            onPress={asking ? stop : submitInput}
            style={({ pressed }) => ({
              width: 44, height: 44, borderRadius: radius.md,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: phrase || asking ? textColor : colors.surface2,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={asking ? 'stop' : canAsk ? 'arrow-up' : 'search-outline'} size={20}
              color={phrase || asking ? (dark ? '#151617' : '#FFFFFF') : mutedColor} />
          </Pressable>
        )}
      </View>
      {workspace && !phrase && !lastReply && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {starters.map(starter => (
            <Pressable
              key={starter}
              accessibilityRole="button"
              accessibilityLabel={'填入需求：' + starter}
              accessibilityHint="先填入輸入框，可編輯後再送出。"
              onPress={() => {
                update(starter);
                input.current?.focus();
              }}
              style={({ pressed }) => ({
                minHeight: 44, paddingHorizontal: 12, justifyContent: 'center',
                borderWidth: 1, borderColor, borderRadius: radius.full,
                backgroundColor: pressed ? colors.surface2 : 'transparent',
              })}
            >
              <Text style={{ ...typography.bodySmall, color: textColor }}>{starter}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!phrase && !canAsk && !workspace && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看搜尋結果"
          onPress={submitInput}
          style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12,
            borderRadius: radius.lg, backgroundColor: colors.surface2 }}
        >
          <Text style={{ ...typography.bodySmall, color: textColor, fontWeight: '600' }}>查看搜尋結果</Text>
        </Pressable>
      )}
      {submittedSearch === phrase && !!phrase && !canAsk && (
        <Text accessibilityLiveRegion="polite" style={{ ...typography.bodySmall, color: mutedColor }}>
          {suggestions.length ? `找到 ${suggestions.length} 個服務，請選擇要開啟的項目。` : '沒有相符的服務，試試課表、公車或圖書館。'}
        </Text>
      )}
      {!!phrase && canAsk && !workspace && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={asking ? '停止回答' : '詢問手機助理'}
          onPress={asking ? stop : () => void ask()}
          style={{ alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44,
            paddingHorizontal: 15, borderRadius: radius.lg, backgroundColor: colors.accent }}
        >
          <Text style={{ color: colors.onAccent, ...typography.bodySmall, fontWeight: '700' }}>
            {asking ? '回答中 · 停止' : '詢問手機助理'}
          </Text>
        </Pressable>
      )}
      {workspace && asking && (
        <Text accessibilityLiveRegion="polite" style={{ ...typography.bodySmall, color: mutedColor }}>
          手機助理正在回答，可隨時停止並保留問題。
        </Text>
      )}
      {askError && (
        <View>
          <Text accessibilityRole="alert" style={{ ...typography.bodySmall, color: textColor }}>
            {deviceErrors[askError] || '暫時無法回答，請再試一次。'}
          </Text>
          {askError === 'model-required' && onOpenAssistantRoute && (
            <Pressable accessibilityRole="button" onPress={() => onOpenAssistantRoute('AIModelManager')}
              style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colors.accent, ...typography.bodySmall }}>管理手機 AI 模型</Text>
            </Pressable>
          )}
        </View>
      )}
      {!!phrase && signedIn && !asking && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={modelBusy ? '停止雲端搜尋' : '用雲端 AI 找相關服務'}
          onPress={() => {
            if (modelBusy) {
              cancelAnalysis();
              return;
            }
            Keyboard.dismiss();
            void analyze(phrase);
          }}
          style={{
            alignSelf: 'flex-start',
            justifyContent: 'center',
            minHeight: 44,
            paddingHorizontal: 15,
            borderRadius: 11,
            backgroundColor: colors.surface2,
           }}
        >
          <Text style={{ color: textColor, ...typography.bodySmall, fontWeight: '600' }}>
            {modelBusy ? '停止雲端搜尋' : '用雲端 AI 找相關服務'}
          </Text>
        </Pressable>
      )}
      {!!phrase && signedIn && !asking && (
        <Text style={{ ...typography.caption, color: mutedColor }}>
          手機助理在裝置上回答。選擇雲端搜尋會傳送這次輸入的文字。
        </Text>
      )}
      {modelBusy && (
        <Text accessibilityLiveRegion="polite" style={{ color: mutedColor, ...typography.bodySmall }}>
          正在理解你的目標；可停止等待並繼續使用基本捷徑。
        </Text>
      )}

      {!phrase ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 }}>
          {canAsk && suggestedQuestions.map(question => (
            <Pressable key={question} accessibilityRole="button" accessibilityLabel={'詢問手機助理，' + question}
              onPress={() => void ask(question)}
              style={{ justifyContent: 'center', minHeight: 44, paddingRight: 6 }}>
              <Text style={{ ...typography.bodySmall, fontWeight: '500', color: lastReply ? colors.accent : mutedColor }}>
                {lastReply ? question : '現在的課'}
              </Text>
            </Pressable>
          ))}
          {favorites.map((favorite) => (
            <Pressable
              key={favorite.label}
              accessibilityRole="button"
              accessibilityLabel={'直接前往' + favorite.label}
              onPress={() => {
                const action = getMobileQuickActions(favorite.phrase)[0];
                if (action) open(action);
              }}
              style={({ pressed }) => ({
                minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center',
                borderRadius: radius.sm, paddingHorizontal: 4, backgroundColor: pressed ? colors.surface2 : 'transparent',
              })}
            >
              <Text style={{ ...typography.bodySmall, fontWeight: '500', color: mutedColor }}>
                {favorite.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {semantic?.source === 'model' ? (
            <View style={{ gap: 5, paddingVertical: 12 }}>
              <Text style={{ ...typography.bodySmall, color: textColor, fontWeight: '700' }}>
                {semantic.status === 'clarify' ? '需要再確認' : 'AI 理解的需求'}
              </Text>
              <Text style={{ ...typography.bodySmall, color: textColor }}>{semantic.summary}</Text>
              {semantic.clarifyingQuestion ? (
                <Text style={{ ...typography.bodySmall, color: mutedColor }}>{semantic.clarifyingQuestion}</Text>
              ) : null}
            </View>
          ) : null}
          {(shown?.status === 'error' || semantic?.status === 'unavailable') && (
            <Text style={{ ...typography.bodySmall, color: mutedColor }}>
              AI 暫時無法使用，以下是基本關鍵字捷徑，不是 AI 理解結果。
            </Text>
          )}
          {!signedIn && (
            <Text style={{ ...typography.bodySmall, color: mutedColor }}>
              目前使用基本捷徑；登入後可使用 AI 分析複合需求。
            </Text>
          )}
          {suggestions.length ? (
            <>
              <Text style={{ ...typography.caption, color: mutedColor }}>
                {semanticActions ? 'AI 建議下一步' : '基本快速入口'}
              </Text>
              {suggestions.map((action) => (
                <Pressable
                  key={action.destination}
                  accessibilityRole="button"
                  accessibilityLabel={'前往' + action.label}
                  onPress={() => open(action)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 13,
                    gap: 10, minHeight: 58, borderBottomWidth: 1,
                    borderBottomColor: borderColor,
                    opacity: pressed ? 0.65 : 1,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...typography.body, fontWeight: '600', color: textColor }}>
                      {action.label}
                    </Text>
                    <Text style={{ ...typography.caption, color: mutedColor }}>
                      {action.description}
                    </Text>
                    {semantic?.previews?.filter((preview) => preview.destination === action.destination).map((preview) => (
                      <View key={preview.destination} style={{
                        marginTop: 7, paddingTop: 8,
                        borderTopColor: borderColor, borderTopWidth: 1, gap: 3,
                      }}>
                        <Text style={{ ...typography.caption, color: mutedColor }}>
                          {preview.source === 'campus-platform' ? 'nuni 資料' : '接通狀態'}：{preview.message}
                        </Text>
                        {preview.items.map((item, index) => (
                          <Text key={index} style={{ ...typography.caption, color: textColor }}>
                            {item.title}{item.detail ? ' · ' + item.detail : ''}
                          </Text>
                        ))}
                      </View>
                    ))}
                  </View>
                  <Ionicons name="arrow-forward" color={colors.accent} size={18} />
                </Pressable>
              ))}
            </>
          ) : semantic?.status !== 'clarify' && !(submittedSearch === phrase && !canAsk) ? (
            <Text style={{ ...typography.bodySmall, color: mutedColor }}>
              {canAsk ? '尚未找到對應服務，可以補充需求或詢問助理。' : '尚未找到對應服務，試試其他關鍵字。'}
            </Text>
          ) : null}
        </View>
      )}

      {workspace && onExplore ? (
        <Pressable accessibilityRole="button" accessibilityLabel="探索更多 nuni 用法"
          onPress={() => { if (mounted.current) { Keyboard.dismiss(); onExplore(); } }}
          style={{ minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-start' }}>
          <Ionicons name="compass-outline" size={18} color={colors.accent} />
          <Text style={{ ...typography.bodySmall, color: colors.accent }}>探索更多用法</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
