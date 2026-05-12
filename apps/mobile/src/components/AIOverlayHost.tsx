/**
 * AIOverlayHost — 全域 AI 覆蓋層主機
 * ═══════════════════════════════════════════════════════════════════════
 * 訂閱 aiOverlay singleton，依 mode 顯示：
 *   - 'chat'     → 全螢幕對話（嵌入 AIChatScreen，帶 initialPrompt）
 *   - 'insights' → 中央彈出，顯示 aiBrain insights + Brain 概況
 *   - 'quick'    → 底部上拉式快速命令面板
 *
 * 心理學：
 * - Predictability：所有 AI 互動都從同一個地方開
 * - Calm Clarity：背景柔焦，動畫滑順
 * - Mental Model：使用者只記「點 AI 球 = 跟 AI 講話」
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  Dimensions,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { aiOverlay, useAIOverlay } from '../app/useAIOverlay';
import { useAIBrain } from '../app/useAIBrain';
import { BrainInsightCards } from './BrainInsightCards';
import { AIChatScreen } from '../screens/AIChatScreen';
import { theme, softShadowStyle } from '../ui/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export function AIOverlayHost() {
  const overlay = useAIOverlay();

  if (!overlay.visible) return null;

  return (
    <Modal
      visible={overlay.visible}
      transparent
      animationType="none"
      onRequestClose={() => aiOverlay.close()}
      statusBarTranslucent
    >
      {overlay.mode === 'chat' ? (
        <ChatModeOverlay
          initialPrompt={overlay.initialPrompt}
          proactiveReportId={overlay.proactiveReportId}
        />
      ) : overlay.mode === 'quick' ? (
        <QuickCommandOverlay />
      ) : (
        <InsightsOverlay />
      )}
    </Modal>
  );
}

// ─── 1. Chat 模式：全螢幕對話 ─────────────────────────
function ChatModeOverlay({
  initialPrompt,
  proactiveReportId,
}: {
  initialPrompt?: string;
  proactiveReportId?: string;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const navigation = useNavigation<any>();

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 0,
      tension: 60,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const handleClose = () => {
    Animated.timing(slide, {
      toValue: SCREEN_HEIGHT,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => aiOverlay.close());
  };

  // AIChatScreen 是 1 個獨立 Screen，這裡用 props 注入 navigation/route 來模擬導航環境
  const fakeRoute = useMemo(() => {
    const params: Record<string, string> = {};
    if (typeof initialPrompt === 'string' && initialPrompt.trim()) {
      params.prompt = initialPrompt.trim();
    }
    if (typeof proactiveReportId === 'string' && proactiveReportId.trim()) {
      params.proactiveReportId = proactiveReportId.trim();
    }
    return {
      key: 'AIOverlay-Chat',
      name: 'AIChat',
      params: Object.keys(params).length ? params : undefined,
    };
  }, [initialPrompt, proactiveReportId]);

  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <Pressable
        onPress={handleClose}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
      />
      <Animated.View
        style={{
          flex: 1,
          marginTop: Math.max(insets.top + 8, 50),
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          overflow: 'hidden',
          transform: [{ translateY: slide }],
          ...softShadowStyle({
            color: '#000',
            opacity: 0.3,
            radius: 24,
            offset: { width: 0, height: -8 },
            elevation: 20,
          }),
        }}
      >
        {/* 拖曳指示 */}
        <View
          style={{
            alignItems: 'center',
            paddingTop: 8,
            paddingBottom: 4,
            backgroundColor: theme.colors.bg,
          }}
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border,
            }}
          />
        </View>

        {/* 頂列：標題 + 關閉 */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="sparkles" size={18} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
              AI 校園助理
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Pressable
              onPress={() => aiOverlay.setMode('insights')}
              hitSlop={10}
              style={({ pressed }) => ({
                padding: 8,
                borderRadius: 12,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
              })}
              accessibilityRole="button"
              accessibilityLabel="查看 AI 洞察"
            >
              <Ionicons name="bulb-outline" size={20} color={theme.colors.text} />
            </Pressable>
            <Pressable
              onPress={handleClose}
              hitSlop={10}
              style={({ pressed }) => ({
                padding: 8,
                borderRadius: 12,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
              })}
              accessibilityRole="button"
              accessibilityLabel="關閉"
            >
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        {/* AIChatScreen — 用 navigation prop 注入主導航，讓 AI 可以呼叫 navigate */}
        <View style={{ flex: 1 }}>
          <AIChatScreen
            navigation={navigation}
            route={fakeRoute}
          />
        </View>
      </Animated.View>
    </View>
  );
}

// ─── 2. Insights 模式：洞察彈出視窗 ─────────────────────
function InsightsOverlay() {
  const insets = useSafeAreaInsets();
  const brain = useAIBrain();
  const slide = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slide, {
        toValue: 0,
        tension: 80,
        friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slide, opacity]);

  const handleClose = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => aiOverlay.close());
  };

  const description = brain.describe();
  const insightCount = brain.insights.length;
  const factCount = brain.learning?.memory.learnedFacts.length ?? 0;
  const skillCount = brain.learning?.trainingDB.learnedSkills.length ?? 0;

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        opacity,
      }}
    >
      <Pressable
        onPress={handleClose}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
      />
      <Animated.View
        style={{
          marginTop: Math.max(insets.top + 60, 80),
          marginHorizontal: 16,
          backgroundColor: theme.colors.bg,
          borderRadius: 24,
          maxHeight: SCREEN_HEIGHT * 0.7,
          overflow: 'hidden',
          transform: [{ translateY: slide }],
          ...softShadowStyle(theme.shadows.soft),
        }}
      >
        {/* 頂部 — Brain 描述 */}
        <View
          style={{
            padding: 18,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: theme.colors.accent + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="hardware-chip" size={18} color={theme.colors.accent} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
                AI 大腦
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={10}>
              <Ionicons name="close" size={20} color={theme.colors.muted} />
            </Pressable>
          </View>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {description}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 12,
            }}
          >
            <StatPill icon="bulb-outline" label={`${insightCount} 個洞察`} />
            <StatPill icon="library-outline" label={`${factCount} 條記憶`} />
            <StatPill icon="construct-outline" label={`${skillCount} 項技能`} />
          </View>
        </View>

        {/* 洞察列表 */}
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.45 }}>
          <BrainInsightCards
            maxVisible={10}
            title="AI 為你發現的事"
            hideWhenEmpty={false}
            onActionPress={(insight) => {
              aiOverlay.open({
                mode: 'chat',
                prompt: insight.actionSuggestion ?? insight.title,
                source: 'insight_action',
              });
            }}
            onCardPress={(insight) => {
              aiOverlay.open({
                mode: 'chat',
                prompt: `跟我說明：${insight.title}`,
                source: 'insight_detail',
              });
            }}
          />
          <View style={{ height: 12 }} />
        </ScrollView>

        {/* 底部 CTA — 打開對話 */}
        <Pressable
          onPress={() => aiOverlay.open({ mode: 'chat', source: 'insights_cta' })}
          style={({ pressed }) => ({
            margin: 16,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
            繼續和 AI 對話 →
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function StatPill({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: theme.colors.surface2,
      }}
    >
      <Ionicons name={icon} size={12} color={theme.colors.muted} />
      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

// ─── 3. Quick 模式：底部上拉快速命令 ─────────────────────
const QUICK_COMMANDS: Array<{
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  prompt: string;
  tint: string;
}> = [
  {
    id: 'today',
    icon: 'sunny-outline',
    label: '今天該做什麼？',
    prompt: '幫我看一下今天的待辦、課程跟提醒，告訴我接下來最該做哪一件事。',
    tint: '#F59E0B',
  },
  {
    id: 'lunch',
    icon: 'restaurant-outline',
    label: '中午吃什麼？',
    prompt: '推薦我今天的午餐，要考慮我的偏好跟過敏。',
    tint: '#EF4444',
  },
  {
    id: 'study',
    icon: 'book-outline',
    label: '我的學業狀況？',
    prompt: '我目前所有課程的進度跟成績狀況怎麼樣？有什麼風險嗎？',
    tint: '#3B82F6',
  },
  {
    id: 'schedule',
    icon: 'calendar-outline',
    label: '看看行事曆',
    prompt: '我這週還有什麼重要的事情？',
    tint: '#8B5CF6',
  },
  {
    id: 'find',
    icon: 'navigate-outline',
    label: '帶我去...',
    prompt: '我想找一個地方，幫我帶路。',
    tint: '#10B981',
  },
  {
    id: 'message',
    icon: 'mail-outline',
    label: '幫我寄訊息',
    prompt: '我想寄一封訊息給某個老師或同學，幫我擬稿。',
    tint: '#06B6D4',
  },
];

function QuickCommandOverlay() {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slide, {
        toValue: 0,
        tension: 60,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [slide, opacity]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: SCREEN_HEIGHT,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => aiOverlay.close());
  };

  return (
    <Animated.View pointerEvents="box-none" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', opacity }}>
      <Pressable
        onPress={handleClose}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 0,
        }}
      />
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1,
          paddingBottom: Math.max(insets.bottom + 12, 24),
          paddingTop: 12,
          paddingHorizontal: 16,
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          transform: [{ translateY: slide }],
          ...softShadowStyle({
            color: '#000',
            opacity: 0.25,
            radius: 20,
            offset: { width: 0, height: -6 },
            elevation: Platform.OS === 'android' ? 26 : 16,
          }),
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border,
            }}
          />
        </View>

        <Text
          style={{
            color: theme.colors.text,
            fontSize: 14,
            fontWeight: '700',
            paddingHorizontal: 6,
            paddingTop: 6,
            paddingBottom: 12,
          }}
        >
          ⚡ 快速命令
        </Text>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
            marginBottom: 12,
          }}
        >
          {QUICK_COMMANDS.map((cmd) => (
            <Pressable
              key={cmd.id}
              onPress={() => {
                Animated.parallel([
                  Animated.timing(slide, {
                    toValue: SCREEN_HEIGHT,
                    duration: 180,
                    useNativeDriver: true,
                  }),
                  Animated.timing(opacity, {
                    toValue: 0,
                    duration: 140,
                    useNativeDriver: true,
                  }),
                ]).start(() => {
                  aiOverlay.open({
                    mode: 'chat',
                    prompt: cmd.prompt,
                    source: `quick_${cmd.id}`,
                  });
                });
              }}
              style={({ pressed }) => ({
                width: '47%',
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: cmd.tint + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={cmd.icon} size={16} color={cmd.tint} />
              </View>
              <Text
                style={{
                  flex: 1,
                  color: theme.colors.text,
                  fontSize: 12,
                  fontWeight: '600',
                }}
                numberOfLines={2}
              >
                {cmd.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={() => {
            Animated.parallel([
              Animated.timing(slide, {
                toValue: SCREEN_HEIGHT,
                duration: 180,
                useNativeDriver: true,
              }),
              Animated.timing(opacity, {
                toValue: 0,
                duration: 140,
                useNativeDriver: true,
              }),
            ]).start(() => {
              aiOverlay.open({ mode: 'chat', source: 'quick_open_chat' });
            });
          }}
          style={({ pressed }) => ({
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
            marginBottom: 4,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
            打開對話
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default AIOverlayHost;
