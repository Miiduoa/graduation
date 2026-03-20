/**
 * campusOs.tsx — Calm Clarity 設計語言元件
 *
 * 心理學設計原則：
 * - Object Perception: 單向陰影 + 明確邊框取代 Neumorphic 雙向陰影
 * - Visual Hierarchy: 色彩承載資訊語義而非裝飾
 * - Attention Direction: 圖示 + 色調引導視覺焦點
 */
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { shadowStyle, theme } from "./theme";

type IconName = keyof typeof Ionicons.glyphMap;

export function ContextStrip(props: {
  eyebrow: string;
  title: string;
  description?: string;
  right?: React.ReactNode;
}) {
  return (
    <View
      style={{
        padding: 20,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 6,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 5 }}>
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
            fontSize: theme.typography.h1.fontSize,
            fontWeight: theme.typography.h1.fontWeight ?? "700",
            letterSpacing: theme.typography.h1.letterSpacing,
          }}>
            {props.title}
          </Text>
          {props.description ? (
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 22, fontSize: 14 }}>
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
  state: "high" | "medium" | "low" | "live";
  label: string;
}) {
  const colors =
    props.state === "high"
      ? { bg: theme.colors.confidenceHighSoft, fg: theme.colors.confidenceHigh }
      : props.state === "medium"
        ? { bg: theme.colors.confidenceMediumSoft, fg: theme.colors.confidenceMedium }
        : props.state === "live"
          ? { bg: theme.colors.freshSoft, fg: theme.colors.fresh }
          : { bg: theme.colors.confidenceLowSoft, fg: theme.colors.confidenceLow };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 5,
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
  description: string;
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
          : { bg: theme.colors.focusSurface, fg: theme.colors.accent, border: `${theme.colors.accent}30` };

  const content = (
    <View
      style={{
        padding: 20,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 14,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          }}
        >
          <Ionicons name={props.icon} size={24} color={palette.fg} />
        </View>
        {props.meta ? <ConfidenceBadge state="live" label={props.meta} /> : null}
      </View>
      <View style={{ gap: 5 }}>
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
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
          {props.description}
        </Text>
      </View>
      {props.actionLabel ? (
        <View
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 16,
            paddingVertical: 9,
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
  description: string;
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
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.colors.accent + "40" : theme.colors.border,
        gap: 8,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${tint}14`,
            }}
          >
            <Ionicons name={props.icon} size={19} color={tint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>{props.title}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 18 }}>
              {props.description}
            </Text>
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
      ? { bg: theme.colors.urgentSoft, fg: theme.colors.urgent }
      : props.urgency === "high"
        ? { bg: theme.colors.warningSoft, fg: theme.colors.warning }
        : props.urgency === "medium"
          ? { bg: theme.colors.accentSoft, fg: theme.colors.accent }
          : { bg: theme.colors.calmSoft, fg: theme.colors.calm };

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 16,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? `${palette.fg}30` : theme.colors.border,
        gap: 10,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 12, flex: 1 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.bg,
            }}
          >
            <Ionicons name={props.icon} size={19} color={palette.fg} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>{props.title}</Text>
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
          padding: 10,
          borderRadius: theme.radius.sm,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 4,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>影響：{props.consequence}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>下一步：{props.nextStep}</Text>
      </View>

      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: theme.radius.sm,
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

export function RoleCtaCard(props: {
  icon: IconName;
  title: string;
  description: string;
  roleLabel: string;
  tone: "student" | "teacher" | "admin";
  actionLabel: string;
  onPress: () => void;
}) {
  const palette =
    props.tone === "teacher"
      ? { bg: theme.colors.roleTeacherSoft, fg: theme.colors.roleTeacher }
      : props.tone === "admin"
        ? { bg: theme.colors.roleAdminSoft, fg: theme.colors.roleAdmin }
        : { bg: theme.colors.roleStudentSoft, fg: theme.colors.roleStudent };

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 18,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? `${palette.fg}40` : theme.colors.border,
        gap: 10,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 16,
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
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: 3 }}>{props.title}</Text>
        </View>
      </View>
      <Text style={{ color: theme.colors.textSecondary, lineHeight: 22, fontSize: 14 }}>{props.description}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
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
        padding: 24,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        gap: 10,
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
          backgroundColor: theme.colors.growthSoft,
          borderWidth: 1,
          borderColor: `${theme.colors.growth}30`,
        }}
      >
        <Ionicons name="checkmark-done" size={26} color={theme.colors.growth} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "700" }}>{props.title}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 21, textAlign: "center" }}>
        {props.description}
      </Text>
      {props.actionLabel && props.onPress ? (
        <Pressable
          onPress={props.onPress}
          style={({ pressed }) => ({
            marginTop: 4,
            paddingHorizontal: 20,
            paddingVertical: 10,
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
