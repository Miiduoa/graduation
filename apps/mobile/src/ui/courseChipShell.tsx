/**
 * 課程卡 chip 進階頁共用殼層 — 對齊 LearnStack 8 chip 視覺與載入／錯誤節奏
 * （不依賴新套件；使用既有 theme／Spinner／Skeleton）
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from './navigationTheme';
import { Spinner, Skeleton } from './components';

export const courseChipScrollBottomInset = TAB_BAR_CONTENT_BOTTOM_PADDING;

export function courseChipScrollContentStyle(withBottomInset = true) {
  return {
    paddingHorizontal: theme.layout.screenHorizontalPadding,
    paddingTop: theme.space.md,
    paddingBottom: withBottomInset ? TAB_BAR_CONTENT_BOTTOM_PADDING : theme.space.xl,
  };
}

/** 全螢幕載入：中央訊息 + 列表骨架，Demo 口述時体感較接近「資料已就位」 */
export function CourseChipLoading(props: {
  title: string;
  subtitle?: string;
  accessibilityHint?: string;
}) {
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      accessibilityLabel={props.title}
      accessibilityHint={props.accessibilityHint}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingBottom: theme.space.xxl,
        }}
      >
        <View style={{ alignItems: 'center', gap: theme.space.md, marginBottom: theme.space.xl }}>
          <Spinner size={36} />
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 17,
              fontWeight: '600',
              textAlign: 'center',
              letterSpacing: -0.2,
            }}
          >
            {props.title}
          </Text>
          {props.subtitle ? (
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 13,
                textAlign: 'center',
                lineHeight: 20,
              }}
            >
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {[0, 1, 2].map((i) => (
          <View key={`sk-${i}`} style={{ marginBottom: theme.space.sm }}>
            <Skeleton height={72} borderRadius={theme.radius.lg} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function CourseChipHeader(props: {
  emoji: string;
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <View style={{ gap: theme.space.xs, marginBottom: theme.space.md }} accessibilityRole="header">
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.35,
        }}
      >
        {props.emoji} {props.eyebrow}
      </Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 22,
          fontWeight: '800',
          letterSpacing: -0.6,
          lineHeight: 28,
        }}
      >
        {props.title}
      </Text>
      {props.meta ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{props.meta}</Text>
      ) : null}
    </View>
  );
}

/** Demo 課程專用標章 — 置於課程 chip 進階頁頂部一隅 */
export function CourseDemoDataRibbon() {
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        backgroundColor: theme.colors.accentSoft,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: `${theme.colors.primary}44`,
      }}
      accessibilityRole="text"
      accessibilityLabel="Demo 資料"
    >
      <Text style={{ fontSize: 12, fontWeight: '800', color: theme.colors.primary }}>Demo 資料</Text>
    </View>
  );
}

export function CourseChipErrorBanner(props: { message: string; onRetry?: () => void }) {
  return (
    <View
      style={{
        marginTop: theme.space.md,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.dangerSoft,
        gap: theme.space.sm,
        borderWidth: 1,
        borderColor: `${theme.colors.danger}33`,
      }}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm }}>
        <Ionicons name="alert-circle" size={22} color={theme.colors.danger} />
        <Text style={{ flex: 1, color: theme.colors.danger, fontSize: 14, lineHeight: 21, fontWeight: '500' }}>
          {props.message}
        </Text>
      </View>
      {props.onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新整理"
          onPress={props.onRetry}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            minHeight: 44,
            justifyContent: 'center',
            paddingVertical: theme.space.sm,
            paddingHorizontal: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 14 }}>
            重新整理
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
