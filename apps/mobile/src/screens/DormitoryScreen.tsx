/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Button, AnimatedCard, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatDateTime } from "../utils/format";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import type { RepairRequest, DormPackage, WashingMachine, DormitoryInfo, DormAnnouncement } from "../data/types";

function getRepairTypeLabel(type: RepairRequest["type"]): string {
  const labels: Record<string, string> = {
    electrical: "電力",
    plumbing: "水管",
    furniture: "家具",
    ac: "冷氣",
    internet: "網路",
    other: "其他",
  };
  return labels[type] ?? type;
}

function getRepairTypeIcon(type: RepairRequest["type"]): string {
  const icons: Record<string, string> = {
    electrical: "flash",
    plumbing: "water",
    furniture: "bed",
    ac: "snow",
    internet: "wifi",
    other: "construct",
  };
  return icons[type] ?? "construct";
}

function getRepairStatusLabel(status: RepairRequest["status"]): string {
  const labels: Record<string, string> = {
    pending: "待處理",
    assigned: "已派工",
    inProgress: "處理中",
    completed: "已完成",
    cancelled: "已取消",
  };
  return labels[status] ?? status;
}

function getRepairStatusColor(status: RepairRequest["status"]): string {
  const colors: Record<string, string> = {
    pending: theme.colors.muted,
    assigned: "#F59E0B",
    inProgress: theme.colors.accent,
    completed: theme.colors.success,
    cancelled: theme.colors.danger,
  };
  return colors[status] ?? theme.colors.muted;
}

function getMachineStatusLabel(status: WashingMachine["status"]): string {
  const labels: Record<string, string> = {
    available: "可使用",
    inUse: "使用中",
    maintenance: "維修中",
    reserved: "已預約",
  };
  return labels[status] ?? status;
}

function getMachineStatusColor(status: WashingMachine["status"]): string {
  const colors: Record<string, string> = {
    available: theme.colors.success,
    inUse: "#F59E0B",
    maintenance: theme.colors.danger,
    reserved: theme.colors.accent,
  };
  return colors[status] ?? theme.colors.muted;
}

export function DormitoryScreen(_props: any) {
  const ds = useDataSource();
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [dormInfo, setDormInfo] = useState<DormitoryInfo | null>(null);
  const [repairs, setRepairs] = useState<RepairRequest[]>([]);
  const [packages, setPackages] = useState<DormPackage[]>([]);
  const [machines, setMachines] = useState<WashingMachine[]>([]);
  const [announcements, setAnnouncements] = useState<DormAnnouncement[]>([]);

  const TABS = ["概覽", "報修", "包裹", "洗衣"];

  const pendingPackages = useMemo(() => packages.filter((p) => p.status === "pending"), [packages]);
  const activeRepairs = useMemo(() => repairs.filter((r) => r.status !== "completed" && r.status !== "cancelled"), [repairs]);
  const availableWashers = useMemo(() => machines.filter((m) => m.type === "washer" && m.status === "available").length, [machines]);
  const availableDryers = useMemo(() => machines.filter((m) => m.type === "dryer" && m.status === "available").length, [machines]);

  const loadData = useCallback(async () => {
    if (!auth.user?.uid) return;
    
    try {
      const [dormInfoData, repairsData, packagesData, machinesData, announcementsData] = await Promise.all([
        ds.getDormitoryInfo(auth.user.uid).catch(() => null),
        ds.listRepairRequests(auth.user.uid, undefined, school?.id).catch(() => []),
        ds.listDormPackages(auth.user.uid, undefined, school?.id).catch(() => []),
        ds.listWashingMachines(school?.id, dormInfo?.building).catch(() => []),
        ds.listDormAnnouncements(school?.id, dormInfo?.building).catch(() => []),
      ]);
      
      setDormInfo(dormInfoData);
      setRepairs(repairsData);
      setPackages(packagesData);
      setMachines(machinesData);
      setAnnouncements(announcementsData);
    } catch (error) {
      console.error("[DormitoryScreen] Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, [ds, auth.user?.uid, school?.id, dormInfo?.building]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSubmitRepair = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能提交報修請求");
      return;
    }
    
    Alert.alert(
      "報修類型",
      "請選擇報修類型",
      [
        { text: "冷氣問題", onPress: () => createRepair("ac") },
        { text: "水電問題", onPress: () => createRepair("plumbing") },
        { text: "網路問題", onPress: () => createRepair("internet") },
        { text: "家具問題", onPress: () => createRepair("furniture") },
        { text: "取消", style: "cancel" },
      ]
    );
  };

  const createRepair = async (type: RepairRequest["type"]) => {
    Alert.prompt(
      "問題描述",
      "請簡述您遇到的問題",
      [
        { text: "取消", style: "cancel" },
        {
          text: "送出",
          onPress: async (description) => {
            if (!description?.trim()) {
              Alert.alert("請輸入問題描述");
              return;
            }
            
            try {
              const newRepair = await ds.createRepairRequest({
                type,
                title: `${getRepairTypeLabel(type)}問題`,
                description: description,
                room: dormInfo?.building && dormInfo?.room ? `${dormInfo.building} ${dormInfo.room}` : "未指定",
                userId: auth.user!.uid,
                schoolId: school?.id,
              });
              setRepairs([newRepair, ...repairs]);
              Alert.alert("報修成功", "維修人員將盡快處理您的報修請求");
            } catch {
              Alert.alert("報修失敗", "請稍後再試");
            }
          },
        },
      ],
      "plain-text"
    );
  };

  const handlePickPackage = (packageId: string) => {
    Alert.alert(
      "確認取件",
      "確定已取得此包裹嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認",
          onPress: async () => {
            try {
              await ds.confirmPackagePickup(packageId, school?.id);
              setPackages(packages.map((p) => (p.id === packageId ? { ...p, status: "picked" as const, pickedAt: new Date().toISOString() } : p)));
            } catch {
              Alert.alert("操作失敗", "請稍後再試");
            }
          },
        },
      ]
    );
  };

  const handleReserveWasher = async (machine: WashingMachine) => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能預約洗衣機");
      return;
    }
    
    if (machine.status !== "available") return;

    Alert.alert(
      "預約確認",
      `確定要預約 ${machine.type === "washer" ? "洗衣機" : "烘乾機"} ${machine.number} 號嗎？\n\n位置：${machine.floor}\n費用：$${machine.price}`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認預約",
          onPress: async () => {
            try {
              await ds.reserveWashingMachine(machine.id, auth.user!.uid, school?.id);
              setMachines(machines.map((m) => 
                m.id === machine.id ? { ...m, status: "reserved" as const, reservedBy: auth.user!.uid } : m
              ));
              Alert.alert("預約成功", `請在 10 分鐘內前往使用，逾時自動取消預約`);
            } catch (error: any) {
              Alert.alert("預約失敗", error?.message ?? "請稍後再試");
            }
          },
        },
      ]
    );
  };
  
  const handleAccessApplication = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能申請門禁");
      return;
    }
    
    Alert.alert(
      "門禁申請",
      "請選擇申請類型",
      [
        { 
          text: "延長門禁時間", 
          onPress: () => {
            Alert.prompt(
              "延長門禁",
              "請輸入預計返回時間（如：23:30）",
              [
                { text: "取消", style: "cancel" },
                {
                  text: "提交申請",
                  onPress: async (time) => {
                    if (!time?.trim()) {
                      Alert.alert("請輸入有效時間");
                      return;
                    }
                    try {
                      await ds.createAccessApplication({
                        userId: auth.user!.uid,
                        type: "extended_hours",
                        requestedTime: time,
                        reason: "個人需求",
                        schoolId: school?.id,
                      });
                      Alert.alert("申請成功", "您的門禁延長申請已提交，請等待審核");
                    } catch (error: any) {
                      Alert.alert("申請失敗", error?.message ?? "請稍後再試");
                    }
                  },
                },
              ],
              "plain-text"
            );
          }
        },
        { 
          text: "臨時出入申請", 
          onPress: () => {
            Alert.prompt(
              "臨時出入申請",
              "請輸入出入原因",
              [
                { text: "取消", style: "cancel" },
                {
                  text: "提交申請",
                  onPress: async (reason) => {
                    if (!reason?.trim()) {
                      Alert.alert("請輸入有效原因");
                      return;
                    }
                    try {
                      await ds.createAccessApplication({
                        userId: auth.user!.uid,
                        type: "temporary_access",
                        reason: reason,
                        schoolId: school?.id,
                      });
                      Alert.alert("申請成功", "您的臨時出入申請已提交，請等待審核");
                    } catch (error: any) {
                      Alert.alert("申請失敗", error?.message ?? "請稍後再試");
                    }
                  },
                },
              ],
              "plain-text"
            );
          }
        },
        { text: "取消", style: "cancel" },
      ]
    );
  };

  const handleLateReturnRegistration = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能進行夜歸登記");
      return;
    }
    
    const now = new Date();
    const hours = now.getHours();
    
    if (hours < 22 && hours >= 6) {
      Alert.alert("提醒", "夜歸登記僅在晚間 22:00 至隔日 06:00 之間可使用");
      return;
    }
    
    Alert.alert(
      "夜歸登記",
      `確定要進行夜歸登記嗎？\n\n登記時間：${now.toLocaleString("zh-TW")}\n宿舍：${dormInfo?.building ?? "未知"} ${dormInfo?.room ?? ""}`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認登記",
          onPress: async () => {
            try {
              await ds.createLateReturnRecord({
                userId: auth.user!.uid,
                building: dormInfo?.building,
                room: dormInfo?.room,
                returnTime: now.toISOString(),
                schoolId: school?.id,
              });
              Alert.alert("登記成功", "夜歸登記已完成，請注意安全");
            } catch (error: any) {
              Alert.alert("登記失敗", error?.message ?? "請稍後再試");
            }
          },
        },
      ]
    );
  };

  const handleVisitorRegistration = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能進行訪客登記");
      return;
    }
    
    Alert.prompt(
      "訪客登記",
      "請輸入訪客姓名",
      [
        { text: "取消", style: "cancel" },
        {
          text: "下一步",
          onPress: (visitorName) => {
            if (!visitorName?.trim()) {
              Alert.alert("請輸入有效姓名");
              return;
            }
            
            Alert.prompt(
              "訪客登記",
              "請輸入訪客聯絡電話",
              [
                { text: "取消", style: "cancel" },
                {
                  text: "下一步",
                  onPress: (visitorPhone) => {
                    if (!visitorPhone?.trim()) {
                      Alert.alert("請輸入有效電話");
                      return;
                    }
                    
                    Alert.alert(
                      "訪客登記",
                      "請選擇預計離開時間",
                      [
                        { text: "1 小時內", onPress: () => submitVisitorRegistration(visitorName, visitorPhone, 1) },
                        { text: "2 小時內", onPress: () => submitVisitorRegistration(visitorName, visitorPhone, 2) },
                        { text: "3 小時內", onPress: () => submitVisitorRegistration(visitorName, visitorPhone, 3) },
                        { text: "取消", style: "cancel" },
                      ]
                    );
                  },
                },
              ],
              "plain-text",
              "",
              "phone-pad"
            );
          },
        },
      ],
      "plain-text"
    );
  };
  
  const submitVisitorRegistration = async (name: string, phone: string, hours: number) => {
    try {
      const expectedLeave = new Date();
      expectedLeave.setHours(expectedLeave.getHours() + hours);
      
      await ds.createVisitorRecord({
        userId: auth.user!.uid,
        visitorName: name,
        visitorPhone: phone,
        building: dormInfo?.building,
        room: dormInfo?.room,
        arrivalTime: new Date().toISOString(),
        expectedLeaveTime: expectedLeave.toISOString(),
        schoolId: school?.id,
      });
      Alert.alert(
        "登記成功", 
        `訪客 ${name} 已登記\n預計離開時間：${expectedLeave.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`
      );
    } catch (error: any) {
      Alert.alert("登記失敗", error?.message ?? "請稍後再試");
    }
  };
  
  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="宿舍資訊">
                {dormInfo ? (
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="home" size={20} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>房號</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{dormInfo.building} {dormInfo.room}</Text>
                      </View>
                    </View>
                    {dormInfo.roommates && dormInfo.roommates.length > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Ionicons name="people" size={20} color={theme.colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>室友</Text>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{dormInfo.roommates.join("、")}</Text>
                        </View>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="calendar" size={20} color={theme.colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>住宿期間</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                          {dormInfo.startDate.split("T")[0].replace(/-/g, "/")} - {dormInfo.endDate.split("T")[0].replace(/-/g, "/")}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={{ alignItems: "center", paddingVertical: 20 }}>
                    <Ionicons name="home-outline" size={40} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 8 }}>尚未登記宿舍資訊</Text>
                  </View>
                )}
              </AnimatedCard>

              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  onPress={() => setSelectedTab(2)}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: theme.radius.lg,
                    backgroundColor: pendingPackages.length > 0 ? theme.colors.accentSoft : theme.colors.surface2,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: pendingPackages.length > 0 ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: pendingPackages.length > 0 ? theme.colors.accent : theme.colors.muted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons name="cube" size={24} color="#fff" />
                  </View>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 24 }}>
                    {pendingPackages.length}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>待取包裹</Text>
                </Pressable>

                <Pressable
                  onPress={() => setSelectedTab(1)}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: theme.radius.lg,
                    backgroundColor: activeRepairs.length > 0 ? "#F59E0B15" : theme.colors.surface2,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: activeRepairs.length > 0 ? "#F59E0B" : theme.colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: activeRepairs.length > 0 ? "#F59E0B" : theme.colors.muted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons name="construct" size={24} color="#fff" />
                  </View>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 24 }}>
                    {activeRepairs.length}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>進行中報修</Text>
                </Pressable>
              </View>

              <AnimatedCard title="洗衣設備" subtitle="即時狀態" delay={100}>
                <View style={{ flexDirection: "row", gap: 20 }}>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        backgroundColor: `${theme.colors.success}20`,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 8,
                      }}
                    >
                      <Ionicons name="water" size={28} color={theme.colors.success} />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 20 }}>
                      {availableWashers}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>可用洗衣機</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center" }}>
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        backgroundColor: `${theme.colors.accent}20`,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 8,
                      }}
                    >
                      <Ionicons name="sunny" size={28} color={theme.colors.accent} />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 20 }}>
                      {availableDryers}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>可用烘乾機</Text>
                  </View>
                </View>
                <Button text="查看詳情" onPress={() => setSelectedTab(3)} style={{ marginTop: 16 }} />
              </AnimatedCard>

              <AnimatedCard title="快捷服務" delay={150}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {[
                    { icon: "construct", label: "報修", onPress: handleSubmitRepair },
                    { icon: "document-text", label: "門禁申請", onPress: handleAccessApplication },
                    { icon: "moon", label: "夜歸登記", onPress: handleLateReturnRegistration },
                    { icon: "person-add", label: "訪客登記", onPress: handleVisitorRegistration },
                  ].map((item) => (
                    <Pressable
                      key={item.label}
                      onPress={item.onPress}
                      style={{
                        width: "47%",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Ionicons name={item.icon as any} size={24} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              {announcements.length > 0 && (
                <AnimatedCard title="重要公告" delay={200}>
                  <View style={{ gap: 10 }}>
                    {announcements.slice(0, 3).map((announcement) => {
                      const typeColors: Record<string, string> = {
                        notice: theme.colors.accent,
                        warning: "#F59E0B",
                        emergency: theme.colors.danger,
                        maintenance: "#6366F1",
                      };
                      const color = typeColors[announcement.type] ?? theme.colors.muted;
                      
                      return (
                        <View
                          key={announcement.id}
                          style={{
                            padding: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor: `${color}15`,
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: 10,
                          }}
                        >
                          <Ionicons 
                            name={announcement.type === "emergency" ? "warning" : "alert-circle"} 
                            size={20} 
                            color={color} 
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={{ color, fontWeight: "700" }}>{announcement.title}</Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                              {announcement.content}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </AnimatedCard>
              )}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <Button text="新增報修" kind="primary" onPress={handleSubmitRepair} />

              {repairs.map((repair, idx) => (
                <AnimatedCard key={repair.id} delay={idx * 50}>
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          backgroundColor: `${getRepairStatusColor(repair.status)}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name={getRepairTypeIcon(repair.type) as any} size={22} color={getRepairStatusColor(repair.status)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>
                            {repair.title}
                          </Text>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: `${getRepairStatusColor(repair.status)}20`,
                            }}
                          >
                            <Text style={{ color: getRepairStatusColor(repair.status), fontSize: 11, fontWeight: "600" }}>
                              {getRepairStatusLabel(repair.status)}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                          {repair.description}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 6 }}>
                          {repair.room} · {formatDateTime(new Date(repair.createdAt))}
                        </Text>
                      </View>
                    </View>
                    {repair.status === "completed" && repair.completedAt && (
                      <View
                        style={{
                          padding: 10,
                          borderRadius: theme.radius.md,
                          backgroundColor: `${theme.colors.success}15`,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                        <Text style={{ color: theme.colors.success, fontSize: 12 }}>
                          已於 {formatDateTime(new Date(repair.completedAt))} 完成維修
                        </Text>
                      </View>
                    )}
                  </View>
                </AnimatedCard>
              ))}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {packages.filter((p) => p.status === "pending").length > 0 && (
                <AnimatedCard title="待取包裹" subtitle={`${pendingPackages.length} 件`}>
                  <View style={{ gap: 10 }}>
                    {packages
                      .filter((p) => p.status === "pending")
                      .map((pkg) => (
                        <View
                          key={pkg.id}
                          style={{
                            padding: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor: theme.colors.surface2,
                            gap: 8,
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <View
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 20,
                                  backgroundColor: theme.colors.accentSoft,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Ionicons name="cube" size={20} color={theme.colors.accent} />
                              </View>
                              <View>
                                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{pkg.carrier}</Text>
                                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{pkg.trackingNumber}</Text>
                              </View>
                            </View>
                            <Pressable
                              onPress={() => handlePickPackage(pkg.id)}
                              style={{
                                paddingHorizontal: 12,
                                paddingVertical: 6,
                                borderRadius: theme.radius.full,
                                backgroundColor: theme.colors.accent,
                              }}
                            >
                              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12 }}>已取件</Text>
                            </Pressable>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="location" size={14} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{pkg.location}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="time" size={14} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                                {formatDateTime(new Date(pkg.arrivedAt))}
                              </Text>
                            </View>
                          </View>
                        </View>
                      ))}
                  </View>
                </AnimatedCard>
              )}

              <AnimatedCard title="歷史紀錄" delay={100}>
                <View style={{ gap: 10 }}>
                  {packages
                    .filter((p) => p.status === "picked")
                    .map((pkg) => (
                      <View
                        key={pkg.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          paddingVertical: 8,
                          gap: 12,
                          opacity: 0.6,
                        }}
                      >
                        <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text }}>{pkg.carrier}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{pkg.trackingNumber}</Text>
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已取件</Text>
                      </View>
                    ))}
                </View>
              </AnimatedCard>
            </View>
          )}

          {selectedTab === 3 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="洗衣機" subtitle={`${availableWashers} 台可用`}>
                <View style={{ gap: 10 }}>
                  {machines.filter((m) => m.type === "washer").map((machine) => (
                    <Pressable
                      key={machine.id}
                      onPress={() => handleReserveWasher(machine)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: machine.status === "available" ? theme.colors.surface2 : theme.colors.surface,
                        gap: 12,
                        opacity: machine.status === "maintenance" ? 0.5 : 1,
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: `${getMachineStatusColor(machine.status)}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="water" size={22} color={getMachineStatusColor(machine.status)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                          {machine.number} 號洗衣機
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {machine.floor}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: theme.radius.full,
                            backgroundColor: `${getMachineStatusColor(machine.status)}20`,
                          }}
                        >
                          <Text style={{ color: getMachineStatusColor(machine.status), fontSize: 11, fontWeight: "600" }}>
                            {getMachineStatusLabel(machine.status)}
                          </Text>
                        </View>
                        {machine.status === "inUse" && machine.remainingTime && (
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                            剩餘 {machine.remainingTime} 分
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="烘乾機" subtitle={`${availableDryers} 台可用`} delay={100}>
                <View style={{ gap: 10 }}>
                  {machines.filter((m) => m.type === "dryer").map((machine) => (
                    <Pressable
                      key={machine.id}
                      onPress={() => handleReserveWasher(machine)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: machine.status === "available" ? theme.colors.surface2 : theme.colors.surface,
                        gap: 12,
                        opacity: machine.status === "maintenance" ? 0.5 : 1,
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: `${getMachineStatusColor(machine.status)}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="sunny" size={22} color={getMachineStatusColor(machine.status)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                          {machine.number} 號烘乾機
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {machine.floor}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: theme.radius.full,
                            backgroundColor: `${getMachineStatusColor(machine.status)}20`,
                          }}
                        >
                          <Text style={{ color: getMachineStatusColor(machine.status), fontSize: 11, fontWeight: "600" }}>
                            {getMachineStatusLabel(machine.status)}
                          </Text>
                        </View>
                        {machine.status === "inUse" && machine.remainingTime && (
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                            剩餘 {machine.remainingTime} 分
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="費用說明" delay={150}>
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>洗衣機（每次）</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$20</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: theme.colors.muted }}>烘乾機（每次）</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>$10</Text>
                  </View>
                </View>
              </AnimatedCard>
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}
