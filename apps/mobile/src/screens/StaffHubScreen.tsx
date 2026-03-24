/* eslint-disable */
import React from "react";
import { RefreshControl, ScrollView, Text, View, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";

export function StaffHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = React.useState(false);
  const ds = useDataSource();
  const auth = useAuth();

  const [repairRequests, setRepairRequests] = React.useState([]);
  const [dormPackages, setDormPackages] = React.useState([]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (auth.user?.uid) {
        const [requests, packages] = await Promise.all([
          ds.listRepairRequests(auth.user.uid).catch(() => []),
          ds.listDormPackages(auth.user.uid).catch(() => []),
        ]);
        setRepairRequests(requests);
        setDormPackages(packages);
      }
    } catch (error) {
      console.error("[StaffHubScreen] Failed to refresh:", error);
    } finally {
      setRefreshing(false);
    }
  };

  React.useEffect(() => {
    onRefresh();
  }, []);

  const quickActions = [
    {
      label: "訂單管理",
      icon: "layers-outline" as const,
      onPress: () => {
        nav?.navigate("Cafeteria", {
          screen: "Ordering",
        });
      },
      color: theme.colors.accent,
    },
    {
      label: "維修報修",
      icon: "hammer-outline" as const,
      onPress: () => {
        nav?.navigate("Dormitory");
      },
      color: theme.colors.warning,
    },
    {
      label: "列印服務",
      icon: "print-outline" as const,
      onPress: () => {
        nav?.navigate("PrintService");
      },
      color: theme.colors.info,
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 20,
        }}
      >
        {/* Header */}
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: theme.colors.text }}>校園服務</Text>
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>設施管理與服務</Text>
        </View>

        {/* Pending Work Orders */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>待處理工單</Text>
            <Text style={{ fontSize: 12, color: theme.colors.danger }}>{repairRequests.length} 件待處理</Text>
          </View>
          <View style={{ gap: 8 }}>
            {repairRequests.slice(0, 3).map((order, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  gap: 12,
                  padding: 10,
                  backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                  borderRadius: 8,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View style={{ justifyContent: "center" }}>
                  <Ionicons name="warning-outline" size={16} color={theme.colors.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>{order.title || order.type}</Text>
                  <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                    {order.id} • {order.status}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Facility Status */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>設施狀態</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>本日統計</Text>
          </View>
          <View style={{ gap: 8 }}>
            {[
              { facility: "教室可用率", status: "92%", color: theme.colors.success },
              { facility: "維修中", status: `${repairRequests.filter(r => r.status === "inProgress").length} 件`, color: theme.colors.warning },
              { facility: "待處理", status: `${repairRequests.filter(r => r.status === "pending").length} 件`, color: theme.colors.danger },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 13, color: theme.colors.text }}>{item.facility}</Text>
                <Text style={{ fontSize: 12, fontWeight: "600", color: item.color }}>{item.status}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Dormitory Service */}
        <Pressable
          onPress={() => nav?.navigate("Dormitory")}
          style={({ pressed }) => ({
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.7 : 1,
            flexDirection: "row",
            alignItems: "center",
          })}
        >
          <Ionicons name="home-outline" size={28} color={theme.colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>宿舍服務</Text>
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>點擊查看宿舍相關服務</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
        </Pressable>

        {/* Quick Actions */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>快速入口</Text>
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "space-between" }}>
            {quickActions.map((action, i) => (
              <Pressable
                key={i}
                onPress={action.onPress}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: theme.colors.surface,
                  borderRadius: 12,
                  padding: 16,
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name={action.icon} size={28} color={action.color} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.text, textAlign: "center" }}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
