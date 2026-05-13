import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { AmbientCueSignalType } from '../data/types';
import { shadowStyle, theme } from './theme';

type IconName = keyof typeof Ionicons.glyphMap;

function getAmbientCuePalette(signalType: AmbientCueSignalType) {
  switch (signalType) {
    case 'attendance_momentum':
      return {
        fg: theme.colors.fresh,
        bg: theme.colors.freshSoft,
        border: `${theme.colors.fresh}30`,
        icon: 'pulse-outline' as IconName,
      };
    case 'teaching_review':
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: `${theme.colors.warning}30`,
        icon: 'checkmark-circle-outline' as IconName,
      };
    case 'leaderboard_momentum':
      return {
        fg: theme.colors.success,
        bg: theme.colors.successSoft,
        border: `${theme.colors.success}30`,
        icon: 'trophy-outline' as IconName,
      };
    case 'campus_popularity':
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: `${theme.colors.accent}30`,
        icon: 'people-outline' as IconName,
      };
    case 'approval_backlog':
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: `${theme.colors.warning}30`,
        icon: 'layers-outline' as IconName,
      };
    case 'admin_activity':
      return {
        fg: theme.colors.roleAdmin,
        bg: theme.colors.roleAdminSoft,
        border: `${theme.colors.roleAdmin}30`,
        icon: 'sparkles-outline' as IconName,
      };
    case 'course_completion':
    default:
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: `${theme.colors.accent}30`,
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
  return (
    <View
      style={{
        padding: theme.space.lg,
        borderRadius: 22,
        backgroundColor: theme.colors.surface,
        gap: theme.space.sm,
        ...shadowStyle(theme.shadows.md),
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
        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            {props.eyebrow}
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.h2.fontSize,
              fontWeight: theme.typography.h2.fontWeight ?? '700',
              letterSpacing: theme.typography.h2.letterSpacing,
            }}
          >
            {props.title}
          </Text>
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
  const colors =
    props.state === 'high'
      ? { bg: theme.colors.successSoft, fg: theme.colors.success }
      : props.state === 'medium'
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.state === 'live'
          ? { bg: theme.colors.fresh, fg: theme.colors.fresh }
          : { bg: theme.colors.dangerSoft, fg: theme.colors.danger };

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: '700', letterSpacing: 0.1 }}>
        {props.label}
      </Text>
    </View>
  );
}

// ─── Hero Action Card — full gradient background ────────
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
  const palette =
    props.tone === 'warning'
      ? { colors: ['#FEF3C7', '#FDE68A'] as [string, string], fg: '#D97706', iconBg: '#FEF3C720' }
      : props.tone === 'success'
        ? { colors: ['#D1FAE5', '#A7F3D0'] as [string, string], fg: '#059669', iconBg: '#D1FAE520' }
        : props.tone === 'danger'
          ? {
              colors: ['#FEE2E2', '#FECACA'] as [string, string],
              fg: '#DC2626',
              iconBg: '#FEE2E220',
            }
          : {
              colors: ['#F3F4F6', '#E5E7EB'] as [string, string],
              fg: '#5B21B6',
              iconBg: 'rgba(17,24,39,0.06)',
            };

  // Dark mode adjustments
  const isDark = theme.mode === 'dark';
  const gradColors = isDark
    ? props.tone === 'warning'
      ? ['#422006', '#451A03']
      : props.tone === 'success'
        ? ['#064E3B', '#052E16']
        : props.tone === 'danger'
          ? ['#450A0A', '#7F1D1D']
          : ['#2E1065', '#1E1B4B']
    : palette.colors;
  const fg = isDark
    ? props.tone === 'warning'
      ? '#FBBF24'
      : props.tone === 'success'
        ? '#34D399'
        : props.tone === 'danger'
          ? '#F87171'
          : '#A78BFA'
    : palette.fg;

  const content = (
    <LinearGradient
      colors={gradColors as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        padding: 22,
        borderRadius: 22,
        gap: 16,
        ...shadowStyle(theme.shadows.lg),
      }}
    >
      {/* Top row: icon + meta */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)',
          }}
        >
          <Ionicons name={props.icon} size={24} color={fg} />
        </View>
        {props.meta ? <ConfidenceBadge state="live" label={props.meta} /> : null}
      </View>

      {/* Content */}
      <View style={{ gap: 6 }}>
        <Text
          style={{
            color: fg,
            fontSize: 11,
            fontWeight: '800',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            opacity: 0.8,
          }}
        >
          {props.eyebrow}
        </Text>
        <Text
          style={{
            color: isDark ? '#F5F3FF' : theme.colors.text,
            fontSize: 20,
            fontWeight: '700',
            letterSpacing: -0.4,
            lineHeight: 26,
          }}
        >
          {props.title}
        </Text>
        {props.description && (
          <Text
            style={{
              color: isDark ? 'rgba(245,243,255,0.7)' : theme.colors.textSecondary,
              fontSize: 14,
              lineHeight: 21,
              marginTop: 2,
            }}
          >
            {props.description}
          </Text>
        )}
      </View>

      {/* Action Button */}
      {props.actionLabel ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
          }}
        >
          <Text style={{ color: fg, fontSize: 14, fontWeight: '700' }}>{props.actionLabel}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );

  if (!props.onPress) return content;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {content}
    </Pressable>
  );
}

// ─── Timeline Card (redesigned) ─────────────────────────
export function TimelineCard(props: {
  icon: IconName;
  title: string;
  description?: string;
  meta?: string;
  hint?: string;
  tint?: string;
  onPress?: () => void;
}) {
  const tint = props.tint ?? theme.colors.accent;
  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 16,
        borderRadius: 20,
        backgroundColor: theme.colors.surface,
        gap: 10,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...shadowStyle(theme.shadows.md),
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
          <LinearGradient
            colors={[`${tint}25`, `${tint}10`]}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={props.icon} size={20} color={tint} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
              {props.title}
            </Text>
            {props.description && (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                  marginTop: 3,
                  lineHeight: 19,
                }}
              >
                {props.description}
              </Text>
            )}
          </View>
        </View>
        {props.meta ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 10,
              backgroundColor: `${tint}12`,
            }}
          >
            <Text style={{ color: tint, fontSize: 11, fontWeight: '700' }}>{props.meta}</Text>
          </View>
        ) : null}
      </View>
      {props.hint ? (
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, paddingLeft: 58 }}>
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
  const palette =
    props.urgency === 'critical'
      ? { bg: theme.colors.dangerSoft, fg: theme.colors.danger }
      : props.urgency === 'high'
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.urgency === 'medium'
          ? { bg: theme.colors.accentSoft, fg: theme.colors.accent }
          : { bg: theme.colors.infoSoft, fg: theme.colors.info };

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 18,
        borderRadius: 22,
        backgroundColor: theme.colors.surface,
        gap: 14,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadowStyle(theme.shadows.md),
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 14, flex: 1 }}>
          <LinearGradient
            colors={[`${palette.fg}25`, `${palette.fg}10`]}
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={props.icon} size={20} color={palette.fg} />
          </LinearGradient>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
              {props.title}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
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
          padding: 12,
          borderRadius: 14,
          backgroundColor: theme.colors.surface2,
          gap: 4,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
          影響：{props.consequence}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
          下一步：{props.nextStep}
        </Text>
      </View>

      <View
        style={{
          alignSelf: 'flex-start',
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 14,
          backgroundColor: palette.bg,
        }}
      >
        <Text style={{ color: palette.fg, fontSize: 13, fontWeight: '700' }}>
          {props.actionLabel}
        </Text>
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
  const palette = getAmbientCuePalette(props.signalType);

  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 18,
        borderRadius: 22,
        backgroundColor: theme.colors.surface,
        gap: 14,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
        ...shadowStyle(theme.shadows.md),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <LinearGradient
          colors={[`${palette.fg}25`, `${palette.fg}10`]}
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={palette.icon} size={20} color={palette.fg} />
        </LinearGradient>

        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', lineHeight: 21 }}
          >
            {props.headline}
          </Text>
          {props.body && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
              {props.body}
            </Text>
          )}
        </View>

        {props.onDismiss ? (
          <Pressable onPress={props.onDismiss} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="close" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {props.metric ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 12,
              backgroundColor: palette.bg,
            }}
          >
            <Text style={{ color: palette.fg, fontSize: 12, fontWeight: '700' }}>
              {props.metric}
            </Text>
          </View>
        ) : (
          <View />
        )}

        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 14,
            backgroundColor: palette.bg,
          }}
        >
          <Text style={{ color: palette.fg, fontSize: 13, fontWeight: '700' }}>
            {props.actionLabel}
          </Text>
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
  const palette =
    props.tone === 'teacher'
      ? { colors: ['#D1FAE5', '#A7F3D0'] as const, fg: '#059669' }
      : props.tone === 'admin'
        ? { colors: ['#FEF3C7', '#FDE68A'] as const, fg: '#D97706' }
        : { colors: ['#F3F4F6', '#E5E7EB'] as const, fg: '#5B21B6' };

  const isDark = theme.mode === 'dark';
  const gradColors = isDark
    ? props.tone === 'teacher'
      ? ['#064E3B', '#052E16']
      : props.tone === 'admin'
        ? ['#422006', '#451A03']
        : ['#2E1065', '#1E1B4B']
    : palette.colors;
  const fg = isDark
    ? props.tone === 'teacher'
      ? '#34D399'
      : props.tone === 'admin'
        ? '#FBBF24'
        : '#A78BFA'
    : palette.fg;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <LinearGradient
        colors={gradColors as unknown as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          padding: 22,
          borderRadius: 22,
          gap: 14,
          ...shadowStyle(theme.shadows.md),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.6)',
            }}
          >
            <Ionicons name={props.icon} size={22} color={fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: fg,
                fontSize: 11,
                fontWeight: '800',
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                opacity: 0.8,
              }}
            >
              {props.roleLabel}
            </Text>
            <Text
              style={{
                color: isDark ? '#F5F3FF' : theme.colors.text,
                fontSize: 16,
                fontWeight: '700',
                marginTop: 3,
              }}
            >
              {props.title}
            </Text>
          </View>
        </View>
        {props.description && (
          <Text
            style={{
              color: isDark ? 'rgba(245,243,255,0.7)' : theme.colors.textSecondary,
              lineHeight: 21,
              fontSize: 14,
            }}
          >
            {props.description}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: fg, fontSize: 14, fontWeight: '700' }}>{props.actionLabel}</Text>
          <Ionicons name="arrow-forward" size={14} color={fg} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// ─── Completion State (redesigned with gradient) ────────
export function CompletionState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const isDark = theme.mode === 'dark';
  return (
    <LinearGradient
      colors={isDark ? ['#064E3B', '#052E16'] : ['#D1FAE5', '#ECFDF5']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        padding: 24,
        borderRadius: 22,
        alignItems: 'center',
        gap: 14,
        ...shadowStyle(theme.shadows.md),
      }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)',
        }}
      >
        <Ionicons name="checkmark-done" size={28} color={isDark ? '#34D399' : '#059669'} />
      </View>
      <Text
        style={{
          color: isDark ? '#F5F3FF' : theme.colors.text,
          fontSize: 17,
          fontWeight: '700',
        }}
      >
        {props.title}
      </Text>
      <Text
        style={{
          color: isDark ? 'rgba(245,243,255,0.7)' : theme.colors.textSecondary,
          fontSize: 14,
          lineHeight: 21,
          textAlign: 'center',
        }}
      >
        {props.description}
      </Text>
      {props.actionLabel && props.onPress ? (
        <Pressable
          onPress={props.onPress}
          style={({ pressed }) => ({
            marginTop: 4,
            paddingHorizontal: 22,
            paddingVertical: 12,
            borderRadius: 14,
            backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: isDark ? '#34D399' : '#059669', fontSize: 14, fontWeight: '700' }}>
            {props.actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </LinearGradient>
  );
}
