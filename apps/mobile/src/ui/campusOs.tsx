import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AmbientCueSignalType } from '../data/types';
import { theme } from './theme';
import { useThemeVersion } from './useThemeStyleSheet';

type IconName = keyof typeof Ionicons.glyphMap;

function getAmbientCuePalette(signalType: AmbientCueSignalType) {
  switch (signalType) {
    case 'attendance_momentum':
      return {
        fg: theme.colors.fresh,
        bg: theme.colors.freshSoft,
        border: theme.colors.border,
        icon: 'pulse-outline' as IconName,
      };
    case 'teaching_review':
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: theme.colors.border,
        icon: 'checkmark-circle-outline' as IconName,
      };
    case 'leaderboard_momentum':
      return {
        fg: theme.colors.success,
        bg: theme.colors.successSoft,
        border: theme.colors.border,
        icon: 'trophy-outline' as IconName,
      };
    case 'campus_popularity':
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: theme.colors.border,
        icon: 'people-outline' as IconName,
      };
    case 'approval_backlog':
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: theme.colors.border,
        icon: 'layers-outline' as IconName,
      };
    case 'admin_activity':
      return {
        fg: theme.colors.roleAdmin,
        bg: theme.colors.roleAdminSoft,
        border: theme.colors.border,
        icon: 'sparkles-outline' as IconName,
      };
    case 'course_completion':
    default:
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: theme.colors.border,
        icon: 'trending-up-outline' as IconName,
      };
  }
}

export function ContextStrip(props: {
  eyebrow: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  useThemeVersion();
  return (
    <View
      style={{
        paddingVertical: theme.space.md,
        paddingHorizontal: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        gap: theme.space.xs,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: theme.space.md,
        }}
      >
        <View style={{ flex: 1, gap: theme.space.xxs }}>
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: theme.typography.overline.fontSize,
              lineHeight: theme.typography.overline.lineHeight,
              fontWeight: theme.typography.overline.fontWeight ?? '600',
              letterSpacing: theme.typography.overline.letterSpacing ?? 0.6,
              textTransform: 'uppercase',
            }}
          >
            {props.eyebrow}
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.h2.fontSize,
              lineHeight: theme.typography.h2.lineHeight,
              fontWeight: theme.typography.h2.fontWeight ?? '600',
              letterSpacing: theme.typography.h2.letterSpacing,
            }}
          >
            {props.title}
          </Text>
          {props.description ? (
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.bodySmall.fontSize,
                lineHeight: theme.typography.bodySmall.lineHeight,
                marginTop: 2,
              }}
            >
              {props.description}
            </Text>
          ) : null}
        </View>
        {props.right}
      </View>
    </View>
  );
}

export function ConfidenceBadge(props: {
  state: 'high' | 'medium' | 'low' | 'live';
  label: string;
}) {
  useThemeVersion();
  const colors =
    props.state === 'high'
      ? { bg: theme.colors.successSoft, fg: theme.colors.success }
      : props.state === 'medium'
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.state === 'live'
          ? { bg: theme.colors.freshSoft, fg: theme.colors.fresh }
          : { bg: theme.colors.dangerSoft, fg: theme.colors.danger };

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: theme.radius.sm,
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: '600', letterSpacing: 0.1 }}>
        {props.label}
      </Text>
    </View>
  );
}

// Primary task card
export function HeroActionCard(props: {
  icon: IconName;
  eyebrow: string;
  title: string;
  description?: string;
  meta?: string;
  tone?: 'accent' | 'warning' | 'success' | 'danger';
  actionLabel?: string;
  onPress?: () => void;
}) {
  useThemeVersion();
  const tone = props.tone ?? 'accent';
  const fg = theme.colors[tone];

  const content = (
    <View
      style={{
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
        borderLeftColor: fg,
        gap: 10,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Ionicons name={props.icon} size={15} color={fg} />
          <Text
            style={{
              color: fg,
              fontSize: theme.typography.overline.fontSize,
              lineHeight: theme.typography.overline.lineHeight,
              fontWeight: '600',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
            numberOfLines={1}
          >
            {props.eyebrow}
          </Text>
        </View>
        {props.meta ? <ConfidenceBadge state="live" label={props.meta} /> : null}
      </View>

      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.h1.fontSize,
            fontWeight: '700',
            letterSpacing: theme.typography.h1.letterSpacing,
            lineHeight: theme.typography.h1.lineHeight,
          }}
        >
          {props.title}
        </Text>
        {props.description && (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.typography.bodySmall.fontSize,
              lineHeight: theme.typography.bodySmall.lineHeight,
            }}
          >
            {props.description}
          </Text>
        )}
      </View>

      {props.actionLabel ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingTop: 6,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.separator,
          }}
        >
          <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>{props.actionLabel}</Text>
          <Ionicons name="arrow-forward" size={14} color={fg} />
        </View>
      ) : null}
    </View>
  );

  if (!props.onPress) return content;

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityLabel={[
        props.eyebrow,
        props.title,
        props.description,
        props.meta,
        props.actionLabel,
      ]
        .filter(Boolean)
        .join('，')}
      accessibilityRole="button"
      style={({ pressed }) => ({
        opacity: pressed ? 0.78 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}

// Timeline card
export function TimelineCard(props: {
  icon: IconName;
  title: string;
  description?: string;
  meta?: string;
  hint?: string;
  tint?: string;
  onPress?: () => void;
}) {
  useThemeVersion();
  const tint = props.tint ?? theme.colors.accent;
  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      accessibilityLabel={[props.title, props.description, props.meta, props.hint]
        .filter(Boolean)
        .join('，')}
      accessibilityRole={props.onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        paddingVertical: 13,
        paddingHorizontal: 14,
        borderRadius: theme.radius.md,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        gap: 6,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 }}>
          <View style={{ width: 22, paddingTop: 2, alignItems: 'center' }}>
            <Ionicons name={props.icon} size={17} color={tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.h3.fontSize,
                lineHeight: theme.typography.h3.lineHeight,
                fontWeight: '600',
              }}
            >
              {props.title}
            </Text>
            {props.description && (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.typography.bodySmall.fontSize,
                  lineHeight: theme.typography.bodySmall.lineHeight,
                  marginTop: 2,
                }}
              >
                {props.description}
              </Text>
            )}
          </View>
        </View>
        {props.meta ? (
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 12,
              fontWeight: '600',
              paddingTop: 2,
              fontVariant: ['tabular-nums'],
            }}
          >
            {props.meta}
          </Text>
        ) : null}
      </View>
      {props.hint ? (
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 12,
            lineHeight: 17,
            paddingLeft: 32,
          }}
        >
          {props.hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function ActionableInboxRow(props: {
  icon: IconName;
  title: string;
  reason: string;
  consequence: string;
  nextStep: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  actionLabel: string;
  onPress: () => void;
}) {
  useThemeVersion();
  const palette =
    props.urgency === 'critical'
      ? { fg: theme.colors.danger }
      : props.urgency === 'high'
        ? { fg: theme.colors.warning }
        : props.urgency === 'medium'
          ? { fg: theme.colors.accent }
          : { fg: theme.colors.info };

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityLabel={[
        props.title,
        props.reason,
        props.consequence,
        props.nextStep,
        props.actionLabel,
      ]
        .filter(Boolean)
        .join('，')}
      accessibilityRole="button"
      style={({ pressed }) => ({
        padding: 15,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 10,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
          <View style={{ width: 22, paddingTop: 2, alignItems: 'center' }}>
            <Ionicons name={props.icon} size={17} color={palette.fg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.h3.fontSize,
                lineHeight: theme.typography.h3.lineHeight,
                fontWeight: '600',
              }}
            >
              {props.title}
            </Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.bodySmall.fontSize,
                lineHeight: theme.typography.bodySmall.lineHeight,
              }}
            >
              {props.reason}
            </Text>
          </View>
        </View>
        <ConfidenceBadge
          state={props.urgency === 'low' ? 'medium' : props.urgency === 'critical' ? 'low' : 'high'}
          label={
            props.urgency === 'critical'
              ? '先做'
              : props.urgency === 'high'
                ? '今天'
                : props.urgency === 'medium'
                  ? '接著做'
                  : '可安排'
          }
        />
      </View>

      <View
        style={{
          marginLeft: 32,
          paddingTop: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.separator,
          gap: 3,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '500' }}>
          影響：{props.consequence}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 17 }}>
          下一步：{props.nextStep}
        </Text>
      </View>

      <View
        style={{
          marginLeft: 32,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingTop: 2,
        }}
      >
        <Text style={{ color: palette.fg, fontSize: 13, fontWeight: '600' }}>
          {props.actionLabel}
        </Text>
        <Ionicons name="arrow-forward" size={13} color={palette.fg} />
      </View>
    </Pressable>
  );
}

// ─── Ambient Cue Card ───────────────────────────────────
export function AmbientCueCard(props: {
  signalType: AmbientCueSignalType;
  headline: string;
  body?: string;
  actionLabel: string;
  metric?: string;
  onPress?: () => void;
  onDismiss?: () => void;
}) {
  useThemeVersion();
  const palette = getAmbientCuePalette(props.signalType);

  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      accessibilityLabel={[props.headline, props.body, props.metric, props.actionLabel]
        .filter(Boolean)
        .join('，')}
      accessibilityRole={props.onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        padding: 15,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: 1,
        borderColor: palette.border,
        gap: 10,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 22, paddingTop: 2, alignItems: 'center' }}>
          <Ionicons name={palette.icon} size={17} color={palette.fg} />
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.h3.fontSize,
              fontWeight: '600',
              lineHeight: theme.typography.h3.lineHeight,
            }}
          >
            {props.headline}
          </Text>
          {props.body && (
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.typography.bodySmall.fontSize,
                lineHeight: theme.typography.bodySmall.lineHeight,
              }}
            >
              {props.body}
            </Text>
          )}
        </View>

        {props.onDismiss ? (
          <Pressable
            onPress={props.onDismiss}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="關閉提示"
            style={{ padding: 4 }}
          >
            <Ionicons name="close" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          marginLeft: 32,
          paddingTop: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.separator,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {props.metric ? (
          <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
            {props.metric}
          </Text>
        ) : (
          <View />
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: palette.fg, fontSize: 13, fontWeight: '600' }}>
            {props.actionLabel}
          </Text>
          <Ionicons name="arrow-forward" size={13} color={palette.fg} />
        </View>
      </View>
    </Pressable>
  );
}

export function RoleCtaCard(props: {
  icon: IconName;
  title: string;
  description?: string;
  roleLabel: string;
  tone: 'student' | 'teacher' | 'admin';
  actionLabel: string;
  onPress: () => void;
}) {
  useThemeVersion();
  const role =
    props.tone === 'admin' ? 'roleAdmin' : props.tone === 'teacher' ? 'roleTeacher' : 'roleStudent';
  const fg = theme.colors[role];

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityLabel={[props.roleLabel, props.title, props.description, props.actionLabel]
        .filter(Boolean)
        .join('，')}
      accessibilityRole="button"
      style={({ pressed }) => ({
        padding: 16,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
        borderLeftColor: fg,
        gap: 10,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={props.icon} size={16} color={fg} />
        <Text
          style={{
            color: fg,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: '600',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}
        >
          {props.roleLabel}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.h2.fontSize,
            lineHeight: theme.typography.h2.lineHeight,
            fontWeight: '600',
          }}
        >
          {props.title}
        </Text>
        {props.description && (
          <Text
            style={{
              color: theme.colors.textSecondary,
              lineHeight: theme.typography.bodySmall.lineHeight,
              fontSize: theme.typography.bodySmall.fontSize,
            }}
          >
            {props.description}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 }}>
        <Text style={{ color: fg, fontSize: 13, fontWeight: '600' }}>{props.actionLabel}</Text>
        <Ionicons name="arrow-forward" size={14} color={fg} />
      </View>
    </Pressable>
  );
}

// Completion state
export function CompletionState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  useThemeVersion();
  return (
    <View
      style={{
        padding: 20,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Ionicons name="checkmark-done" size={24} color={theme.colors.success} />
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.typography.h2.fontSize,
          lineHeight: theme.typography.h2.lineHeight,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {props.title}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.typography.bodySmall.fontSize,
          lineHeight: theme.typography.bodySmall.lineHeight,
          textAlign: 'center',
        }}
      >
        {props.description}
      </Text>
      {props.actionLabel && props.onPress ? (
        <Pressable
          onPress={props.onPress}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 4,
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          })}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 14, fontWeight: '600' }}>
            {props.actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
