/**
 * ProfileScreen — 我 Tab 主畫面（精簡版）
 *
 * 心理學架構：
 * - Autonomy (SDT)：把個人控制集中到「設定與帳號安全」
 * - Endowment Effect：把「你已擁有的」(streak/成就) 放在首頁可見區域
 * - Self-Concept：身份卡強化自我敘事（我是誰、我在學校扮演什麼）
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { ContextStrip, ConfidenceBadge } from "../ui/campusOs";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { resolveRoleMode } from "../utils/campusOs";

const STREAK_KEY = "campus.streak.v1";

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string;
  totalDays: number;
};

async function readStreak(): Promise<StreakData | null> {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StreakData;
  } catch {
    return null;
  }
}

function ProfileRow(props: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  tint?: string;
  onPress: () => void;
}) {
  const tint = props.tint ?? theme.colors.accent;
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        padding: 16,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? `${tint}40` : theme.colors.border,
        gap: 8,
        opacity: pressed ? 0.86 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 16,
            backgroundColor: `${tint}14`,
            borderWidth: 1,
            borderColor: `${tint}25`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={props.icon} size={20} color={tint} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "800" }}>{props.title}</Text>
          {props.subtitle ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>{props.subtitle}</Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
      </View>
    </Pressable>
  );
}

function StreakMini(props: { streak: StreakData }) {
  const days = props.streak.currentStreak;
  const state: "high" | "medium" | "low" | "live" =
    days >= 30 ? "high" : days >= 7 ? "medium" : "low";

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name="flame" size={18} color={theme.colors.streak} />
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "900" }}>連續 {days} 天</Text>
        </View>
        <ConfidenceBadge
          state={state === "high" ? "high" : state === "medium" ? "medium" : "low"}
          label={days >= 30 ? "鐵粉" : days >= 7 ? "持續中" : "重新啟動"}
        />
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
        最長 {props.streak.longestStreak} 天 · 累積 {props.streak.totalDays} 天
      </Text>
    </View>
  );
}

export function ProfileScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();

  const [streak, setStreak] = useState<StreakData | null>(null);
  const [loadingStreak, setLoadingStreak] = useState(true);

  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const roleLabel = useMemo(() => {
    if (roleMode === "teacher") return "教學身份";
    if (roleMode === "admin") return "管理身份";
    if (roleMode === "student") return "學生身份";
    return "校園訪客";
  }, [roleMode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const s = await readStreak();
      if (!mounted) return;
      setStreak(s);
      setLoadingStreak(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const identity = auth.user
    ? auth.profile?.displayName ?? auth.user.email ?? "校園使用者"
    : "校園訪客";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ContextStrip
          eyebrow="我的"
          title={identity}
          description={`${school.name} · ${roleLabel}\n把你已經擁有的進度與設定放在這裡，讓控制感回到你手上。`}
          right={
            <View style={{ gap: 8, alignItems: "flex-end" }}>
              {auth.user ? (
                loadingStreak ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : streak ? (
                  <ConfidenceBadge state="live" label={`Streak ${streak.currentStreak}d`} />
                ) : (
                  <ConfidenceBadge state="low" label="尚未建立 streak" />
                )
              ) : (
                <ConfidenceBadge state="low" label="未登入" />
              )}
            </View>
          }
        />

        {/* 成就櫥窗 */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: 16,
            gap: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "900" }}>成就櫥窗</Text>
            <Pressable onPress={() => nav?.navigate?.("Achievements")}>
              <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "800" }}>查看全部</Text>
            </Pressable>
          </View>

          {auth.user ? (
            streak ? (
              <StreakMini streak={streak} />
            ) : (
              <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
                連續使用天數會在你登入後自動累積。
              </Text>
            )
          ) : (
            <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20 }}>
              登入後才會同步你的 streak 與成就進度。
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 12 }}>
            <ProfileRow
              icon="person-circle-outline"
              title="編輯個人資料"
              subtitle="你的公開/私訊與顯示名稱"
              tint={theme.colors.roleStudent}
              onPress={() => nav?.navigate?.("ProfileEdit")}
            />
          </View>
        </View>

        {/* 設定與帳號安全 */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
            Settings & Security
          </Text>

          {!auth.user ? (
            <ProfileRow
              icon="log-in-outline"
              title="登入並完成偏好"
              subtitle="登入後才會解鎖完整的課程與通知體驗"
              tint={theme.colors.accent}
              onPress={() => nav?.navigate?.("SSOLogin")}
            />
          ) : null}

          <ProfileRow
            icon="notifications-outline"
            title="通知設定"
            subtitle="只保留你真正需要的提醒"
            tint={theme.colors.info}
            onPress={() => nav?.navigate?.("NotificationSettings")}
          />

          <ProfileRow
            icon="accessibility-outline"
            title="無障礙設定"
            subtitle="字級、高對比與動態偏好"
            tint={theme.colors.social}
            onPress={() => nav?.navigate?.("AccessibilitySettings")}
          />

          <ProfileRow
            icon="color-palette-outline"
            title="外觀與主題"
            subtitle="調整亮暗模式與學校主色"
            tint={theme.colors.accent}
            onPress={() => nav?.navigate?.("ThemePreview")}
          />

          <ProfileRow
            icon="language-outline"
            title="語言設定"
            subtitle="繁體/簡體/英文等"
            tint={theme.colors.calm}
            onPress={() => nav?.navigate?.("LanguageSettings")}
          />

          <ProfileRow
            icon="download-outline"
            title="資料匯出"
            subtitle="保留你的學習軌跡"
            tint={theme.colors.growth}
            onPress={() => nav?.navigate?.("DataExport")}
          />

          <ProfileRow
            icon="trash-outline"
            title="刪除帳號"
            subtitle="永久移除你的資料（不可逆）"
            tint={theme.colors.danger}
            onPress={() => nav?.navigate?.("AccountDeletion")}
          />

          <ProfileRow
            icon="help-circle-outline"
            title="幫助與回饋"
            subtitle="遇到問題請先看幫助，或直接回報"
            tint={theme.colors.muted}
            onPress={() => nav?.navigate?.("Help")}
          />

          <ProfileRow
            icon="chatbox-ellipses-outline"
            title="意見回饋 / 問題回報"
            subtitle="讓我們把體驗變得更好"
            tint={theme.colors.social}
            onPress={() => nav?.navigate?.("Feedback")}
          />
        </View>
      </ScrollView>
    </View>
  );
}
