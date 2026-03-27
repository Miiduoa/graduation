/* eslint-disable */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../state/auth";
import { useNotifications } from "../state/notifications";
import { useSchool } from "../state/school";
import { usePermissions } from "../hooks/usePermissions";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { ContextStrip } from "../ui/campusOs";
import { resolveRoleMode } from "../utils/campusOs";

interface ListRowProps {
  icon: string;
  title: string;
  meta?: string;
  tint?: string;
  onPress?: () => void;
}

function ListRow({ icon, title, meta, tint, onPress }: ListRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space.md,
        paddingVertical: theme.space.md,
        paddingHorizontal: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 24, height: 24, justifyContent: "center", alignItems: "center" }}>
        <Ionicons name={icon as any} size={20} color={tint || theme.colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "600" }}>
          {title}
        </Text>
      </View>
      {meta && (
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "500" }}>
          {meta}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
    </Pressable>
  );
}

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <Text
      style={{
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: "700",
        marginTop: theme.space.lg,
        marginBottom: theme.space.md,
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.xl }}>
          <View style={{ gap: theme.space.sm }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>我的</Text>
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "700" }}>
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

        {!auth.user ? (
          <Pressable
            onPress={() => nav?.navigate?.("SSOLogin")}
            style={({ pressed }) => ({
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.xl,
              paddingVertical: theme.space.lg,
              paddingHorizontal: theme.space.lg,
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.lg,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>登入帳號</Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: theme.space.xs }}>
              使用學校帳號密碼登入以解鎖完整功能
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => nav?.navigate?.("Settings")}
            style={({ pressed }) => ({
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.xl,
              paddingVertical: theme.space.lg,
              paddingHorizontal: theme.space.lg,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>
              打開設定
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: theme.space.xs }}>
              語言、無障礙、通知、外觀、帳號安全
            </Text>
          </Pressable>
        )}

        <SectionHeader title="個人與偏好" />
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
        />

        <SectionHeader title="長期規劃與安全" />
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
        />

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
            {isTeacher ? (
              <ListRow
                icon="school-outline"
                title="我的課程管理"
                meta="教學"
                tint={theme.colors.roleTeacher}
                onPress={() => nav?.navigate?.("CourseHub")}
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
                />
              </>
            ) : null}
          </>
        ) : null}

        {auth.user ? (
          <>
            <SectionHeader title="帳號" />
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
                marginHorizontal: theme.space.lg,
                marginVertical: theme.space.md,
                paddingVertical: theme.space.lg,
                paddingHorizontal: theme.space.lg,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.dangerSoft,
                opacity: pressed || isLoggingOut ? 0.7 : 1,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space.md }}>
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color={theme.colors.danger} />
                ) : (
                  <Ionicons name="log-out-outline" size={20} color={theme.colors.danger} />
                )}
                <Text style={{ color: theme.colors.danger, fontSize: 15, fontWeight: "700", flex: 1 }}>
                  登出帳號
                </Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: theme.space.xs }}>
                {auth.user.email ?? "已登入"}
              </Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
