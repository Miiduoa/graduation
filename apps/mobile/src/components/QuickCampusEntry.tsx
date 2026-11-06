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

const favorites = [
  { label: '課表', phrase: '我的課表', icon: 'calendar-outline' as const },
  { label: '交作業', phrase: '我要交作業', icon: 'document-text-outline' as const },
  { label: '公車', phrase: '公車到站時間', icon: 'bus-outline' as const },
  { label: '餐廳', phrase: '校園餐廳', icon: 'restaurant-outline' as const },
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

export function QuickCampusEntry({
  uid,
  schoolId,
  onOpen,
  onOpenAssistantRoute,
}: {
  uid?: string | null;
  schoolId?: string | null;
  onOpen: (action: MobileQuickAction) => void;
  onOpenAssistantRoute?: (route: string) => void;
}) {
  useThemeVersion();
  const { colors, radius, typography } = theme;
  const [query, setQuery] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<CampusAssistantMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<AskFailure | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
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
  const signedIn = Boolean(uid);
  const canAsk = Boolean(uid && schoolId);
  const modelBusy = shown?.status === 'loading';

  function update(value: string) {
    sequence.current += 1;
    setAnalysis(null);
    setAskError(null);
    setQuery(value.slice(0, 160));
  }

  async function analyze(raw: string) {
    const utterance = raw.trim().slice(0, 160);
    if (!uid || !utterance) return;
    const requested = ++sequence.current;
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

  async function ask() {
    if (!uid || !schoolId || !phrase || pending.current) return;
    Keyboard.dismiss();
    sequence.current += 1;
    setAnalysis(null);
    setAskError(null);
    setAsking(true);
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && !controller.signal.aborted && pending.current === controller;
    const next: CampusAssistantMessage[] = [...history.slice(-18), { role: 'user', content: phrase }];
    try {
      const reply = await askCampusAssistant({
        scope: { uid, schoolId }, messages: next, mode: 'device',
        signal: controller.signal, isCurrent: current,
      });
      if (current()) {
        setHistory([...next, { ...reply, role: 'assistant' }]);
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

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setAsking(false);
  }

  function open(action: MobileQuickAction) {
    Keyboard.dismiss();
    onOpen(action);
  }

  return (
    <View
      style={{
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 18,
        backgroundColor: colors.surface,
        padding: 16,
        gap: 13,
      }}
      accessibilityLabel="快速開始"
    >
      <View style={{ gap: 4 }}>
        <Text style={{ ...typography.h3, color: colors.text }}>想做什麼？</Text>
        <Text style={{ ...typography.bodySmall, color: colors.muted }}>
          {canAsk ? '用鍵盤的麥克風口述，或直接打字。校園助理會在這裡回答。' : '輸入想做的事，尋找校園服務。'}
        </Text>
      </View>

      {lastQuestion && lastReply && (
        <View style={{ gap: 6, padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface2 }}>
          <Text style={{ ...typography.caption, color: colors.muted }}>{lastQuestion.content}</Text>
          <Text accessibilityLiveRegion="polite" selectable style={{ ...typography.body, color: colors.text }}>
            {lastReply.content}
          </Text>
          {replyAction && onOpenAssistantRoute && (
            <Pressable accessibilityRole="button" onPress={() => onOpenAssistantRoute(replyAction.route)}
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
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bg,
          borderRadius: radius.lg,
          paddingLeft: 12,
          paddingRight: 6,
          gap: 8,
        }}
      >
        <Ionicons name="search-outline" size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="說出或輸入想做的事"
          placeholder={lastReply ? '接著問…' : '例如：下一堂課在哪裡？'}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={160}
          editable={!asking}
          returnKeyType="send"
          value={query}
          onChangeText={update}
          onSubmitEditing={() => void ask()}
          style={{ flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 10, fontSize: 15, color: colors.text }}
        />
        {query.length > 0 && !asking ? (
          <Pressable
            accessibilityLabel="清除快速需求"
            accessibilityRole="button"
            onPress={() => update('')}
            style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close-circle-outline" size={21} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {!!phrase && canAsk && (
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
      {askError && (
        <View>
          <Text accessibilityRole="alert" style={{ ...typography.bodySmall, color: colors.text }}>
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
          accessibilityLabel="用雲端 AI 找相關服務"
          accessibilityState={{ disabled: modelBusy }}
          disabled={modelBusy}
          onPress={() => {
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
            opacity: modelBusy ? 0.55 : 1,
          }}
        >
          <Text style={{ color: colors.text, ...typography.bodySmall, fontWeight: '600' }}>
            {modelBusy ? 'AI 正在理解…' : '用雲端 AI 找相關服務'}
          </Text>
        </Pressable>
      )}
      {modelBusy && (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, ...typography.bodySmall }}>
          正在理解你的目標；不會自動執行任何操作。
        </Text>
      )}

      {!phrase ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
                flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44,
                borderRadius: 999, paddingHorizontal: 13, borderWidth: 1,
                borderColor: colors.border, backgroundColor: pressed ? colors.surface2 : colors.bg,
              })}
            >
              <Ionicons name={favorite.icon} size={17} color={colors.accent} />
              <Text style={{ ...typography.bodySmall, fontWeight: '600', color: colors.text }}>
                {favorite.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {semantic?.source === 'model' ? (
            <View style={{ gap: 5, padding: 12, borderRadius: 12, backgroundColor: colors.surface2 }}>
              <Text style={{ ...typography.bodySmall, color: colors.text, fontWeight: '700' }}>
                {semantic.status === 'clarify' ? '需要再確認' : 'AI 理解的需求'}
              </Text>
              <Text style={{ ...typography.bodySmall, color: colors.text }}>{semantic.summary}</Text>
              {semantic.clarifyingQuestion ? (
                <Text style={{ ...typography.bodySmall, color: colors.muted }}>{semantic.clarifyingQuestion}</Text>
              ) : null}
            </View>
          ) : null}
          {(shown?.status === 'error' || semantic?.status === 'unavailable') && (
            <Text style={{ ...typography.bodySmall, color: colors.muted }}>
              AI 暫時無法使用，以下是基本關鍵字捷徑，不是 AI 理解結果。
            </Text>
          )}
          {!signedIn && (
            <Text style={{ ...typography.bodySmall, color: colors.muted }}>
              目前使用基本捷徑；登入後可使用 AI 分析複合需求。
            </Text>
          )}
          {suggestions.length ? (
            <>
              <Text style={{ ...typography.caption, color: colors.muted }}>
                {semanticActions ? 'AI 建議下一步' : '基本快速入口'}
              </Text>
              {suggestions.map((action) => (
                <Pressable
                  key={action.destination}
                  accessibilityRole="button"
                  accessibilityLabel={'前往' + action.label}
                  onPress={() => open(action)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', padding: 13,
                    gap: 10, minHeight: 58, borderRadius: 12, borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surface3 : colors.surface2,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...typography.body, fontWeight: '600', color: colors.text }}>
                      {action.label}
                    </Text>
                    <Text style={{ ...typography.caption, color: colors.muted }}>
                      {action.description}
                    </Text>
                    {semantic?.previews?.filter((preview) => preview.destination === action.destination).map((preview) => (
                      <View key={preview.destination} style={{
                        marginTop: 7, paddingTop: 8,
                        borderTopColor: colors.border, borderTopWidth: 1, gap: 3,
                      }}>
                        <Text style={{ ...typography.caption, color: colors.muted }}>
                          {preview.source === 'campus-platform' ? 'nuni 資料' : '接通狀態'}：{preview.message}
                        </Text>
                        {preview.items.map((item, index) => (
                          <Text key={index} style={{ ...typography.caption, color: colors.text }}>
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
          ) : semantic?.status !== 'clarify' ? (
            <Text style={{ ...typography.bodySmall, color: colors.muted }}>
              尚未找到對應服務，可以補充需求或詢問助理。
            </Text>
          ) : null}
        </View>
      )}
      <Text style={{ ...typography.caption, color: colors.muted }}>
        手機助理在裝置上回答。選擇「用雲端 AI 找相關服務」才會把這次輸入的文字傳給雲端模型。
      </Text>
    </View>
  );
}
