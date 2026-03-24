/* eslint-disable */
import React, { useMemo } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../state/auth";
import { useNotifications } from "../state/notifications";
import { useSchool } from "../state/school";
import { usePermissions } from "../hooks/usePermissions";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { ContextStrip, RoleCtaCard, TimelineCard } from "../ui/campusOs";
import { resolveRoleMode } from "../utils/campusOs";

export function PersonalHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
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
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 14,
        }}
      >
        <ContextStrip
          eyebrow="我的"
          title={identity}
          description={
            auth.user
              ? `${school.name} · ${roleDisplayName}身份。這裡只保留個人設定、帳號安全與長期成長。`
              : "這裡只處理個人設定、登入與偏好，不再塞滿高頻核心服務。"
          }
        />

        {/* 角色標籤 */}
        {auth.user ? (
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 4,
          }}>
            <View style={{
              backgroundColor: badgeColor,
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: 12,
            }}>
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
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

        {!auth.user ? (
          <RoleCtaCard
            icon="log-in-outline"
            title="登入並完成個人偏好"
            description="完成學校、角色與提醒設定後，Today、課程與收件匣會自動調整成更符合你的節奏。"
            roleLabel="開始使用"
            tone="student"
            actionLabel="前往登入"
            onPress={() => nav?.navigate?.("SSOLogin")}
          />
        ) : (
          <RoleCtaCard
            icon="sparkles-outline"
            title="你的核心偏好已集中到這裡"
            description="語言、無障礙、通知、外觀、帳號安全與資料匯出都從這裡進，不再和校園服務混在一起。"
            roleLabel="個人控制"
            tone={roleMode === "admin" ? "admin" : roleMode === "teacher" ? "teacher" : "student"}
            actionLabel="打開設定"
            onPress={() => nav?.navigate?.("Settings")}
          />
        )}

        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>個人與偏好</Text>
          {activeMerchantAssignments.length > 0 ? (
            <TimelineCard
              icon="storefront-outline"
              title="商家接單"
              description={`處理 ${activeMerchantAssignments[0].cafeteriaName}${activeMerchantAssignments.length > 1 ? ` 等 ${activeMerchantAssignments.length} 間餐廳` : ""} 的訂單狀態。`}
              meta="Merchant"
              tint={theme.colors.accent}
              onPress={() => nav?.navigate?.("MerchantHub")}
            />
          ) : null}
          <TimelineCard
            icon="person-outline"
            title="個人資料"
            description="姓名、系所、公開資訊與個人介紹"
            meta={auth.user ? "已綁定" : "未登入"}
            onPress={() => nav?.navigate?.(auth.user ? "ProfileEdit" : "SSOLogin")}
          />
          <TimelineCard
            icon="notifications-outline"
            title="通知與提醒"
            description="管理推播類型與免打擾時段，讓收件匣更可控。"
            meta={notifs.unreadCount > 0 ? `${notifs.unreadCount} 則未讀` : "已整理"}
            tint={theme.colors.warning}
            onPress={() => nav?.navigate?.("NotificationSettings")}
          />
          <TimelineCard
            icon="accessibility-outline"
            title="語言與無障礙"
            description="字級、對比、減少動態與多語系"
            meta="偏好"
            tint={theme.colors.calm}
            onPress={() => nav?.navigate?.("AccessibilitySettings")}
          />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>長期規劃與安全</Text>
          <TimelineCard
            icon="school-outline"
            title="學分與畢業規劃"
            description="這是低頻但高價值的長期工具，應該留在我的，而不是放進高頻主流程。"
            meta="規劃"
            tint={theme.colors.roleTeacher}
            onPress={() => nav?.navigate?.("CreditAuditStack")}
          />
          <TimelineCard
            icon="trophy-outline"
            title="成就與積分"
            description="成就現在是成長層，不再扮演高頻服務入口。"
            meta="成長"
            tint={theme.colors.achievement}
            onPress={() => nav?.navigate?.("Achievements")}
          />
          <TimelineCard
            icon="shield-checkmark-outline"
            title="帳號安全與資料"
            description="匯出資料、刪除帳號與校務身份安全設定"
            meta="安全"
            tint={theme.colors.urgent}
            onPress={() => nav?.navigate?.("DataExport")}
          />
        </View>

        {/* 角色專屬功能入口 — 依身份動態顯示 */}
        {(isTeacher || isDepartmentHead || isStaff || isAdmin) ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>
              {isAdmin ? "管理入口" : isStaff ? "服務管理" : isDepartmentHead ? "主管工具" : "教學工具"}
            </Text>

            {/* 教師/教授：快速進入教學管理 */}
            {isTeacher ? (
              <>
                <TimelineCard
                  icon="school-outline"
                  title="我的課程管理"
                  description="查看開課清單、批改作業與出缺勤紀錄"
                  meta="教學"
                  tint={theme.colors.roleTeacher}
                  onPress={() => nav?.navigate?.("CourseHub")}
                />
              </>
            ) : null}

            {/* 職員：設施與訂單管理 */}
            {isStaff ? (
              <>
                <TimelineCard
                  icon="construct-outline"
                  title="設施與工單管理"
                  description="處理維修報修、訂單與列印服務"
                  meta="服務"
                  tint={theme.colors.warning}
                  onPress={() => nav?.navigate?.("PrintService")}
                />
              </>
            ) : null}

            {/* 系所主管：審核與報表 */}
            {isDepartmentHead ? (
              <>
                <TimelineCard
                  icon="stats-chart-outline"
                  title="系所數據與審核"
                  description="審核流程、教學評鑑與統計報表"
                  meta="審核"
                  tint={theme.colors.calm}
                  onPress={() => nav?.navigate?.("AdminDashboard")}
                />
              </>
            ) : null}

            {/* 超級管理員：完整控制台 */}
            {isAdmin ? (
              <>
                <TimelineCard
                  icon="settings-outline"
                  title="管理員控制台"
                  description="全校管理後台：成員管理、數據分析與系統設定"
                  meta="Admin"
                  tint={theme.colors.roleAdmin}
                  onPress={() => nav?.navigate?.("AdminDashboard")}
                />
                <TimelineCard
                  icon="checkmark-done-outline"
                  title="課程驗證管理"
                  description="審核與驗證新開課程申請"
                  meta="審核"
                  tint={theme.colors.urgent}
                  onPress={() => nav?.navigate?.("AdminCourseVerify")}
                />
              </>
            ) : null}
          </View>
        ) : null}

        <View
          style={{
            padding: 16,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>保留原則</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 8 }}>
            如果一個功能是每天高頻、帶時效、會打斷注意力的，它就不該被塞在「我的」。
          </Text>
          <Text
            style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "700", marginTop: 12 }}
            onPress={() => {
              Alert.alert("已重新定位", "高頻核心服務已移往 Today、課程、校園與收件匣。");
            }}
          >
            查看重設說明
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
