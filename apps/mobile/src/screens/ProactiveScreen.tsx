/* eslint-disable */
/**
 * 🔔 主動智慧推播 — Proactive Intelligence Screen
 *
 * 顯示 AI 根據你的學業/行為/時間分析主動產生的智慧提醒。
 * 這不是被動通知，而是「比你更懂你」的智慧夥伴。
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useThemeMode } from "../state/theme";
import {
  runProactiveScan,
  dismissNudge,
  getActiveNudges,
  type SmartNudge,
  type NudgePriority,
} from "../services/proactiveIntelligenceEngine";
import { earnXP } from "../services/gamificationEngine";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const priorityOrder: NudgePriority[] = ["critical", "high", "medium", "low", "info"];

const priorityLabel = (p: NudgePriority) => {
  switch (p) {
    case "critical": return "緊急";
    case "high": return "重要";
    case "medium": return "一般";
    case "low": return "輕量";
    case "info": return "資訊";
  }
};

// ─── Main Screen ─────────────────────────────────────────

export function ProactiveScreen() {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [nudges, setNudges] = useState<SmartNudge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const nav = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const result = await runProactiveScan();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setNudges(result);
    } catch (e) {
      console.warn("[Proactive] load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleDismiss = useCallback(async (id: string) => {
    await dismissNudge(id);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setNudges((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleAction = useCallback((nudge: SmartNudge, action: SmartNudge["actions"][0]) => {
    if (action.actionId === "daily_checkin") {
      earnXP("daily_login").catch(() => {});
      handleDismiss(nudge.id);
      return;
    }
    if (action.actionId === "snooze_1h") {
      handleDismiss(nudge.id);
      return;
    }
    // Navigation actions handled by parent
    handleDismiss(nudge.id);
  }, [handleDismiss]);

  // Group by priority
  const grouped = priorityOrder
    .map((p) => ({
      priority: p,
      items: nudges.filter((n) => n.priority === p),
    }))
    .filter((g) => g.items.length > 0);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: theme.space.md }}>AI 分析中...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.sm }}>
            <Ionicons name="sparkles" size={24} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800" }}>智慧助理</Text>
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 }}>
            AI 主動為你整理的重要提醒和建議
          </Text>
        </View>

        {/* Summary */}
        {nudges.length > 0 && (
          <View style={{
            marginHorizontal: theme.space.lg,
            marginBottom: theme.space.lg,
            flexDirection: "row",
            gap: theme.space.sm,
          }}>
            {[
              { label: "緊急", count: nudges.filter((n) => n.priority === "critical").length, color: "#EF4444" },
              { label: "重要", count: nudges.filter((n) => n.priority === "high").length, color: "#F97316" },
              { label: "建議", count: nudges.filter((n) => n.priority === "medium" || n.priority === "low" || n.priority === "info").length, color: theme.colors.accent },
            ].filter((s) => s.count > 0).map((s) => (
              <View key={s.label} style={{
                flex: 1,
                backgroundColor: s.color + "15",
                borderRadius: theme.radius.md,
                padding: theme.space.sm,
                alignItems: "center",
                borderWidth: 1,
                borderColor: s.color + "30",
              }}>
                <Text style={{ color: s.color, fontSize: 22, fontWeight: "800" }}>{s.count}</Text>
                <Text style={{ color: s.color, fontSize: 11 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Empty state */}
        {nudges.length === 0 && (
          <View style={{ alignItems: "center", paddingVertical: theme.space.xxl, paddingHorizontal: theme.space.xl }}>
            <Ionicons name="checkmark-done-circle" size={64} color={theme.colors.success} />
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", marginTop: theme.space.lg, textAlign: "center" }}>
              一切都好！
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: theme.space.sm, textAlign: "center", lineHeight: 20 }}>
              目前沒有需要你注意的事項。AI 會持續在背景監控，有重要事情會第一時間通知你。
            </Text>
          </View>
        )}

        {/* Nudge Cards */}
        {grouped.map((group) => (
          <View key={group.priority} style={{ marginBottom: theme.space.lg }}>
            {grouped.length > 1 && (
              <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.sm }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>
                  {priorityLabel(group.priority)}
                </Text>
              </View>
            )}
            {group.items.map((nudge) => (
              <NudgeCard
                key={nudge.id}
                nudge={nudge}
                onDismiss={() => handleDismiss(nudge.id)}
                onAction={(action) => handleAction(nudge, action)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Nudge Card ─────────────────────────────────────────

function NudgeCard({
  nudge,
  onDismiss,
  onAction,
}: {
  nudge: SmartNudge;
  onDismiss: () => void;
  onAction: (action: SmartNudge["actions"][0]) => void;
}) {
  const isCritical = nudge.priority === "critical";
  const isHigh = nudge.priority === "high";

  return (
    <View style={{
      marginHorizontal: theme.space.lg,
      marginBottom: theme.space.sm,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      padding: theme.space.lg,
      borderWidth: 1,
      borderColor: isCritical ? nudge.color + "50" : theme.colors.border,
      borderLeftWidth: 4,
      borderLeftColor: nudge.color,
      ...(isCritical ? {
        shadowColor: nudge.color,
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      } : {}),
    }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm }}>
        <View style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: nudge.color + "20",
          justifyContent: "center",
          alignItems: "center",
        }}>
          <Ionicons name={nudge.icon as any} size={20} color={nudge.color} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700", lineHeight: 20 }}>
            {nudge.title}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
            {nudge.body}
          </Text>
        </View>

        <Pressable onPress={onDismiss} hitSlop={12}>
          <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      {/* Social Proof */}
      {nudge.metadata.socialProof && (
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: theme.space.sm,
          backgroundColor: theme.colors.accentSoft,
          borderRadius: theme.radius.sm,
          paddingHorizontal: 8,
          paddingVertical: 4,
        }}>
          <Ionicons name="people-outline" size={12} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 11 }}>{nudge.metadata.socialProof}</Text>
        </View>
      )}

      {/* Actions */}
      {nudge.actions.length > 0 && (
        <View style={{ flexDirection: "row", gap: theme.space.sm, marginTop: theme.space.md }}>
          {nudge.actions.map((action, i) => (
            <Pressable
              key={i}
              onPress={() => onAction(action)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: i === 0 ? nudge.color : "transparent",
                borderRadius: theme.radius.md,
                paddingVertical: 8,
                alignItems: "center",
                opacity: pressed ? 0.7 : 1,
                borderWidth: i === 0 ? 0 : 1,
                borderColor: theme.colors.border,
              })}
            >
              <Text style={{
                color: i === 0 ? "#fff" : theme.colors.textSecondary,
                fontSize: 13,
                fontWeight: "600",
              }}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Time */}
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: theme.space.sm }}>
        {formatTimeAgo(nudge.timestamp)}
        {nudge.metadata.confidence < 0.7 ? "  · AI 信心度較低" : ""}
      </Text>
    </View>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}
