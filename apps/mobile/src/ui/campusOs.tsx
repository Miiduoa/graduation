import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import type { AmbientCueSignalType } from "../data/types";
import { shadowStyle, theme } from "./theme";

type IconName = keyof typeof Ionicons.glyphMap;

function getAmbientCuePalette(signalType: AmbientCueSignalType) {
  switch (signalType) {
    case "attendance_momentum":
      return {
        fg: theme.colors.fresh,
        bg: theme.colors.freshSoft,
        border: `${theme.colors.fresh}30`,
        icon: "pulse-outline" as IconName,
      };
    case "teaching_review":
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: `${theme.colors.warning}30`,
        icon: "checkmark-circle-outline" as IconName,
      };
    case "leaderboard_momentum":
      return {
        fg: theme.colors.success,
        bg: theme.colors.successSoft,
        border: `${theme.colors.success}30`,
        icon: "trophy-outline" as IconName,
      };
    case "campus_popularity":
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: `${theme.colors.accent}30`,
        icon: "people-outline" as IconName,
      };
    case "approval_backlog":
      return {
        fg: theme.colors.warning,
        bg: theme.colors.warningSoft,
        border: `${theme.colors.warning}30`,
        icon: "layers-outline" as IconName,
      };
    case "admin_activity":
      return {
        fg: theme.colors.roleAdmin,
        bg: theme.colors.roleAdminSoft,
        border: `${theme.colors.roleAdmin}30`,
        icon: "sparkles-outline" as IconName,
      };
    case "course_completion":
    default:
      return {
        fg: theme.colors.accent,
        bg: theme.colors.accentSoft,
        border: `${theme.colors.accent}30`,
        icon: "trending-up-outline" as IconName,
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
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: theme.space.sm,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.md }}>
        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? "700",
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: "uppercase",
            }}
          >
            {props.eyebrow}
          </Text>
          <Text style={{
            color: theme.colors.text,
            fontSize: theme.typography.h2.fontSize,
            fontWeight: theme.typography.h2.fontWeight ?? "700",
            letterSpacing: theme.typography.h2.letterSpacing,
          }}>
            {props.title}
          </Text>
        </View>
        {props.right}
      </View>
    </View>
  );
}

export function ConfidenceBadge(props: {
  state: "high" | "medium" | "low" | "live";
  label: string;
}) {
  const colors =
    props.state === "high"
      ? { bg: theme.colors.successSoft, fg: theme.colors.success }
      : props.state === "medium"
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.state === "live"
          ? { bg: theme.colors.fresh, fg: theme.colors.fresh }
          : { bg: theme.colors.dangerSoft, fg: theme.colors.danger };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: theme.space.sm,
        paddingVertical: theme.space.xs,
        borderRadius: theme.radius.full,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: `${colors.fg}30`,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: "700" }}>{props.label}</Text>
    </View>
  );
}

export function HeroActionCard(props: {
  icon: IconName;
  eyebrow: string;
  title: string;
  description?: string;
  meta?: string;
  tone?: "accent" | "warning" | "success" | "danger";
  actionLabel?: string;
  onPress?: () => void;
}) {
  const palette =
    props.tone === "warning"
      ? { bg: theme.colors.warningSoft, fg: theme.colors.warning, border: `${theme.colors.warning}30` }
      : props.tone === "success"
        ? { bg: theme.colors.successSoft, fg: theme.colors.success, border: `${theme.colors.success}30` }
        : props.tone === "danger"
          ? { bg: theme.colors.dangerSoft, fg: theme.colors.danger, border: `${theme.colors.danger}30` }
          : { bg: theme.colors.accentSoft, fg: theme.colors.accent, border: `${theme.colors.accent}30` };

  const content = (
    <View
      style={{
        padding: theme.space.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: theme.space.md,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Ionicons name={props.icon} size={22} color={palette.fg} />
        </View>
        {props.meta ? <ConfidenceBadge state="live" label={props.meta} /> : null}
      </View>
      <View style={{ gap: theme.space.xs }}>
        <Text style={{
          color: palette.fg,
          fontSize: theme.typography.overline.fontSize,
          fontWeight: theme.typography.overline.fontWeight ?? "700",
          letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
          textTransform: "uppercase",
        }}>
          {props.eyebrow}
        </Text>
        <Text style={{
          color: theme.colors.text,
          fontSize: theme.typography.h2.fontSize,
          fontWeight: theme.typography.h2.fontWeight ?? "700",
          letterSpacing: theme.typography.h2.letterSpacing,
        }}>
          {props.title}
        </Text>
        {props.description && (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
            {props.description}
          </Text>
        )}
      </View>
      {props.actionLabel ? (
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.sm,
            borderRadius: theme.radius.md,
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Text style={{ color: palette.fg, fontSize: 13, fontWeight: "700" }}>{props.actionLabel}</Text>
        </View>
      ) : null}
    </View>
  );

  if (!props.onPress) return content;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      {content}
    </Pressable>
  );
}

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
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.colors.accent + "40" : theme.colors.border,
        gap: theme.space.sm,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.md, flex: 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${tint}14`,
            }}
          >
            <Ionicons name={props.icon} size={18} color={tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>{props.title}</Text>
            {props.description && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: theme.space.xs, lineHeight: 18 }}>
                {props.description}
              </Text>
            )}
          </View>
        </View>
        {props.meta ? <Text style={{ color: tint, fontSize: 12, fontWeight: "700" }}>{props.meta}</Text> : null}
      </View>
      {props.hint ? (
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, paddingLeft: 52 }}>{props.hint}</Text>
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
  urgency: "critical" | "high" | "medium" | "low";
  actionLabel: string;
  onPress: () => void;
}) {
  const palette =
    props.urgency === "critical"
      ? { bg: theme.colors.dangerSoft, fg: theme.colors.danger }
      : props.urgency === "high"
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.urgency === "medium"
          ? { bg: theme.colors.accentSoft, fg: theme.colors.accent }
          : { bg: theme.colors.infoSoft, fg: theme.colors.info };

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? `${palette.fg}30` : theme.colors.border,
        gap: theme.space.md,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.md }}>
        <View style={{ flexDirection: "row", gap: theme.space.md, flex: 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.bg,
            }}
          >
            <Ionicons name={props.icon} size={18} color={palette.fg} />
          </View>
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>{props.title}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
              {props.reason}
            </Text>
          </View>
        </View>
        <ConfidenceBadge
          state={props.urgency === "low" ? "medium" : props.urgency === "critical" ? "low" : "high"}
          label={props.urgency === "critical" ? "先做" : props.urgency === "high" ? "今天" : props.urgency === "medium" ? "接著做" : "可安排"}
        />
      </View>

      <View
        style={{
          padding: theme.space.sm,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: theme.space.xs,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>影響：{props.consequence}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>下一步：{props.nextStep}</Text>
      </View>

      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          borderRadius: theme.radius.md,
          backgroundColor: palette.bg,
          borderWidth: 1,
          borderColor: `${palette.fg}30`,
        }}
      >
        <Text style={{ color: palette.fg, fontSize: 13, fontWeight: "700" }}>{props.actionLabel}</Text>
      </View>
    </Pressable>
  );
}

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
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? palette.border : theme.colors.border,
        gap: theme.space.md,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.995 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.space.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Ionicons name={palette.icon} size={18} color={palette.fg} />
        </View>

        <View style={{ flex: 1, gap: theme.space.xs }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700", lineHeight: 20 }}>
            {props.headline}
          </Text>
          {props.body && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
              {props.body}
            </Text>
          )}
        </View>

        {props.onDismiss ? (
          <Pressable onPress={props.onDismiss} hitSlop={8} style={{ padding: theme.space.xs }}>
            <Ionicons name="close" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.md }}>
        {props.metric ? (
          <View
            style={{
              paddingHorizontal: theme.space.sm,
              paddingVertical: theme.space.xs,
              borderRadius: theme.radius.full,
              backgroundColor: palette.bg,
              borderWidth: 1,
              borderColor: palette.border,
            }}
          >
            <Text style={{ color: palette.fg, fontSize: 11, fontWeight: "700" }}>{props.metric}</Text>
          </View>
        ) : <View />}

        <View
          style={{
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.sm,
            borderRadius: theme.radius.md,
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Text style={{ color: palette.fg, fontSize: 12, fontWeight: "700" }}>{props.actionLabel}</Text>
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
  tone: "student" | "teacher" | "admin";
  actionLabel: string;
  onPress: () => void;
}) {
  const palette =
    props.tone === "teacher"
      ? { bg: theme.colors.successSoft, fg: theme.colors.success }
      : props.tone === "admin"
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : { bg: theme.colors.accentSoft, fg: theme.colors.accent };

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: theme.space.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? `${palette.fg}40` : theme.colors.border,
        gap: theme.space.md,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: `${palette.fg}20`,
          }}
        >
          <Ionicons name={props.icon} size={20} color={palette.fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{
            color: palette.fg,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: theme.typography.overline.fontWeight ?? "700",
            letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
            textTransform: "uppercase",
          }}>
            {props.roleLabel}
          </Text>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700", marginTop: theme.space.xs }}>{props.title}</Text>
        </View>
      </View>
      {props.description && (
        <Text style={{ color: theme.colors.textSecondary, lineHeight: 20, fontSize: 13 }}>{props.description}</Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.xs }}>
        <Text style={{ color: palette.fg, fontSize: 13, fontWeight: "700" }}>{props.actionLabel}</Text>
        <Ionicons name="arrow-forward" size={13} color={palette.fg} />
      </View>
    </Pressable>
  );
}

export function CompletionState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  return (
    <View
      style={{
        padding: theme.space.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        gap: theme.space.md,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.successSoft,
          borderWidth: 1,
          borderColor: `${theme.colors.success}30`,
        }}
      >
        <Ionicons name="checkmark-done" size={26} color={theme.colors.success} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{props.title}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center" }}>
        {props.description}
      </Text>
      {props.actionLabel && props.onPress ? (
        <Pressable
          onPress={props.onPress}
          style={({ pressed }) => ({
            marginTop: theme.space.sm,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.sm,
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
