/**
 * 課程卡 chip 進階頁共用殼層 — 對齊 LearnStack 8 chip 視覺與載入／錯誤節奏
 * （不依賴新套件；使用既有 theme／LoadingState）
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './theme';
import { useThemeVersion } from './useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from './navigationTheme';
import { LoadingState } from './components';

export const courseChipScrollBottomInset = TAB_BAR_CONTENT_BOTTOM_PADDING;

export function courseChipScrollContentStyle(withBottomInset = true) {
  return {
    paddingHorizontal: theme.layout.screenHorizontalPadding,
    paddingTop: theme.space.md,
    paddingBottom: withBottomInset ? TAB_BAR_CONTENT_BOTTOM_PADDING : theme.space.xl,
  };
}

/** 全螢幕載入狀態：以共用 LoadingState 呈現單一忙碌狀態與列表骨架 */
export function CourseChipLoading(props: {
  title: string;
  subtitle?: string;
  accessibilityHint?: string;
}) {
  useThemeVersion();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        backgroundColor: theme.colors.bg,
        paddingHorizontal: theme.layout.screenHorizontalPadding,
        paddingBottom: theme.space.xxl,
      }}
    >
      <LoadingState
        title={props.title}
        subtitle={props.subtitle}
        hint={props.accessibilityHint}
        rows={3}
      />
    </View>
  );
}

/** 標題優先；`emoji` 保留給既有呼叫端，不再顯示。 */
export function CourseChipHeader(props: {
  emoji: string;
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  useThemeVersion();
  const detail = [props.eyebrow, props.meta].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: theme.space.xs, marginBottom: theme.space.md }} accessibilityRole="header">
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 22,
          fontWeight: '700',
          lineHeight: 28,
        }}
      >
        {props.title}
      </Text>
      {detail ? (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Demo 課程專用標示 — 置於課程 chip 進階頁頂部一隅 */
export function CourseDemoDataRibbon() {
  useThemeVersion();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.muted,
      }}
      accessibilityRole="text"
      accessibilityLabel="Demo 資料"
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary }}>
        Demo 資料
      </Text>
    </View>
  );
}

/** 列表／參數缺漏時的空狀態：平面區塊，以細線分隔 */
export function CourseChipEmpty(props: {
  title: string;
  body: string;
  primaryLabel?: string;
  onPrimary?: () => void;
}) {
  useThemeVersion();
  return (
    <View
      style={{
        marginTop: theme.space.lg,
        paddingTop: theme.space.lg,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        gap: theme.space.sm,
      }}
      accessibilityRole="summary"
    >
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600', lineHeight: 23 }}>
        {props.title}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
        {props.body}
      </Text>
      {props.primaryLabel && props.onPrimary ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.primaryLabel}
          onPress={props.onPrimary}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            minHeight: 44,
            justifyContent: 'center',
            marginTop: theme.space.xs,
            paddingVertical: theme.space.sm,
            paddingHorizontal: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.onAccent, fontWeight: '600', fontSize: 14 }}>
            {props.primaryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CourseChipErrorBanner(props: { message: string; onRetry?: () => void }) {
  useThemeVersion();
  return (
    <View
      style={{
        marginTop: theme.space.md,
        paddingVertical: theme.space.md,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.danger,
        gap: theme.space.sm,
      }}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm }}>
        <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
        <Text
          style={{
            flex: 1,
            color: theme.colors.danger,
            fontSize: 14,
            lineHeight: 21,
          }}
        >
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
            borderWidth: 1,
            borderColor: theme.colors.muted,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}>
            重新整理
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
