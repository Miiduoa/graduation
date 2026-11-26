/** 各角色工作台共用的標題、統計與操作元件。 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './theme';
import { pageTitleFont } from './styles';
import { useThemeVersion } from './useThemeStyleSheet';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';

// ─────────────────────────────────────────────────────────
// Hero — 大字 + 細 eyebrow + 摘要
// ─────────────────────────────────────────────────────────

export function CockpitHero(props: { eyebrow: string; title: string; summary?: string }) {
  useThemeVersion();
  return (
    <View style={{ marginBottom: theme.space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          {props.eyebrow && props.eyebrow !== props.title ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{props.eyebrow}</Text>
          ) : null}
          <Text accessibilityRole="header" style={{
            color: theme.colors.text, fontFamily: pageTitleFont, fontSize: 28, fontWeight: '600',
          }}>
            {props.title}
          </Text>
        </View>
        <HeaderAvatarButton size={40} />
      </View>
      {props.summary ? (
        <Text style={{ color: theme.colors.textSecondary, marginTop: 8, fontSize: 15, lineHeight: 22 }}>
          {props.summary}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Metric Row — 精簡數字列
// ─────────────────────────────────────────────────────────

export function CockpitMetricRow(props: { children: React.ReactNode }) {
  useThemeVersion();
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
  useThemeVersion();
  const tint =
    props.tone === 'danger'
      ? theme.colors.danger
      : props.tone === 'warn'
        ? theme.colors.warning
        : props.tone === 'success'
          ? theme.colors.success
          : theme.colors.text;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 128,
        minHeight: 72,
        paddingVertical: 12,
        paddingHorizontal: 14,
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
          fontVariant: ['tabular-nums'],
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
// Section — 細分隔線、大 touch target、收合節奏
// ─────────────────────────────────────────────────────────

export function CockpitSection(props: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  useThemeVersion();
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
        accessibilityRole="button"
        accessibilityLabel={props.label}
        accessibilityState={{ expanded: props.open }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 48,
          paddingVertical: 13,
          paddingHorizontal: theme.space.md,
          backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
        })}
      >
        <Text
          style={{
            fontSize: theme.typography.h3.fontSize,
            lineHeight: theme.typography.h3.lineHeight,
            fontWeight: '600',
            color: theme.colors.text,
            letterSpacing: theme.typography.h3.letterSpacing,
          }}
          numberOfLines={1}
        >
          {props.label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          {props.count !== undefined && (
            <Text
              style={{
                fontSize: theme.typography.labelSmall.fontSize,
                color: theme.colors.muted,
                fontWeight: '600',
                fontVariant: ['tabular-nums'],
              }}
            >
              {props.count}
            </Text>
          )}
          <Ionicons
            name={props.open ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={theme.colors.muted}
          />
        </View>
      </Pressable>
      {props.open && (
        <View
          style={{
            paddingHorizontal: theme.space.md,
            paddingBottom: theme.space.xs,
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
// Row — 扁平列表列，文字對齊細線分隔
// ─────────────────────────────────────────────────────────

export function CockpitRow(props: {
  icon?: string;
  title: string;
  subtitle?: string;
  tone?: 'danger' | 'warn' | 'success';
  rightSlot?: React.ReactNode;
  onPress?: () => void;
}) {
  useThemeVersion();
  const subtitleTint =
    props.tone === 'danger'
      ? theme.colors.danger
      : props.tone === 'warn'
        ? theme.colors.warning
        : props.tone === 'success'
          ? theme.colors.success
          : theme.colors.muted;
  const Inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingVertical: 11,
        gap: 10,
      }}
    >
      {props.icon ? (
        <View style={{ width: 22, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 15 }}>{props.icon}</Text>
        </View>
      ) : null}
      <View
        style={{
          flex: 1,
          minWidth: 0,
        }}
      >
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
        <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
      )}
    </View>
  );
  if (props.onPress) {
    return (
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          opacity: pressed ? 0.65 : 1,
        })}
      >
        {Inner}
      </Pressable>
    );
  }
  return Inner;
}

// ─────────────────────────────────────────────────────────
// Tool Chip — 中性平面工具鍵
// ─────────────────────────────────────────────────────────

export function CockpitToolChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 13,
        borderRadius: theme.radius.md,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
      })}
    >
      <Ionicons name={props.icon} size={15} color={theme.colors.textSecondary} />
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
// Accent CTA Card — 深林主焦點卡
// ─────────────────────────────────────────────────────────

export function CockpitAccentCard(props: {
  eyebrow?: string;
  title: string;
  meta?: string;
  ctaLabel?: string;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityLabel={[props.eyebrow, props.title, props.meta, props.ctaLabel]
        .filter(Boolean)
        .join('，')}
      disabled={!props.onPress}
      accessibilityRole={props.onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.accent,
        opacity: pressed ? 0.9 : 1,
        marginBottom: theme.space.lg,
      })}
    >
      {props.eyebrow ? (
        <Text
          style={{
            color: theme.colors.onAccent,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: '600',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            opacity: 0.85,
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
          marginTop: props.eyebrow ? 4 : 0,
          letterSpacing: theme.typography.h2.letterSpacing,
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
          marginTop: 14,
          gap: 10,
        }}
      >
        {props.meta ? (
          <Text
            style={{
              color: theme.colors.onAccent,
              fontSize: theme.typography.bodySmall.fontSize,
              opacity: 0.9,
            }}
          >
            {props.meta}
          </Text>
        ) : (
          <View />
        )}
        {props.ctaLabel && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
            }}
          >
            {props.ctaIcon && (
              <Ionicons name={props.ctaIcon} size={13} color={theme.colors.accent} />
            )}
            <Text
              style={{
                color: theme.colors.accent,
                fontSize: theme.typography.bodySmall.fontSize,
                fontWeight: '600',
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
