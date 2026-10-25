import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useTheme } from '../state/theme';
import {
  getMobileActionsForDestinations,
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

type Analysis = {
  query: string;
  status: 'loading' | 'ready' | 'error';
  result?: CampusSemanticResult;
};

export function QuickCampusEntry({
  uid,
  schoolId,
  onOpen,
  onAsk,
}: {
  uid?: string | null;
  schoolId?: string | null;
  onOpen: (action: MobileQuickAction) => void;
  onAsk: (question: string) => void;
}) {
  const design = useTheme();
  const { colors, radius, typography } = design;
  const [query, setQuery] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  const phrase = query.trim();
  const shown = analysis?.query === phrase ? analysis : null;
  const semantic = shown?.status === 'ready' ? shown.result : undefined;
  const semanticActions = semantic?.status === 'understood'
    ? getMobileActionsForDestinations(semantic.destinations)
    : null;
  const suggestions = semanticActions || getMobileQuickActions(phrase);
  const signedIn = Boolean(uid);
  const modelBusy = shown?.status === 'loading';

  function update(value: string) {
    sequence.current += 1;
    setAnalysis(null);
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
          說一句話，AI 能理解多個需求。可使用手機鍵盤的麥克風口述。
        </Text>
      </View>

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
          placeholder="例如：明天沒課，想讀書再吃飯"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={160}
          returnKeyType="search"
          value={query}
          onChangeText={update}
          onSubmitEditing={() => {
            if (uid) void analyze(phrase);
            Keyboard.dismiss();
          }}
          style={{ flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 10, fontSize: 15, color: colors.text }}
        />
        {query.length > 0 ? (
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
      {!!phrase && signedIn && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="用 AI 理解這句話"
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
            backgroundColor: colors.accent,
            opacity: modelBusy ? 0.55 : 1,
          }}
        >
          <Text style={{ color: colors.onAccent, ...typography.bodySmall, fontWeight: '700' }}>
            {modelBusy ? 'AI 正在理解…' : '用 AI 理解這句話'}
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
          {signedIn && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="將問題帶到校園助理"
              onPress={() => {
                Keyboard.dismiss();
                onAsk(phrase);
              }}
              style={{ justifyContent: 'center', alignSelf: 'flex-start', minHeight: 44 }}
            >
              <Text style={{ ...typography.bodySmall, color: colors.accent, fontWeight: '600' }}>
                向校園助理進一步詢問
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <Text style={{ ...typography.caption, color: colors.muted }}>
        使用 AI 會傳送轉寫文字給雲端模型；手機聽寫由鍵盤提供。這裡只會開啟服務，不會自動繳交、付款或更改資料。
      </Text>
    </View>
  );
}
