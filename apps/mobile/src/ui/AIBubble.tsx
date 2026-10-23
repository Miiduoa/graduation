/* eslint-disable */
/** 可關閉的情境提示，保留既有元件名稱供畫面匯入。 */

import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from './theme';
import { useThemeVersion } from './useThemeStyleSheet';

export type AIBubbleContext =
  | 'grades' // 成績頁面 → 「想知道怎麼提高這科成績嗎？」
  | 'attendance' // 出席頁面 → 「幫你計算需要出席幾次」
  | 'course' // 課程頁面 → 「解釋這個單元的核心概念」
  | 'quiz' // 測驗頁面 → 「生成練習題幫你複習」
  | 'deadline' // 截止日期 → 「幫你安排完成時間表」
  | 'custom'; // 自定義

const CONTEXT_MESSAGES: Record<AIBubbleContext, { icon: string; message: string; cta: string }> = {
  grades: {
    icon: 'trending-up',
    message: '想了解如何提高成績嗎？',
    cta: '查看分析',
  },
  attendance: {
    icon: 'calculator',
    message: '幫你算出最少需要出席幾次',
    cta: '立即計算',
  },
  course: {
    icon: 'bulb',
    message: '需要解釋這個單元的重點？',
    cta: '詢問助理',
  },
  quiz: {
    icon: 'help-circle',
    message: '用練習題複習這個單元',
    cta: '開始練習',
  },
  deadline: {
    icon: 'calendar',
    message: '依截止時間安排進度',
    cta: '規劃一下',
  },
  custom: {
    icon: 'chatbubble-outline',
    message: '需要整理資料或釐清問題？',
    cta: '詢問助理',
  },
};

type AIBubbleProps = {
  context: AIBubbleContext;
  customMessage?: string;
  customCta?: string;
  onPress: () => void;
  onDismiss?: () => void;
  delay?: number; // 出現的延遲毫秒（讓用戶先瀏覽頁面）
  style?: object;
};

export function AIBubble({
  context,
  customMessage,
  customCta,
  onPress,
  onDismiss,
  delay = 1500,
  style,
}: AIBubbleProps) {
  useThemeVersion();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const slideAnim = useRef(new Animated.Value(16)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.94)).current;

  const info = CONTEXT_MESSAGES[context];
  const message = customMessage ?? info.message;
  const cta = customCta ?? info.cta;

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 380,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 8 }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 16, duration: 250, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setDismissed(true);
      onDismiss?.();
    });
  };

  if (!visible || dismissed) return null;

  return (
    <Animated.View
      style={[
        {
          opacity: opacityAnim,
          transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.accentSoft,
          borderWidth: 1,
          borderColor: `${theme.colors.accent}20`,
          shadowColor: theme.colors.accent,
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        }}
      >
        {/* AI 圖示 */}
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Ionicons name={info.icon as any} size={18} color={theme.colors.onAccent} />
        </View>

        {/* 訊息文字 */}
        <Text
          style={{
            flex: 1,
            color: theme.colors.text,
            fontSize: 13,
            fontWeight: '500',
            lineHeight: 18,
          }}
        >
          {message}
        </Text>

        {/* CTA 按鈕 */}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={cta}
          style={({ pressed }) => ({
            paddingHorizontal: 12,
            paddingVertical: 7,
            minHeight: 44,
            justifyContent: 'center',
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.onAccent, fontSize: 12, fontWeight: '700' }}>
            {cta}
          </Text>
        </Pressable>

        {/* 關閉按鈕 */}
        <Pressable
          onPress={handleDismiss}
          hitSlop={8}
          style={{ padding: 2 }}
          accessibilityRole="button"
          accessibilityLabel="關閉提示"
        >
          <Ionicons name="close" size={16} color={theme.colors.muted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * useAIBubbleVisible — 管理 AI Bubble 可見性
 * 避免在同一 session 重複顯示相同場景的提示
 */
export function useAIBubbleVisible(key: string, cooldownMs = 3600000): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const lastShown = (global as any)[`_ai_bubble_${key}`] ?? 0;
    if (Date.now() - lastShown > cooldownMs) {
      setVisible(true);
      (global as any)[`_ai_bubble_${key}`] = Date.now();
    }
  }, [key, cooldownMs]);

  return visible;
}
