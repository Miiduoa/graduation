/* eslint-disable */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View, ActivityIndicator, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { useAuth } from "../state/auth";
import { useNotifications } from "../state/notifications";
import { useSchool } from "../state/school";
import { usePermissions } from "../hooks/usePermissions";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { ContextStrip } from "../ui/campusOs";
import { resolveRoleMode } from "../utils/campusOs";
import { navigateToCourseHome } from "../utils/courseNavigation";

interface ListRowProps {
  icon: string;
  title: string;
  meta?: string;
  tint?: string;
  onPress?: () => void;
  isLast?: boolean;
}

function ListRow({ icon, title, meta, tint, onPress, isLast }: ListRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <LinearGradient
        colors={[`${tint || theme.colors.accent}20`, `${tint || theme.colors.accent}08`] as [string, string]}
        style={{ width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center" }}
      >
        <Ionicons name={icon as any} size={16} color={tint || theme.colors.accent} />
      </LinearGradient>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "600", flex: 1 }}>
        {title}
      </Text>
      {meta && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "500" }}>
          {meta}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

/** iOS-style grouped card container */
function GroupedCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{
      marginHorizontal: theme.space.lg,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
    }}>
      {children}
    </View>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <Text
      style={{
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 28,
        marginBottom: 10,
        paddingHorizontal: theme.space.lg,
      }}
    >
      {title}
    </Text>
  );
}

export function PersonalHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const notifs = useNotifications();
  const { school } = useSchool();
  const { displayName: roleDisplayName, badgeColor, can, isTeacher, isStaff, isDepartmentHead, isAdmin } = usePermissions();
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const activeMerchantAssignments = useMemo(
    () =>
      (auth.profile?.merchantAssignments ?? []).filter(
        (assignment) => assignment.status === "active"
      ),
    [auth.profile?.merchantAssignments]
  );

  const identity = useMemo(() => {
    if (!auth.user) return "校園訪客";
    return auth.profile?.displayName ?? auth.user.email ?? "校園使用者";
  }, [auth.profile?.displayName, auth.user]);

  // auth 還在載入時不要顯示登入按鈕（避免閃現登入畫面）
  if (auth.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  const isDark = theme.mode === "dark";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 40,
        }}
      >
        <LinearGradient
          colors={isDark
            ? ["#2E1065", "#1A0A3E", theme.colors.bg] as [string, string, string]
            : ["#EDE9FE", "#F5F3FF", theme.colors.bg] as [string, string, string]
          }
          style={{
            paddingTop: insets.top + theme.space.lg,
            paddingBottom: 24,
          }}
        >
        {/* ⚙️ 右上角設定齒輪 */}
        <View style={{ position: "absolute", top: insets.top + 12, right: theme.space.lg, zIndex: 10 }}>
          <Pressable
            onPress={() => nav?.navigate?.("Settings")}
            hitSlop={12}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
              justifyContent: "center",
              alignItems: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="settings-outline" size={20} color={isDark ? "rgba(255,255,255,0.7)" : theme.colors.textSecondary} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.xl }}>
          {/* Avatar circle */}
          <LinearGradient
            colors={[theme.colors.accent, "#7C3AED"] as [string, string]}
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: theme.space.md,
            }}
          >
            <Ionicons name="person" size={32} color="#FFFFFF" />
          </LinearGradient>
          <View style={{ gap: theme.space.sm }}>
            <Text style={{ color: isDark ? "rgba(255,255,255,0.6)" : theme.colors.textSecondary, fontSize: 13 }}>我的</Text>
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>
              {identity}
            </Text>
          </View>
          {auth.user ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.space.md,
                marginTop: theme.space.md,
              }}
            >
              <View
                style={{
                  backgroundColor: badgeColor,
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.xs,
                  borderRadius: theme.radius.full,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
                  {roleDisplayName}
                </Text>
              </View>
              {auth.profile?.department ? (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
                  {auth.profile.department}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        </LinearGradient>

        {!auth.user ? (
          <Pressable
            onPress={() => nav?.navigate?.("SSOLogin")}
            style={({ pressed }) => ({
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.xl,
              borderRadius: theme.radius.lg,
              overflow: "hidden",
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <LinearGradient
              colors={[theme.colors.accent, "#7C3AED"] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                paddingVertical: theme.space.lg,
                paddingHorizontal: theme.space.lg,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>登入帳號</Text>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: theme.space.xs }}>
                使用學校帳號密碼登入以解鎖完整功能
              </Text>
            </LinearGradient>
          </Pressable>
        ) : null}

        <SectionHeader title="個人與偏好" />
        <GroupedCard>
          {activeMerchantAssignments.length > 0 ? (
            <ListRow
              icon="storefront-outline"
              title="商家接單"
              meta={`${activeMerchantAssignments.length} 間`}
              tint={theme.colors.accent}
              onPress={() => nav?.navigate?.("MerchantHub")}
            />
          ) : null}
          <ListRow
            icon="person-outline"
            title="個人資料"
            meta={auth.user ? "已綁定" : "未登入"}
            onPress={() => nav?.navigate?.(auth.user ? "ProfileEdit" : "SSOLogin")}
          />
          <ListRow
            icon="notifications-outline"
            title="通知與提醒"
            meta={notifs.unreadCount > 0 ? `${notifs.unreadCount} 則` : "已整理"}
            tint={theme.colors.warning}
            onPress={() => nav?.navigate?.("NotificationSettings")}
          />
          <ListRow
            icon="accessibility-outline"
            title="語言與無障礙"
            meta="偏好"
            tint={theme.colors.calm}
            onPress={() => nav?.navigate?.("AccessibilitySettings")}
            isLast
          />
        </GroupedCard>

        <SectionHeader title="長期規劃與安全" />
        <GroupedCard>
          <ListRow
            icon="school-outline"
            title="學分與畢業規劃"
            meta="規劃"
            tint={theme.colors.roleTeacher}
            onPress={() => nav?.navigate?.("CreditAuditStack")}
          />
          <ListRow
            icon="trophy-outline"
            title="成就與積分"
            meta="成長"
            tint={theme.colors.achievement}
            onPress={() => nav?.navigate?.("Achievements")}
          />
          <ListRow
            icon="shield-checkmark-outline"
            title="帳號安全與資料"
            meta="安全"
            tint={theme.colors.urgent}
            onPress={() => nav?.navigate?.("DataExport")}
            isLast
          />
        </GroupedCard>

        <SectionHeader title="AI 與工具" />
        <GroupedCard>
          <ListRow
            icon="hardware-chip-outline"
            title="AI 模型管理"
            meta="本地推理"
            tint="#8B5CF6"
            onPress={() => nav?.navigate?.("AIModelManager")}
          />
          <ListRow
            icon="search-outline"
            title="全域搜尋"
            meta="搜尋"
            tint={theme.colors.calm}
            onPress={() => nav?.navigate?.("GlobalSearch")}
          />
          <ListRow
            icon="grid-outline"
            title="小工具"
            meta="Widget"
            tint={theme.colors.warning}
            onPress={() => nav?.navigate?.("WidgetPreview")}
            isLast
          />
        </GroupedCard>

        {isTeacher || isDepartmentHead || isStaff || isAdmin ? (
          <>
            <SectionHeader
              title={
                isAdmin
                  ? "管理入口"
                  : isStaff
                    ? "服務管理"
                    : isDepartmentHead
                      ? "主管工具"
                      : "教學工具"
              }
            />
            <GroupedCard>
              {isTeacher ? (
                <ListRow
                  icon="school-outline"
                  title="我的課程管理"
                  meta="教學"
                  tint={theme.colors.roleTeacher}
                  onPress={() => navigateToCourseHome(nav, auth.profile?.role)}
                />
              ) : null}
              {isStaff ? (
                <ListRow
                  icon="construct-outline"
                  title="設施與工單管理"
                  meta="服務"
                  tint={theme.colors.warning}
                  onPress={() => nav?.navigate?.("PrintService")}
                />
              ) : null}
              {isDepartmentHead ? (
                <ListRow
                  icon="stats-chart-outline"
                  title="系所數據與審核"
                  meta="審核"
                  tint={theme.colors.calm}
                  onPress={() => nav?.navigate?.("AdminDashboard")}
                />
              ) : null}
              {isAdmin ? (
                <>
                  <ListRow
                    icon="settings-outline"
                    title="管理員控制台"
                    meta="Admin"
                    tint={theme.colors.roleAdmin}
                    onPress={() => nav?.navigate?.("AdminDashboard")}
                  />
                  <ListRow
                    icon="checkmark-done-outline"
                    title="課程驗證管理"
                    meta="審核"
                    tint={theme.colors.urgent}
                    onPress={() => nav?.navigate?.("AdminCourseVerify")}
                    isLast
                  />
                </>
              ) : null}
            </GroupedCard>
          </>
        ) : null}

        {auth.user ? (
          <>
            <SectionHeader title="帳號" />
            <GroupedCard>
              <Pressable
                onPress={() => {
                  Alert.alert("確認登出", "登出後需要重新使用學校帳號登入，確定要登出嗎？", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "登出",
                      style: "destructive",
                      onPress: async () => {
                        setIsLoggingOut(true);
                        try {
                          await auth.signOut();
                        } finally {
                          setIsLoggingOut(false);
                        }
                      },
                    },
                  ]);
                }}
                disabled={isLoggingOut}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  paddingVertical: 14,
                  paddingHorizontal: 16,
                  opacity: pressed || isLoggingOut ? 0.7 : 1,
                })}
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color={theme.colors.danger} />
                ) : (
                  <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.danger, fontSize: 15, fontWeight: "600" }}>
                    登出帳號
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {auth.user.email ?? "已登入"}
                  </Text>
                </View>
              </Pressable>
            </GroupedCard>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
