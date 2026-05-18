/**
 * Cockpit Shell — 5 角色共用 UI primitives（高級現代簡約 v2）
 *
 * 設計理念（參考 Linear / Notion / iOS 17 Reminders / Apple Health）：
 *  - **層次** typography 而非顏色：display → h2 → body → caption
 *  - **微互動**：press 時 scale + opacity 雙效
 *  - **留白優先**：section 間 spacing 大、card padding 多
 *  - **顏色克制**：accent 一個、其他都 surface / muted 灰階
 *  - **邊框** 1px hairline，不用粗框
 *  - **圓角** 一致用 theme.radius.md / lg
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './theme';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';

// ─────────────────────────────────────────────────────────
// Hero — 大字 + 細 eyebrow + 摘要
// ─────────────────────────────────────────────────────────

export function CockpitHero(props: {
  eyebrow: string;
  title: string;
  summary?: string;
}) {
  return (
    <View style={{ marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          marginBottom: theme.space.md,
        }}
      >
        <HeaderAvatarButton size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize: theme.typography.labelSmall.fontSize,
              lineHeight: theme.typography.labelSmall.lineHeight,
              fontWeight: '700',
              letterSpacing: theme.typography.labelSmall.letterSpacing,
              color: theme.colors.muted,
            }}
            numberOfLines={1}
          >
            {props.eyebrow}
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.bodySmall.fontSize,
              lineHeight: theme.typography.bodySmall.lineHeight,
              marginTop: 1,
            }}
            numberOfLines={1}
          >
            AI-first 工作台
          </Text>
        </View>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles-outline" size={18} color={theme.colors.accent} />
        </View>
      </View>
      <View
        style={{
          padding: theme.space.lg,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderLeftWidth: 4,
          borderLeftColor: theme.colors.accent,
        }}
      >
        <Text
          style={{
            color: theme.colors.accent,
            fontSize: theme.typography.overline.fontSize,
            lineHeight: theme.typography.overline.lineHeight,
            fontWeight: theme.typography.overline.fontWeight ?? '700',
            letterSpacing: theme.typography.overline.letterSpacing,
          }}
        >
          AI 下一步
        </Text>
      <Text
        style={{
          fontSize: theme.typography.hero?.fontSize ?? theme.typography.display.fontSize,
          lineHeight: theme.typography.hero?.lineHeight ?? theme.typography.display.lineHeight,
          letterSpacing: theme.typography.hero?.letterSpacing ?? theme.typography.display.letterSpacing,
          fontWeight: '800',
          color: theme.colors.text,
          marginTop: theme.space.xs,
        }}
        numberOfLines={3}
      >
        {props.title}
      </Text>
      {props.summary ? (
        <Text
          style={{
            fontSize: theme.typography.body.fontSize,
            lineHeight: theme.typography.body.lineHeight,
            color: theme.colors.textSecondary,
            marginTop: theme.space.sm + 2,
          }}
          numberOfLines={4}
        >
          {props.summary}
        </Text>
      ) : null}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Metric Row — 玻璃感卡片
// ─────────────────────────────────────────────────────────

export function CockpitMetricRow(props: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.space.sm,
        marginBottom: theme.space.lg,
      }}
    >
      {props.children}
    </View>
  );
}

export function CockpitMetricChip(props: {
  label: string;
  value: number | string;
  tone?: 'danger' | 'warn' | 'success';
}) {
  const tint =
    props.tone === 'danger' ? theme.colors.danger
    : props.tone === 'warn' ? theme.colors.warning
    : props.tone === 'success' ? theme.colors.success
    : theme.colors.text;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 132,
        minHeight: 82,
        paddingVertical: theme.space.md,
        paddingHorizontal: theme.space.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        justifyContent: 'space-between',
      }}
    >
      <Text
        style={{
          fontSize: theme.typography.h1.fontSize,
          lineHeight: theme.typography.h1.lineHeight,
          letterSpacing: theme.typography.h1.letterSpacing ?? 0,
          fontWeight: '700',
          color: tint,
        }}
        numberOfLines={1}
      >
        {props.value}
      </Text>
      <Text
        style={{
          fontSize: theme.typography.labelSmall.fontSize,
          lineHeight: theme.typography.labelSmall.lineHeight,
          color: theme.colors.muted,
          marginTop: 4,
          letterSpacing: 0,
        }}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Section — 細分隔線、大 touch target、smooth chevron
// ─────────────────────────────────────────────────────────

export function CockpitSection(props: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        marginBottom: theme.space.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={props.onToggle}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: theme.space.md,
          paddingHorizontal: theme.space.md,
          opacity: pressed ? 0.55 : 1,
        })}
      >
        <Text
          style={{
            fontSize: theme.typography.h3.fontSize,
            lineHeight: theme.typography.h3.lineHeight,
            fontWeight: '600',
            color: theme.colors.text,
            letterSpacing: 0,
          }}
          numberOfLines={1}
        >
          {props.label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          {props.count !== undefined && (
            <View
              style={{
                paddingHorizontal: theme.space.xs + 2,
                paddingVertical: 2,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.surfaceMuted,
                minWidth: 22,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: theme.typography.labelSmall.fontSize,
                  color: theme.colors.muted,
                  fontWeight: '600',
                }}
              >
                {props.count}
              </Text>
            </View>
          )}
          <Ionicons
            name={props.open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={theme.colors.muted}
          />
        </View>
      </Pressable>
      {props.open && (
        <View
          style={{
            paddingHorizontal: theme.space.md,
            paddingBottom: theme.space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.separator,
          }}
        >
          {props.children}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Row — 列表 item，hairline divider 風格
// ─────────────────────────────────────────────────────────

export function CockpitRow(props: {
  icon?: string;
  title: string;
  subtitle?: string;
  tone?: 'danger' | 'warn' | 'success';
  rightSlot?: React.ReactNode;
  onPress?: () => void;
}) {
  const subtitleTint =
    props.tone === 'danger' ? theme.colors.danger
    : props.tone === 'warn' ? theme.colors.warning
    : props.tone === 'success' ? theme.colors.success
    : theme.colors.muted;
  const Inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 58,
        paddingVertical: theme.space.sm,
        gap: theme.space.sm,
      }}
    >
      {props.icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontSize: 16 }}>{props.icon}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: theme.typography.body.fontSize,
            lineHeight: theme.typography.body.lineHeight,
            color: theme.colors.text,
            fontWeight: '500',
            letterSpacing: 0,
          }}
          numberOfLines={2}
        >
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text
            style={{
              fontSize: theme.typography.bodySmall.fontSize,
              lineHeight: theme.typography.bodySmall.lineHeight,
              color: subtitleTint,
              marginTop: 2,
            }}
            numberOfLines={2}
          >
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.rightSlot}
      {props.onPress && !props.rightSlot && (
        <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
      )}
    </View>
  );
  if (props.onPress) {
    return (
      <Pressable
        onPress={props.onPress}
        style={({ pressed }) => ({
          opacity: pressed ? 0.55 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        })}
      >
        {Inner}
      </Pressable>
    );
  }
  return Inner;
}

// ─────────────────────────────────────────────────────────
// Tool Chip — 圓角 capsule + 微互動
// ─────────────────────────────────────────────────────────

export function CockpitToolChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: theme.space.xs + 6,
        paddingHorizontal: theme.space.sm + 4,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Ionicons name={props.icon} size={14} color={theme.colors.text} />
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.typography.bodySmall.fontSize,
          fontWeight: '600',
          letterSpacing: 0,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────
// Accent CTA Card — 焦點黑卡，現代簡約風
// ─────────────────────────────────────────────────────────

export function CockpitAccentCard(props: {
  eyebrow?: string;
  title: string;
  meta?: string;
  ctaLabel?: string;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => ({
        padding: theme.space.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.mode === 'dark' ? theme.colors.surfaceElevated : theme.colors.accent,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        marginBottom: theme.space.lg,
      })}
    >
      {props.eyebrow ? (
        <Text
          style={{
            color: theme.colors.onAccent,
            opacity: 0.55,
            fontSize: theme.typography.labelSmall.fontSize,
            fontWeight: '500',
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          {props.eyebrow}
        </Text>
      ) : null}
      <Text
        style={{
          color: theme.colors.onAccent,
          fontSize: theme.typography.h2.fontSize,
          lineHeight: theme.typography.h2.lineHeight,
          fontWeight: '700',
          marginTop: theme.space.xs + 2,
          letterSpacing: 0,
        }}
        numberOfLines={2}
      >
        {props.title}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: theme.space.md,
        }}
      >
        {props.meta ? (
          <Text
            style={{
          color: theme.colors.onAccent,
              opacity: 0.55,
              fontSize: theme.typography.bodySmall.fontSize,
            }}
          >
            {props.meta}
          </Text>
        ) : <View />}
        {props.ctaLabel && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.space.sm + 4,
              paddingVertical: theme.space.xs + 4,
              borderRadius: theme.radius.full,
              backgroundColor: theme.mode === 'dark' ? theme.colors.accent : theme.colors.surface,
            }}
          >
            {props.ctaIcon && <Ionicons name={props.ctaIcon} size={12} color={theme.colors.accent} />}
            <Text
              style={{
                color: theme.colors.accent,
                fontSize: theme.typography.bodySmall.fontSize,
                fontWeight: '700',
                letterSpacing: 0,
              }}
            >
              {props.ctaLabel}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
