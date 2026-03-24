/* eslint-disable */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, RefreshControl, Linking, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Button, AnimatedCard, SegmentedControl, Pill } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { formatDateTime, formatDate } from "../utils/format";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import type { HealthAppointment, HealthRecord, HealthTimeSlot, HealthDepartment } from "../data/types";

type HealthService = {
  id: string;
  name: string;
  location: string;
  hours: string;
  phone: string;
  services: string[];
  isOpen: boolean;
};

const HEALTH_SERVICES: HealthService[] = [
  {
    id: "h1",
    name: "校園健康中心",
    location: "行政大樓 1F",
    hours: "08:00 - 17:00",
    phone: "04-1234-5678",
    services: ["一般門診", "健康諮詢", "疫苗接種", "健康檢查"],
    isOpen: true,
  },
  {
    id: "h2",
    name: "校園心理諮商中心",
    location: "學生活動中心 3F",
    hours: "09:00 - 18:00",
    phone: "04-1234-5679",
    services: ["個別諮商", "團體諮商", "心理測驗", "危機處理"],
    isOpen: true,
  },
  {
    id: "h3",
    name: "急救站",
    location: "體育館 1F",
    hours: "運動時間開放",
    phone: "04-1234-5680",
    services: ["運動傷害處理", "緊急救護"],
    isOpen: false,
  },
];

const EMERGENCY_CONTACTS = [
  { name: "校園緊急專線", phone: "04-1234-9999", icon: "warning" },
  { name: "健康中心", phone: "04-1234-5678", icon: "medical" },
  { name: "心理諮商", phone: "04-1234-5679", icon: "heart" },
  { name: "119 消防", phone: "119", icon: "flame" },
];

function getRecordTypeIcon(type: HealthRecord["type"]): string {
  const icons: Record<string, string> = {
    appointment: "calendar",
    vaccination: "medkit",
    checkup: "clipboard",
    prescription: "document-text",
  };
  return icons[type] ?? "medical";
}

function getRecordTypeLabel(type: HealthRecord["type"]): string {
  const labels: Record<string, string> = {
    appointment: "門診就醫",
    vaccination: "疫苗接種",
    checkup: "健康檢查",
    prescription: "處方箋",
  };
  return labels[type] ?? type;
}

function getDepartmentLabel(department: HealthDepartment): string {
  const labels: Record<string, string> = {
    general: "一般門診",
    dental: "牙科",
    mental: "心理諮商",
    physical: "物理治療",
    vaccination: "疫苗接種",
  };
  return labels[department] ?? department;
}

export function HealthScreen(props: any) {
  const nav = props?.navigation;
  const ds = useDataSource();
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [appointments, setAppointments] = useState<HealthAppointment[]>([]);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [timeSlots, setTimeSlots] = useState<HealthTimeSlot[]>([]);

  const TABS = ["概覽", "預約", "紀錄", "服務"];

  const loadData = useCallback(async () => {
    if (!auth.user?.uid) {
      setLoading(false);
      return;
    }
    
    try {
      const [appointmentsData, recordsData] = await Promise.all([
        ds.listHealthAppointments(auth.user.uid, undefined, school?.id).catch(() => []),
        ds.listHealthRecords(auth.user.uid, undefined, school?.id).catch(() => []),
      ]);
      
      setAppointments(appointmentsData);
      setRecords(recordsData);
    } catch (error) {
      console.error("[HealthScreen] Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, [ds, auth.user?.uid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleCallPhone = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const handleBookAppointment = () => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能預約門診");
      return;
    }
    
    Alert.alert(
      "預約門診",
      "請選擇科別",
      [
        { text: "一般門診", onPress: () => selectTimeSlot("general") },
        { text: "牙科", onPress: () => selectTimeSlot("dental") },
        { text: "心理諮商", onPress: () => selectTimeSlot("mental") },
        { text: "取消", style: "cancel" },
      ]
    );
  };

  const selectTimeSlot = async (department: HealthDepartment) => {
    const today = new Date().toISOString().split("T")[0];
    try {
      const slots = await ds.listHealthTimeSlots(department, today, school?.id);
      setTimeSlots(slots);
      
      const availableSlots = slots.filter(s => s.available);
      if (availableSlots.length === 0) {
        Alert.alert("抱歉", "今日已無可用時段，請嘗試其他日期");
        return;
      }
      
      const firstAvailable = availableSlots[0];
      confirmBooking(department, firstAvailable);
    } catch (error) {
      confirmBooking(department, null);
    }
  };

  const confirmBooking = async (department: HealthDepartment, slot: HealthTimeSlot | null) => {
    const departmentLabel = getDepartmentLabel(department);
    const timeInfo = slot ? `\n時段：${slot.time}${slot.doctorName ? `\n醫師：${slot.doctorName}` : ""}` : "";
    
    Alert.alert(
      "預約確認",
      `確定預約 ${departmentLabel} 嗎？${timeInfo}\n\n${slot ? "" : "可選時段將由系統自動安排"}`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "確認預約",
          onPress: async () => {
            try {
              const newAppointment = await ds.createHealthAppointment({
                userId: auth.user!.uid,
                department,
                doctorId: slot?.doctorId,
                doctorName: slot?.doctorName,
                date: slot?.date ?? new Date().toISOString().split("T")[0],
                timeSlot: slot?.time ?? "待安排",
                reason: undefined,
                notes: undefined,
                schoolId: school?.id,
              });
              setAppointments([newAppointment, ...appointments]);
              Alert.alert("預約成功", "詳情請查看預約頁面");
            } catch (error: any) {
              Alert.alert("預約失敗", error?.message ?? "請稍後再試");
            }
          },
        },
      ]
    );
  };

  const handleCancelAppointment = (appointmentId: string) => {
    Alert.alert(
      "取消預約",
      "確定要取消此預約嗎？",
      [
        { text: "否", style: "cancel" },
        {
          text: "是",
          style: "destructive",
          onPress: async () => {
            try {
              await ds.cancelHealthAppointment(appointmentId, school?.id);
              setAppointments(appointments.map(a => 
                a.id === appointmentId ? { ...a, status: "cancelled" as const } : a
              ));
              Alert.alert("已取消", "預約已成功取消");
            } catch (error: any) {
              Alert.alert("取消失敗", error?.message ?? "請稍後再試");
            }
          },
        },
      ]
    );
  };
  
  const handleRescheduleAppointment = async (apt: HealthAppointment) => {
    try {
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      
      const slots = await ds.listHealthTimeSlots(
        apt.department, 
        today.toISOString().split("T")[0], 
        school?.id
      );
      
      const availableSlots = slots.filter(s => s.available && s.date !== apt.date);
      
      if (availableSlots.length === 0) {
        Alert.alert("抱歉", "目前沒有其他可用時段，請稍後再試或聯繫健康中心");
        return;
      }
      
      const slotOptions = availableSlots.slice(0, 5).map(slot => ({
        text: `${slot.date} ${slot.time}${slot.doctorName ? ` - ${slot.doctorName}` : ""}`,
        onPress: async () => {
          try {
            await ds.rescheduleHealthAppointment(apt.id, {
              date: slot.date,
              timeSlot: slot.time,
              doctorId: slot.doctorId,
              doctorName: slot.doctorName,
            }, school?.id);
            
            setAppointments(appointments.map(a => 
              a.id === apt.id ? { 
                ...a, 
                date: slot.date, 
                timeSlot: slot.time,
                doctorId: slot.doctorId,
                doctorName: slot.doctorName,
              } : a
            ));
            
            Alert.alert("更改成功", `預約已更改至 ${slot.date} ${slot.time}`);
          } catch (error: any) {
            Alert.alert("更改失敗", error?.message ?? "請稍後再試");
          }
        },
      }));
      
      Alert.alert(
        "選擇新時段",
        `目前預約：${apt.date} ${apt.timeSlot}\n\n請選擇新的預約時段：`,
        [
          ...slotOptions,
          { text: "取消", style: "cancel" },
        ]
      );
    } catch (error: any) {
      Alert.alert("載入失敗", "無法取得可用時段，請稍後再試");
    }
  };
  
  const handleShowHealthInfo = () => {
    Alert.alert(
      "校園健康資訊",
      "請選擇查看項目",
      [
        { 
          text: "流感疫苗資訊", 
          onPress: () => showHealthInfoDetail("flu")
        },
        { 
          text: "健康檢查須知", 
          onPress: () => showHealthInfoDetail("checkup")
        },
        { 
          text: "心理健康資源", 
          onPress: () => showHealthInfoDetail("mental")
        },
        { 
          text: "急救常識", 
          onPress: () => showHealthInfoDetail("firstaid")
        },
        { text: "關閉", style: "cancel" },
      ]
    );
  };
  
  const showHealthInfoDetail = (type: string) => {
    const infoContent: Record<string, { title: string; content: string }> = {
      flu: {
        title: "流感疫苗接種資訊",
        content: `📋 接種對象：全校師生

⏰ 接種時間：
• 週一至週五 09:00-12:00, 14:00-17:00
• 健康中心 1 樓

💉 注意事項：
• 請攜帶學生證/教職員證
• 接種前請確認無發燒症狀
• 若有過敏史請事先告知
• 接種後請在現場休息 15 分鐘

💰 費用：免費（學校補助）

📞 預約電話：04-1234-5678`,
      },
      checkup: {
        title: "健康檢查須知",
        content: `📋 新生入學健康檢查

⏰ 檢查時段：
• 開學前兩週
• 需事先預約

📝 檢查項目：
• 身高體重測量
• 視力聽力檢查
• 血壓測量
• 尿液常規檢查
• 胸部 X 光（新生）

⚠️ 注意事項：
• 檢查前 8 小時禁食（可喝水）
• 請穿著輕便服裝
• 攜帶健保卡及學生證

📍 地點：健康中心 1 樓`,
      },
      mental: {
        title: "心理健康資源",
        content: `🧠 校園心理諮商中心

📍 位置：學生活動中心 3 樓

⏰ 服務時間：
• 週一至週五 09:00-18:00
• 採預約制

📱 預約方式：
• 線上預約系統
• 電話預約：04-1234-5679
• 現場預約

🤝 服務項目：
• 個別諮商（每次 50 分鐘）
• 團體諮商
• 心理測驗
• 生涯規劃諮詢

💡 小提醒：
所有諮商內容皆嚴格保密
如有緊急情況請撥打校園緊急專線`,
      },
      firstaid: {
        title: "急救常識",
        content: `🚑 緊急聯絡：

• 校園緊急專線：04-1234-9999
• 健康中心：04-1234-5678
• 119 消防救護

📍 AED 位置：
• 行政大樓 1F 入口
• 圖書館 1F 大廳
• 體育館入口
• 學生餐廳入口

🩹 基本急救步驟：

1️⃣ 評估環境安全
2️⃣ 確認意識反應
3️⃣ 呼叫 119 / 校園專線
4️⃣ 施行 CPR（若無呼吸心跳）
5️⃣ 使用 AED

⚠️ 注意：
• 不隨意移動傷患
• 保持傷患溫暖
• 記錄事發經過`,
      },
    };
    
    const info = infoContent[type];
    if (info) {
      Alert.alert(info.title, info.content, [{ text: "關閉" }]);
    }
  };
  
  const upcomingAppointments = useMemo(() => 
    appointments.filter(a => a.status === "scheduled" && new Date(a.date) >= new Date()),
    [appointments]
  );

  const lastCheckupDays = useMemo(() => {
    const checkup = records.find(r => r.type === "checkup");
    if (!checkup) return null;
    const days = Math.floor((Date.now() - new Date(checkup.date).getTime()) / 86400000);
    return days;
  }, [records]);
  
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
              <AnimatedCard>
                <View
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    backgroundColor: `${theme.colors.success}15`,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      backgroundColor: theme.colors.success,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark" size={28} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.success, fontWeight: "700", fontSize: 16 }}>
                      健康狀態良好
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      {lastCheckupDays != null
                        ? `上次健康檢查：${lastCheckupDays} 天前`
                        : "尚無健康檢查紀錄"}
                    </Text>
                  </View>
                </View>
              </AnimatedCard>

              {upcomingAppointments.length > 0 && (
                <AnimatedCard title="即將到來的預約" delay={50}>
                  {upcomingAppointments.map((apt) => {
                    const aptDate = new Date(apt.date);
                    return (
                      <Pressable
                        key={apt.id}
                        onPress={() => setSelectedTab(1)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.accentSoft,
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 12,
                            backgroundColor: theme.colors.accent,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
                            {aptDate.getDate()}
                          </Text>
                          <Text style={{ color: "#fff", fontSize: 10 }}>
                            {aptDate.toLocaleDateString("zh-TW", { month: "short" })}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
                            {getDepartmentLabel(apt.department)} {apt.doctorName ? `- ${apt.doctorName}` : ""}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                            {apt.timeSlot}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
                      </Pressable>
                    );
                  })}
                </AnimatedCard>
              )}

              <AnimatedCard title="緊急聯絡" delay={100}>
                <View style={{ gap: 10 }}>
                  {EMERGENCY_CONTACTS.map((contact) => (
                    <Pressable
                      key={contact.name}
                      onPress={() => handleCallPhone(contact.phone)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: contact.name.includes("119") ? `${theme.colors.danger}20` : theme.colors.accentSoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={contact.icon as any}
                          size={20}
                          color={contact.name.includes("119") ? theme.colors.danger : theme.colors.accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{contact.name}</Text>
                        <Text style={{ color: theme.colors.accent, fontSize: 13, marginTop: 2 }}>
                          {contact.phone}
                        </Text>
                      </View>
                      <Ionicons name="call" size={20} color={theme.colors.accent} />
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="快捷服務" delay={150}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    onPress={handleBookAppointment}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      padding: 16,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface2,
                      gap: 8,
                    }}
                  >
                    <Ionicons name="calendar" size={28} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>預約門診</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSelectedTab(2)}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      padding: 16,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface2,
                      gap: 8,
                    }}
                  >
                    <Ionicons name="document-text" size={28} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>健康紀錄</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleShowHealthInfo}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      padding: 16,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface2,
                      gap: 8,
                    }}
                  >
                    <Ionicons name="information-circle" size={28} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>健康資訊</Text>
                  </Pressable>
                </View>
              </AnimatedCard>

              <AnimatedCard title="健康提醒" delay={200}>
                <View style={{ gap: 10 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: "#F59E0B15",
                      gap: 10,
                    }}
                  >
                    <Ionicons name="medkit" size={20} color="#F59E0B" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#F59E0B", fontWeight: "600" }}>流感疫苗接種</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                        建議每年接種流感疫苗，健康中心目前開放預約
                      </Text>
                    </View>
                  </View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: `${theme.colors.accent}15`,
                      gap: 10,
                    }}
                  >
                    <Ionicons name="clipboard" size={20} color={theme.colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>定期健康檢查</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                        {lastCheckupDays != null
                          ? `距離上次健檢已過 ${lastCheckupDays} 天，建議每學期進行一次健康檢查`
                          : "尚無健康檢查紀錄，建議進行健康檢查"}
                      </Text>
                    </View>
                  </View>
                </View>
              </AnimatedCard>
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <Button text="預約新門診" kind="primary" onPress={handleBookAppointment} />

              {appointments.filter(a => a.status !== "cancelled").length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
                    <Ionicons name="calendar-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      尚無預約
                    </Text>
                  </View>
                </AnimatedCard>
              ) : (
                appointments
                  .filter(a => a.status !== "cancelled")
                  .map((apt, idx) => {
                    const aptDate = new Date(apt.date);
                    const statusConfig = {
                      scheduled: { label: "已確認", color: theme.colors.success },
                      completed: { label: "已完成", color: theme.colors.muted },
                      cancelled: { label: "已取消", color: theme.colors.danger },
                    };
                    const status = statusConfig[apt.status] ?? statusConfig.scheduled;
                    
                    return (
                      <AnimatedCard key={apt.id} delay={idx * 50}>
                        <View style={{ gap: 12 }}>
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                            <View
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 14,
                                backgroundColor: theme.colors.accentSoft,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 20 }}>
                                {aptDate.getDate()}
                              </Text>
                              <Text style={{ color: theme.colors.accent, fontSize: 11 }}>
                                {aptDate.toLocaleDateString("zh-TW", { month: "short" })}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                                {getDepartmentLabel(apt.department)}
                              </Text>
                              <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
                                {apt.doctorName ?? "待安排"} · {apt.timeSlot}
                              </Text>
                              {apt.reason && (
                                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                                  原因：{apt.reason}
                                </Text>
                              )}
                              <View
                                style={{
                                  marginTop: 8,
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: theme.radius.full,
                                  backgroundColor: `${status.color}20`,
                                  alignSelf: "flex-start",
                                }}
                              >
                                <Text style={{ color: status.color, fontSize: 11, fontWeight: "600" }}>
                                  {status.label}
                                </Text>
                              </View>
                            </View>
                          </View>
                          {apt.status === "scheduled" && (
                            <View style={{ flexDirection: "row", gap: 10 }}>
                              <Button
                                text="取消預約"
                                onPress={() => handleCancelAppointment(apt.id)}
                                style={{ flex: 1 }}
                              />
                              <Button
                                text="更改時間"
                                kind="primary"
                                onPress={() => handleRescheduleAppointment(apt)}
                                style={{ flex: 1 }}
                              />
                            </View>
                          )}
                        </View>
                      </AnimatedCard>
                    );
                  })
              )}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {records.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
                    <Ionicons name="document-text-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      尚無健康紀錄
                    </Text>
                  </View>
                </AnimatedCard>
              ) : (
                records.map((record, idx) => (
                  <AnimatedCard key={record.id} delay={idx * 50}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name={getRecordTypeIcon(record.type) as any} size={22} color={theme.colors.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>
                            {record.title}
                          </Text>
                          <Pill text={getRecordTypeLabel(record.type)} kind="accent" />
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                          {record.department ? getDepartmentLabel(record.department as HealthDepartment) : ""}{record.doctorName ? ` · ${record.doctorName}` : ""}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                          {formatDate(new Date(record.date))}
                        </Text>
                        {record.notes && (
                          <View
                            style={{
                              marginTop: 8,
                              padding: 10,
                              borderRadius: theme.radius.md,
                              backgroundColor: theme.colors.surface,
                            }}
                          >
                            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{record.notes}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </AnimatedCard>
                ))
              )}
            </View>
          )}

          {selectedTab === 3 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {HEALTH_SERVICES.map((service, idx) => (
                <AnimatedCard key={service.id} delay={idx * 50}>
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          backgroundColor: service.isOpen ? `${theme.colors.success}20` : theme.colors.surface,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="medical"
                          size={24}
                          color={service.isOpen ? theme.colors.success : theme.colors.muted}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>
                            {service.name}
                          </Text>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: service.isOpen ? `${theme.colors.success}20` : theme.colors.surface,
                            }}
                          >
                            <Text
                              style={{
                                color: service.isOpen ? theme.colors.success : theme.colors.muted,
                                fontSize: 11,
                                fontWeight: "600",
                              }}
                            >
                              {service.isOpen ? "營業中" : "休息中"}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <Ionicons name="location" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{service.location}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <Ionicons name="time" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{service.hours}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {service.services.map((s) => (
                        <View
                          key={s}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: theme.radius.full,
                            backgroundColor: theme.colors.surface,
                          }}
                        >
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{s}</Text>
                        </View>
                      ))}
                    </View>

                    <Pressable
                      onPress={() => handleCallPhone(service.phone)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        gap: 8,
                      }}
                    >
                      <Ionicons name="call" size={18} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>{service.phone}</Text>
                    </Pressable>
                  </View>
                </AnimatedCard>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}
