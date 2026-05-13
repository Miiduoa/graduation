/**
 * AIFloatingBall — 4+1 架構的中央 AI 球
 * 若只改了球體樣式／漸層卻看不出差異：`pnpm run start:clean` 清 Metro cache 後再 Reload。
 * ═══════════════════════════════════════════════════════════════════════
 * 核心設計：
 * - 永遠存在於底部 Tab Bar 正中央，比兩側 Tab 略高、略大（Fitts's Law）
 * - 當 aiBrain 有未讀洞察時：球體脈動 + 紅點徽章
 * - 單擊 → 開啟全螢幕對話（AIChatOverlay）
 * - 長按 → 彈出快速命令面板（語音/拍照/快捷）
 * - 下拉小手勢 → 顯示「AI 知道的當下情境」+ 主動建議 3 條
 *
 * 心理學：
 * - Affordance：發光、會動 = 「這是活的、能跟你說話」
 * - Variable Reward：脈動代表「有新東西」，鼓勵點擊
 * - Reciprocity：AI 主動發現問題 → 使用者願意回應
 */
import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, Easing, Image, Pressable, Text, View } from 'react-native';
import { theme, softShadowStyle } from '../ui/theme';
import { aiBrain, type BrainInsight } from '../services/aiBrain';

/** brand asset for campus demo */
const AI_ORB_LOGO = require('../../assets/providence_ai_orb_logo.png');

export interface AIFloatingBallProps {
  size?: number;
  /** Maestro／自動化 id */
  testID?: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** 是否強調脈動（例如有新洞察） */
  hasUnreadInsights?: boolean;
  unreadCount?: number;
}

/**
 * 主動感知 aiBrain 的 insights 數量；不需要從外部傳。
 * 用 useState + subscribe，避免每幀重渲。
 */
function useUnreadInsights(): { count: number; criticalCount: number } {
  const [snapshot, setSnapshot] = React.useState(() => aiBrain.getSnapshot());

  useEffect(() => {
    const unsub = aiBrain.subscribe((next) => setSnapshot(next));
    return unsub;
  }, []);

  return useMemo(() => {
    const insights: BrainInsight[] = snapshot.insights ?? [];
    return {
      count: insights.length,
      criticalCount: insights.filter(
        (i) => i.severity === 'critical' || i.severity === 'danger',
      ).length,
    };
  }, [snapshot.insights]);
}

export function AIFloatingBall({
  size = 60,
  testID = 'ai-floating-ball',
  onPress,
  onLongPress,
  hasUnreadInsights: hasUnreadOverride,
  unreadCount: unreadOverride,
}: AIFloatingBallProps) {
  const { count, criticalCount } = useUnreadInsights();
  const hasUnread = hasUnreadOverride ?? count > 0;
  const displayCount = unreadOverride ?? count;
  const isUrgent = criticalCount > 0;

  // ─── 持續呼吸動畫（活著的感覺）─────────────────────────
  const breath = useRef(new Animated.Value(0)).current;
  // ─── 有洞察時的脈動光環 ────────────────────────────────
  const pulse = useRef(new Animated.Value(0)).current;
  // ─── 按壓回饋 ─────────────────────────────────────────
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    breathing.start();
    return () => breathing.stop();
  }, [breath]);

  useEffect(() => {
    if (!hasUnread) {
      pulse.setValue(0);
      return;
    }
    const looping = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    looping.start();
    return () => looping.stop();
  }, [hasUnread, pulse]);

  const breathScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.7],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0],
  });

  const ringSize = size + 8;
  const accentColor = isUrgent ? theme.colors.danger : theme.colors.accent;

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      pointerEvents="box-none"
    >
      {/* 脈動光環 */}
      {hasUnread ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            backgroundColor: accentColor,
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          }}
        />
      ) : null}

      {/* 主球體 */}
      <Pressable
        testID={testID}
        onPress={() => {
          Animated.sequence([
            Animated.timing(press, {
              toValue: 0.9,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.spring(press, {
              toValue: 1,
              friction: 4,
              useNativeDriver: true,
            }),
          ]).start();
          onPress();
        }}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel="AI 助理"
        accessibilityHint="點擊開啟對話、長按開啟快速命令"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          ...softShadowStyle({
            color:
              theme.mode === 'light' ? '#0F172A' : accentColor,
            opacity: theme.mode === 'light' ? 0.34 : 0.45,
            radius: theme.mode === 'light' ? 22 : 14,
            offset: { width: 0, height: theme.mode === 'light' ? 9 : 6 },
            elevation: theme.mode === 'light' ? 18 : 12,
          }),
        }}
      >
        {/* 淺色底：外圈強調品牌色，避免與白色 TabBar 溶在一起 */}
        {theme.mode === 'light' && !isUrgent ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: size + 4,
              height: size + 4,
              borderRadius: (size + 4) / 2,
              left: -2,
              top: -2,
              borderWidth: 2,
              borderColor: accentColor,
            }}
          />
        ) : null}
        {theme.mode === 'dark' ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: size + 4,
              height: size + 4,
              borderRadius: (size + 4) / 2,
              left: -2,
              top: -2,
              borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.26)',
            }}
          />
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: 'hidden',
            transform: [{ scale: Animated.multiply(breathScale, press) }],
            backgroundColor: theme.mode === 'light' ? '#FFFFFF' : theme.colors.surfaceElevated,
            borderWidth: theme.mode === 'light' ? 2.5 : 2,
            borderColor:
              theme.mode === 'light'
                ? accentColor
                : 'rgba(255,255,255,0.42)',
          }}
        >
          <View
            pointerEvents="none"
            style={{
              width: size,
              height: size,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={AI_ORB_LOGO}
              accessibilityIgnoresInvertColors
              resizeMode="contain"
              style={{
                width: size * 0.76,
                height: size * 0.76,
              }}
            />
          </View>
        </Animated.View>

        {/* 紅點徽章 */}
        {displayCount > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 4,
              borderRadius: 9,
              backgroundColor: isUrgent ? theme.colors.danger : theme.colors.streak,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.colors.chromeTabBar,
            }}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: 10, fontWeight: '800' }}>
              {displayCount > 9 ? '9+' : displayCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export default AIFloatingBall;
