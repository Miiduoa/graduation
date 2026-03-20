import React, { useMemo } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useThemeMode } from "../state/theme";
import { useNotifications } from "../state/notifications";
import { useSchedule } from "../state/schedule";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle, softShadowStyle } from "../ui/theme";

type ServiceItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  color: string;
  onPress: () => void;
  badge?: string;
};

type SettingRow = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  value?: string;
  danger?: boolean;
  badge?: number;
};

function SoftPanel(props: {
  children: React.ReactNode;
  tint?: string;
  padding?: number;
  style?: any;
}) {
  return (
    <View
      style={[
        {
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          padding: props.padding ?? 20,
          ...softShadowStyle(theme.shadows.soft),
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

function SectionHeading(props: { eyebrow: string; title: string }) {
  return (
    <View style={{ marginBottom: 14, gap: 3 }}>
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {props.eyebrow}
      </Text>
      <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }}>
        {props.title}
      </Text>
    </View>
  );
}

function ProfileStat(props: { label: string; value: string; accent: string }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: theme.radius.md,
        paddingVertical: 14,
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
      }}
    >
      <Text style={{ color: props.accent, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 }}>{props.value}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>{props.label}</Text>
    </View>
  );
}

function ServiceTile({ item }: { item: ServiceItem }) {
  return (
    <Pressable
      onPress={item.onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: theme.radius.md,
        paddingHorizontal: 16,
        paddingVertical: 16,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${item.color}18`,
          }}
        >
          <Ionicons name={item.icon} size={22} color={item.color} />
        </View>
        {item.badge ? (
          <View
            style={{
              minWidth: 22,
              height: 22,
              borderRadius: 11,
              paddingHorizontal: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.danger,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>{item.badge}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
        )}
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>{item.label}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }}>{item.hint}</Text>
    </Pressable>
  );
}

function ServiceGrid({ items }: { items: ServiceItem[] }) {
  const rows = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }

  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={{ flexDirection: "row", gap: 12 }}>
          {row.map((item) => (
            <ServiceTile key={item.label} item={item} />
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

function ListRowItem({ row }: { row: SettingRow }) {
  const iconColor = row.danger ? theme.colors.danger : row.color;

  return (
    <Pressable
      onPress={row.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 6,
        paddingVertical: 14,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
          backgroundColor: row.danger ? theme.colors.dangerSoft : `${row.color}18`,
        }}
      >
        <Ionicons name={row.icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: iconColor, fontSize: 15, fontWeight: row.danger ? "700" : "600" }}>{row.label}</Text>
      </View>
      {row.badge !== undefined && row.badge > 0 ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            paddingHorizontal: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.danger,
            marginRight: 8,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>{row.badge}</Text>
        </View>
      ) : null}
      {row.value ? <Text style={{ color: theme.colors.muted, fontSize: 12, marginRight: 8 }}>{row.value}</Text> : null}
      {!row.danger ? <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} /> : null}
    </Pressable>
  );
}

function ListSection(props: { title: string; rows: SettingRow[] }) {
  return (
    <View>
      <SectionHeading eyebrow="Grouped List" title={props.title} />
      <SoftPanel tint="rgba(226,234,245,0.7)" padding={10}>
        {props.rows.map((row, index) => (
          <View key={row.label}>
            <ListRowItem row={row} />
            {index < props.rows.length - 1 ? (
              <View style={{ height: 1, marginLeft: 58, backgroundColor: theme.colors.border }} />
            ) : null}
          </View>
        ))}
      </SoftPanel>
    </View>
  );
}

export function MeScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const themeMode = useThemeMode();
  const notifs = useNotifications();
  const { courses } = useSchedule();

  const isDark = theme.mode === "dark";

  const identity = useMemo(() => {
    if (!auth.user) return "校園訪客";
    if (auth.profile?.displayName) return auth.profile.displayName;
    return auth.user.email ?? `用戶 ${auth.user.uid.slice(0, 6)}`;
  }, [auth.profile?.displayName, auth.user]);

  const avatarInitial = useMemo(() => {
    const source = auth.profile?.displayName ?? auth.user?.email ?? school.name;
    return (source[0] ?? "?").toUpperCase();
  }, [auth.profile?.displayName, auth.user?.email, school.name]);

  const totalCredits = useMemo(
    () => courses.reduce((sum, course) => sum + (course.credits ?? 0), 0),
    [courses]
  );

  const frequentServices: ServiceItem[] = [
    { icon: "qr-code-outline", label: "QR 碼", hint: "校園身份與通行", color: "#5B8CFF", onPress: () => nav?.navigate?.("QRCode") },
    { icon: "search-outline", label: "全站搜尋", hint: "快速找課程與公告", color: "#5AC8FA", onPress: () => nav?.navigate?.("GlobalSearch") },
    { icon: "library-outline", label: "圖書館", hint: "借閱、空位與書單", color: "#667EEA", onPress: () => nav?.navigate?.("Library") },
    { icon: "bus-outline", label: "校園公車", hint: "查看即時班次", color: "#34C759", onPress: () => nav?.navigate?.("地圖", { screen: "BusSchedule" }) },
  ];

  const campusLifeServices: ServiceItem[] = [
    { icon: "medkit-outline", label: "健康中心", hint: "掛號與服務資訊", color: "#FF6B6B", onPress: () => nav?.navigate?.("Health") },
    { icon: "bed-outline", label: "宿舍服務", hint: "住宿與報修入口", color: "#A78BFA", onPress: () => nav?.navigate?.("Dormitory") },
    { icon: "print-outline", label: "列印服務", hint: "影印與輸出需求", color: "#FF9500", onPress: () => nav?.navigate?.("PrintService") },
    { icon: "help-buoy-outline", label: "失物招領", hint: "刊登與查找物品", color: "#FF6FA9", onPress: () => nav?.navigate?.("LostFound") },
  ];

  const otherServices: ServiceItem[] = [
    { icon: "wallet-outline", label: "校園支付", hint: "錢包與付款紀錄", color: "#22C7A9", onPress: () => nav?.navigate?.("Payment") },
    { icon: "trophy-outline", label: "成就積分", hint: "任務與排行榜", color: "#F5B700", onPress: () => nav?.navigate?.("Achievements") },
    { icon: "phone-portrait-outline", label: "桌面小工具", hint: "Widget 預覽與設定", color: "#5B8CFF", onPress: () => nav?.navigate?.("WidgetPreview") },
  ];

  const accountRows: SettingRow[] = auth.user
    ? [
        {
          icon: "person-outline",
          label: "編輯個人資料",
          color: theme.colors.accent,
          onPress: () => nav?.navigate?.("ProfileEdit"),
        },
        {
          icon: "notifications-outline",
          label: "通知中心",
          color: "#FF9500",
          onPress: () => nav?.navigate?.("Notifications"),
          badge: notifs.unreadCount > 0 ? notifs.unreadCount : undefined,
        },
        {
          icon: isDark ? "sunny-outline" : "moon-outline",
          label: isDark ? "切換淺色模式" : "切換深色模式",
          color: "#667EEA",
          onPress: () => themeMode.setMode(isDark ? "light" : "dark"),
        },
      ]
    : [
        {
          icon: "log-in-outline",
          label: "學校帳號登入",
          color: theme.colors.accent,
          onPress: () => nav?.navigate?.("SSOLogin"),
        },
      ];

  const settingRows: SettingRow[] = [
    { icon: "settings-outline", label: "設定", color: theme.colors.textSecondary, onPress: () => nav?.navigate?.("Settings") },
    { icon: "notifications-outline", label: "通知設定", color: "#FF9500", onPress: () => nav?.navigate?.("NotificationSettings") },
    { icon: "language-outline", label: "語言", color: "#5AC8FA", onPress: () => nav?.navigate?.("LanguageSettings"), value: "繁體中文" },
    { icon: "accessibility-outline", label: "無障礙設定", color: "#34C759", onPress: () => nav?.navigate?.("AccessibilitySettings") },
    { icon: "color-palette-outline", label: "主題預覽", color: "#FF6FA9", onPress: () => nav?.navigate?.("ThemePreview") },
  ];

  const supportRows: SettingRow[] = [
    { icon: "help-circle-outline", label: "幫助中心", color: "#5AC8FA", onPress: () => nav?.navigate?.("Help") },
    { icon: "chatbox-outline", label: "意見回饋", color: "#34C759", onPress: () => nav?.navigate?.("Feedback") },
    { icon: "bug-outline", label: "回報問題", color: "#FF9500", onPress: () => nav?.navigate?.("BugReport") },
  ];

  const dangerRows: SettingRow[] = auth.user
    ? [
        { icon: "download-outline", label: "匯出個人資料", color: theme.colors.textSecondary, onPress: () => nav?.navigate?.("DataExport") },
        {
          icon: "log-out-outline",
          label: "登出",
          color: theme.colors.danger,
          danger: true,
          onPress: () =>
            Alert.alert("確認登出", "確定要登出嗎？", [
              { text: "取消", style: "cancel" },
              { text: "登出", style: "destructive", onPress: () => auth.signOutWithWarning() },
            ]),
        },
        {
          icon: "trash-outline",
          label: "刪除帳號",
          color: theme.colors.danger,
          danger: true,
          onPress: () => nav?.navigate?.("AccountDeletion"),
        },
      ]
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING, paddingHorizontal: 20 }}
      >
        <View style={{ paddingTop: insets.top + 12, paddingBottom: 26 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>
            Profile
          </Text>
          <Text style={{ color: theme.colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1, marginTop: 8 }}>
            我的
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 10 }}>
            集中管理帳號、服務入口與個人化設定。
          </Text>
        </View>

        <View style={{ gap: 24 }}>
          <SoftPanel tint={theme.colors.accentSoft}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <View style={{ flexDirection: "row", gap: 16, flex: 1 }}>
                <View
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 28,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${theme.colors.accent}18`,
                    borderWidth: 1,
                    borderColor: `${theme.colors.accent}28`,
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 }}>
                    {avatarInitial}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }} numberOfLines={1}>
                    {identity}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 6 }} numberOfLines={1}>
                    {auth.user ? auth.user.email ?? "已登入校園帳號" : "登入後同步你的校務資料與通知"}
                  </Text>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.accentSoft,
                        borderWidth: 1,
                        borderColor: "transparent",
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "800" }}>{school.code}</Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: "700" }}>
                        {auth.profile?.department ?? school.name}
                      </Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: "700" }}>
                        {isDark ? "深色模式" : "淺色模式"}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <Pressable
                onPress={() => nav?.navigate?.("Settings")}
                style={({ pressed }) => ({
                  width: 46,
                  height: 46,
                  borderRadius: theme.radius.sm,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                })}
              >
                <Ionicons name="settings-outline" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            {auth.user ? (
              <View style={{ flexDirection: "row", gap: 12, marginTop: 22 }}>
                <ProfileStat label="修課數" value={`${courses.length}`} accent={theme.colors.accent} />
                <ProfileStat label="總學分" value={`${totalCredits}`} accent={theme.colors.success} />
                <ProfileStat label="未讀通知" value={`${notifs.unreadCount}`} accent={theme.colors.warning} />
              </View>
            ) : (
              <Pressable
                onPress={() => nav?.navigate?.("SSOLogin")}
                style={({ pressed }) => ({
                  marginTop: 22,
                  borderRadius: 22,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  backgroundColor: theme.colors.accent,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>立即登入校園帳號</Text>
              </Pressable>
            )}
          </SoftPanel>

          {(auth.isAdmin || auth.isEditor) ? (
            <Pressable onPress={() => nav?.navigate?.("AdminDashboard")}>
              {({ pressed }) => (
                <SoftPanel tint={theme.colors.accentSoft} style={{ opacity: pressed ? 0.84 : 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 18,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: theme.colors.accentSoft,
                      }}
                    >
                      <Ionicons name="shield-checkmark" size={22} color={theme.colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>管理控制台</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>審核、發布與後台維運入口</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
                  </View>
                </SoftPanel>
              )}
            </Pressable>
          ) : null}

          <View>
            <SectionHeading eyebrow="Account" title="帳號捷徑" />
            <SoftPanel tint="rgba(226,234,245,0.7)" padding={16}>
              <ServiceGrid
                items={[
                  {
                    icon: "person-outline",
                    label: "個人資料",
                    hint: auth.user ? "編輯基本資訊" : "登入後可編輯",
                    color: theme.colors.accent,
                    onPress: () => (auth.user ? nav?.navigate?.("ProfileEdit") : nav?.navigate?.("SSOLogin")),
                  },
                  {
                    icon: "notifications-outline",
                    label: "通知",
                    hint: "訊息與提醒中心",
                    color: "#FF9500",
                    onPress: () => nav?.navigate?.("Notifications"),
                    badge: notifs.unreadCount > 0 ? String(notifs.unreadCount) : undefined,
                  },
                  {
                    icon: isDark ? "sunny-outline" : "moon-outline",
                    label: isDark ? "切回淺色" : "切換深色",
                    hint: "調整整體觀感",
                    color: "#667EEA",
                    onPress: () => themeMode.setMode(isDark ? "light" : "dark"),
                  },
                  {
                    icon: "settings-outline",
                    label: "總設定",
                    hint: "偏好與權限管理",
                    color: theme.colors.textSecondary,
                    onPress: () => nav?.navigate?.("Settings"),
                  },
                ]}
              />
            </SoftPanel>
          </View>

          <View>
            <SectionHeading eyebrow="Services" title="常用入口" />
            <SoftPanel tint="rgba(226,234,245,0.7)" padding={16}>
              <ServiceGrid items={frequentServices} />
            </SoftPanel>
          </View>

          <View>
            <SectionHeading eyebrow="Campus Life" title="校園生活" />
            <SoftPanel tint="rgba(226,234,245,0.7)" padding={16}>
              <ServiceGrid items={campusLifeServices} />
            </SoftPanel>
          </View>

          <View>
            <SectionHeading eyebrow="More Tools" title="其他工具" />
            <SoftPanel tint="rgba(226,234,245,0.7)" padding={16}>
              <ServiceGrid items={otherServices} />
            </SoftPanel>
          </View>

          <ListSection title="帳號與偏好" rows={accountRows} />
          <ListSection title="App 設定" rows={settingRows} />
          <ListSection title="支援與回饋" rows={supportRows} />

          {dangerRows.length > 0 ? <ListSection title="帳號安全" rows={dangerRows} /> : null}

          <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: "center", marginTop: 4, marginBottom: 12 }}>
            校園整合 App · v1.0.0 · {isDark ? "深色" : "淺色"}模式
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
