import React from "react";
import { Pressable, Text, View, ScrollView } from "react-native";
import { theme } from "./theme";

export function Screen(props: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ padding: theme.space.lg, paddingBottom: theme.space.md, gap: 8 }}>
        {props.title ? (
          <Text style={{ fontSize: 22, fontWeight: "800", color: theme.colors.text, letterSpacing: 0.2 }}>
            {props.title}
          </Text>
        ) : null}
        {props.subtitle ? (
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>{props.subtitle}</Text>
        ) : null}
      </View>
      <View style={{ flex: 1, paddingHorizontal: theme.space.lg }}>{props.children}</View>
    </View>
  );
}

export function Card(props: { title?: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <View
      style={{
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        gap: 8,
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 }
      }}
    >
      {props.title ? (
        <Text style={{ fontSize: 16, fontWeight: "800", color: theme.colors.text }}>{props.title}</Text>
      ) : null}
      {props.subtitle ? <Text style={{ color: theme.colors.muted, lineHeight: 18 }}>{props.subtitle}</Text> : null}
      {props.children}
    </View>
  );
}

export function Pill(props: { text: string; kind?: "default" | "accent" }) {
  const kind = props.kind ?? "default";
  const bg = kind === "accent" ? theme.colors.accentSoft : "rgba(255,255,255,0.05)";
  const border = kind === "accent" ? "rgba(124,92,255,0.35)" : theme.colors.border;
  const color = kind === "accent" ? theme.colors.text : theme.colors.muted;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{props.text}</Text>
    </View>
  );
}

export function Button(props: { text: string; onPress?: () => void; disabled?: boolean; kind?: "primary" | "secondary" }) {
  const kind = props.kind ?? "secondary";
  const disabled = !!props.disabled;

  const bg = kind === "primary" ? theme.colors.accentSoft : "rgba(255,255,255,0.05)";
  const border = kind === "primary" ? "rgba(124,92,255,0.45)" : theme.colors.border;

  return (
    <Pressable
      disabled={disabled}
      onPress={props.onPress}
      style={{
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: disabled ? "rgba(255,255,255,0.035)" : bg
      }}
    >
      <Text style={{ color: disabled ? theme.colors.muted : theme.colors.text, fontWeight: "800" }}>{props.text}</Text>
    </Pressable>
  );
}
