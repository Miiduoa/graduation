/* eslint-disable */
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert, Switch, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Screen, Button, AnimatedCard, SegmentedControl, Spinner } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useDataSource } from "../hooks/useDataSource";
import { analytics } from "../services/analytics";
import { schedulePushNotification, cancelNotification } from "../services/notifications";
type SubscriptionDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type SubscriptionTime = "breakfast" | "lunch" | "dinner";

type CafeteriaSub = {
  id: string;
  name: string;
  enabled: boolean;
};

type Subscription = {
  id: string;
  cafeteriaId: string;
  cafeteriaName: string;
  days: SubscriptionDay[];
  times: SubscriptionTime[];
  enabled: boolean;
  notificationIds?: string[];
};

type SubscriptionSettings = {
  notifyTime: number;
  pushEnabled: boolean;
};

const SUBSCRIPTIONS_STORAGE_KEY = "@menu_subscriptions";
const SETTINGS_STORAGE_KEY = "@menu_subscription_settings";

const DAYS: { key: SubscriptionDay; label: string; short: string }[] = [
  { key: "mon", label: "週一", short: "一" },
  { key: "tue", label: "週二", short: "二" },
  { key: "wed", label: "週三", short: "三" },
  { key: "thu", label: "週四", short: "四" },
  { key: "fri", label: "週五", short: "五" },
  { key: "sat", label: "週六", short: "六" },
  { key: "sun", label: "週日", short: "日" },
];

const TIMES: { key: SubscriptionTime; label: string; time: string; icon: string; hour: number; minute: number }[] = [
  { key: "breakfast", label: "早餐", time: "07:00", icon: "sunny", hour: 7, minute: 0 },
  { key: "lunch", label: "午餐", time: "11:30", icon: "partly-sunny", hour: 11, minute: 30 },
  { key: "dinner", label: "晚餐", time: "17:00", icon: "moon", hour: 17, minute: 0 },
];

// Cafeterias are loaded from DataSource only
const DEFAULT_CAFETERIAS: CafeteriaSub[] = [];

export function MenuSubscriptionScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const [selectedTab, setSelectedTab] = useState(0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [notifyTime, setNotifyTime] = useState(30);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cafeterias, setCafeterias] = useState<CafeteriaSub[]>(DEFAULT_CAFETERIAS);

  const TABS = ["我的訂閱", "新增訂閱", "設定"];

  const [newSubCafeteria, setNewSubCafeteria] = useState<string>("");
  const [newSubDays, setNewSubDays] = useState<SubscriptionDay[]>([]);
  const [newSubTimes, setNewSubTimes] = useState<SubscriptionTime[]>([]);

  const loadCafeterias = useCallback(async () => {
    if (!school?.id) {
      setCafeterias([]);
      return;
    }

    try {
      const menus = await ds.listMenus(school.id);
      if (menus && menus.length > 0) {
        const converted: CafeteriaSub[] = Array.from(
          new Map(
            menus
              .filter((menu) => !!menu.cafeteria)
              .map((menu) => [
                menu.cafeteria,
                {
                  id: menu.cafeteria,
                  name: menu.cafeteria,
                  enabled: true,
                },
              ])
          ).values()
        );
        setCafeterias(converted);
      } else {
        setCafeterias([]);
      }
    } catch (error) {
      console.warn("Failed to load cafeterias:", error);
      setCafeterias([]);
    }
  }, [ds, school?.id]);

  const loadSubscriptions = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(
        `${SUBSCRIPTIONS_STORAGE_KEY}_${auth.user?.uid ?? "guest"}`
      );
      if (stored) {
        setSubscriptions(JSON.parse(stored));
      }
    } catch (error) {
      console.warn("Failed to load subscriptions:", error);
    }
  }, [auth.user?.uid]);

  const loadSettings = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(
        `${SETTINGS_STORAGE_KEY}_${auth.user?.uid ?? "guest"}`
      );
      if (stored) {
        const settings: SubscriptionSettings = JSON.parse(stored);
        setNotifyTime(settings.notifyTime);
        setPushEnabled(settings.pushEnabled);
      }
    } catch (error) {
      console.warn("Failed to load settings:", error);
    }
  }, [auth.user?.uid]);

  const saveSubscriptions = useCallback(async (subs: Subscription[]) => {
    try {
      await AsyncStorage.setItem(
        `${SUBSCRIPTIONS_STORAGE_KEY}_${auth.user?.uid ?? "guest"}`,
        JSON.stringify(subs)
      );
    } catch (error) {
      console.warn("Failed to save subscriptions:", error);
    }
  }, [auth.user?.uid]);

  const saveSettings = useCallback(async () => {
    try {
      const settings: SubscriptionSettings = { notifyTime, pushEnabled };
      await AsyncStorage.setItem(
        `${SETTINGS_STORAGE_KEY}_${auth.user?.uid ?? "guest"}`,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn("Failed to save settings:", error);
    }
  }, [auth.user?.uid, notifyTime, pushEnabled]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadCafeterias(), loadSubscriptions(), loadSettings()]);
      setLoading(false);
    };
    init();
  }, [loadCafeterias, loadSubscriptions, loadSettings]);

  useEffect(() => {
    saveSettings();
  }, [notifyTime, pushEnabled, saveSettings]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadCafeterias(), loadSubscriptions()]);
    setRefreshing(false);
  }, [loadCafeterias, loadSubscriptions]);

  const scheduleNotificationsForSubscription = useCallback(async (sub: Subscription): Promise<string[]> => {
    if (!pushEnabled || !sub.enabled) return [];
    
    const notificationIds: string[] = [];
    const dayMap: Record<SubscriptionDay, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    
    for (const day of sub.days) {
      for (const timeKey of sub.times) {
        const timeConfig = TIMES.find(t => t.key === timeKey);
        if (!timeConfig) continue;
        
        const notifyHour = timeConfig.hour;
        const notifyMinute = Math.max(0, timeConfig.minute - notifyTime);
        
        try {
          const id = await schedulePushNotification({
            title: `${sub.cafeteriaName} ${timeConfig.label}菜單`,
            body: `今日${timeConfig.label}菜單已更新，快來看看有什麼好吃的！`,
            data: {
              type: "menu_subscription",
              cafeteriaId: sub.cafeteriaId,
              meal: timeKey,
            },
            trigger: {
              weekday: dayMap[day] + 1,
              hour: notifyHour,
              minute: notifyMinute,
              repeats: true,
            },
          });
          if (id) notificationIds.push(id);
        } catch (error) {
          console.warn("Failed to schedule notification:", error);
        }
      }
    }
    
    return notificationIds;
  }, [pushEnabled, notifyTime]);

  const cancelNotificationsForSubscription = useCallback(async (sub: Subscription) => {
    if (sub.notificationIds && sub.notificationIds.length > 0) {
      for (const id of sub.notificationIds) {
        try {
          await cancelNotification(id);
        } catch (error) {
          console.warn("Failed to cancel notification:", error);
        }
      }
    }
  }, []);

  const handleToggleSubscription = async (subId: string) => {
    const sub = subscriptions.find(s => s.id === subId);
    if (!sub) return;
    
    setSaving(true);
    try {
      let updatedNotificationIds = sub.notificationIds ?? [];
      
      if (sub.enabled) {
        await cancelNotificationsForSubscription(sub);
        updatedNotificationIds = [];
      } else {
        updatedNotificationIds = await scheduleNotificationsForSubscription({ ...sub, enabled: true });
      }
      
      const updated = subscriptions.map((s) =>
        s.id === subId ? { ...s, enabled: !s.enabled, notificationIds: updatedNotificationIds } : s
      );
      setSubscriptions(updated);
      await saveSubscriptions(updated);
      
      analytics.logEvent("toggle_menu_subscription", {
        subscription_id: subId,
        enabled: !sub.enabled,
      });
    } catch (error) {
      console.warn("Failed to toggle subscription:", error);
      Alert.alert("錯誤", "無法更新訂閱狀態，請稍後再試");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubscription = (subId: string) => {
    const sub = subscriptions.find(s => s.id === subId);
    if (!sub) return;
    
    Alert.alert(
      "刪除訂閱",
      "確定要刪除此訂閱嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "刪除",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await cancelNotificationsForSubscription(sub);
              const updated = subscriptions.filter((s) => s.id !== subId);
              setSubscriptions(updated);
              await saveSubscriptions(updated);
              
              analytics.logEvent("delete_menu_subscription", {
                subscription_id: subId,
                cafeteria: sub.cafeteriaName,
              });
            } catch (error) {
              console.warn("Failed to delete subscription:", error);
              Alert.alert("錯誤", "無法刪除訂閱，請稍後再試");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleCreateSubscription = async () => {
    if (!newSubCafeteria) {
      Alert.alert("請選擇餐廳", "請選擇要訂閱的餐廳");
      return;
    }
    if (newSubDays.length === 0) {
      Alert.alert("請選擇日期", "請至少選擇一天");
      return;
    }
    if (newSubTimes.length === 0) {
      Alert.alert("請選擇時段", "請至少選擇一個時段");
      return;
    }

    setSaving(true);
    try {
      const cafeteria = cafeterias.find((c) => c.id === newSubCafeteria);
      const newSub: Subscription = {
        id: `s${Date.now()}`,
        cafeteriaId: newSubCafeteria,
        cafeteriaName: cafeteria?.name ?? "",
        days: newSubDays,
        times: newSubTimes,
        enabled: true,
        notificationIds: [],
      };
      
      if (pushEnabled) {
        newSub.notificationIds = await scheduleNotificationsForSubscription(newSub);
      }

      const updated = [...subscriptions, newSub];
      setSubscriptions(updated);
      await saveSubscriptions(updated);
      
      setNewSubCafeteria("");
      setNewSubDays([]);
      setNewSubTimes([]);
      setSelectedTab(0);
      
      analytics.logEvent("create_menu_subscription", {
        cafeteria_id: newSubCafeteria,
        cafeteria_name: cafeteria?.name,
        days_count: newSubDays.length,
        times_count: newSubTimes.length,
      });
      
      Alert.alert("訂閱成功", `已新增 ${cafeteria?.name} 的菜單訂閱`);
    } catch (error) {
      console.warn("Failed to create subscription:", error);
      Alert.alert("錯誤", "無法建立訂閱，請稍後再試");
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: SubscriptionDay) => {
    if (newSubDays.includes(day)) {
      setNewSubDays(newSubDays.filter((d) => d !== day));
    } else {
      setNewSubDays([...newSubDays, day]);
    }
  };

  const toggleTime = (time: SubscriptionTime) => {
    if (newSubTimes.includes(time)) {
      setNewSubTimes(newSubTimes.filter((t) => t !== time));
    } else {
      setNewSubTimes([...newSubTimes, time]);
    }
  };

  const formatDays = (days: SubscriptionDay[]): string => {
    if (days.length === 7) return "每天";
    if (
      days.length === 5 &&
      ["mon", "tue", "wed", "thu", "fri"].every((d) => days.includes(d as SubscriptionDay))
    ) {
      return "平日";
    }
    if (
      days.length === 2 &&
      ["sat", "sun"].every((d) => days.includes(d as SubscriptionDay))
    ) {
      return "週末";
    }
    return days.map((d) => DAYS.find((day) => day.key === d)?.short).join("、");
  };

  const formatTimes = (times: SubscriptionTime[]): string => {
    return times.map((t) => TIMES.find((time) => time.key === t)?.label).join("、");
  };

  const handleUpdateAllNotifications = useCallback(async () => {
    if (!pushEnabled) {
      for (const sub of subscriptions) {
        await cancelNotificationsForSubscription(sub);
      }
      const updated = subscriptions.map(s => ({ ...s, notificationIds: [] }));
      setSubscriptions(updated);
      await saveSubscriptions(updated);
      return;
    }
    
    setSaving(true);
    try {
      const updated: Subscription[] = [];
      for (const sub of subscriptions) {
        if (sub.enabled) {
          await cancelNotificationsForSubscription(sub);
          const newIds = await scheduleNotificationsForSubscription(sub);
          updated.push({ ...sub, notificationIds: newIds });
        } else {
          updated.push(sub);
        }
      }
      setSubscriptions(updated);
      await saveSubscriptions(updated);
    } catch (error) {
      console.warn("Failed to update notifications:", error);
    } finally {
      setSaving(false);
    }
  }, [subscriptions, pushEnabled, cancelNotificationsForSubscription, scheduleNotificationsForSubscription, saveSubscriptions]);

  const handlePushToggle = async (value: boolean) => {
    setPushEnabled(value);
    if (!value) {
      for (const sub of subscriptions) {
        await cancelNotificationsForSubscription(sub);
      }
      Alert.alert("已關閉", "已停用所有菜單推播通知");
    } else {
      await handleUpdateAllNotifications();
      Alert.alert("已開啟", "已重新啟用菜單推播通知");
    }
    
    analytics.logEvent("toggle_menu_push_notifications", {
      enabled: value,
    });
  };

  const handleNotifyTimeChange = async (mins: number) => {
    setNotifyTime(mins);
    analytics.logEvent("change_menu_notify_time", {
      minutes: mins,
    });
    if (pushEnabled) {
      await handleUpdateAllNotifications();
    }
  };

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Spinner size={32} />
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
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {subscriptions.length === 0 ? (
                <AnimatedCard>
                  <View style={{ alignItems: "center", paddingVertical: 40 }}>
                    <Ionicons name="notifications-off-outline" size={64} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 16 }}>
                      尚無訂閱
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4, textAlign: "center" }}>
                      訂閱餐廳菜單，每天自動收到最新菜色
                    </Text>
                    <Button
                      text="新增訂閱"
                      onPress={() => setSelectedTab(1)}
                      style={{ marginTop: 20 }}
                    />
                  </View>
                </AnimatedCard>
              ) : (
                subscriptions.map((sub, idx) => (
                  <AnimatedCard key={sub.id} delay={idx * 50}>
                    <View style={{ gap: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <View
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 22,
                              backgroundColor: sub.enabled
                                ? theme.colors.accentSoft
                                : theme.colors.surface2,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons
                              name="restaurant"
                              size={22}
                              color={sub.enabled ? theme.colors.accent : theme.colors.muted}
                            />
                          </View>
                          <View>
                            <Text
                              style={{
                                color: sub.enabled ? theme.colors.text : theme.colors.muted,
                                fontWeight: "700",
                                fontSize: 16,
                              }}
                            >
                              {sub.cafeteriaName}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {formatDays(sub.days)} · {formatTimes(sub.times)}
                            </Text>
                          </View>
                        </View>
                        <Switch
                          value={sub.enabled}
                          onValueChange={() => handleToggleSubscription(sub.id)}
                          trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                        />
                      </View>

                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {sub.days.map((day) => (
                          <View
                            key={day}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: theme.radius.full,
                              backgroundColor: sub.enabled
                                ? theme.colors.accentSoft
                                : theme.colors.surface2,
                            }}
                          >
                            <Text
                              style={{
                                color: sub.enabled ? theme.colors.accent : theme.colors.muted,
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              {DAYS.find((d) => d.key === day)?.label}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "flex-end",
                          gap: 8,
                          paddingTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Pressable
                          onPress={() => handleDeleteSubscription(sub.id)}
                          disabled={saving}
                          style={{
                            padding: 8,
                            borderRadius: theme.radius.md,
                            opacity: saving ? 0.5 : 1,
                          }}
                        >
                          <Text style={{ color: theme.colors.danger, fontWeight: "600" }}>刪除</Text>
                        </Pressable>
                      </View>
                    </View>
                  </AnimatedCard>
                ))
              )}

              {subscriptions.length > 0 && (
                <Button
                  text="新增訂閱"
                  onPress={() => setSelectedTab(1)}
                />
              )}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="選擇餐廳">
                {cafeterias.length === 0 ? (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <Ionicons name="restaurant-outline" size={48} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, marginTop: 16, fontSize: 14, textAlign: "center" }}>
                      目前沒有可用的餐廳
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8, textAlign: "center" }}>
                      請稍後再試
                    </Text>
                  </View>
                ) : (
                <View style={{ gap: 8 }}>
                  {cafeterias.map((cafe) => (
                    <Pressable
                      key={cafe.id}
                      onPress={() => setNewSubCafeteria(cafe.id)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor:
                          newSubCafeteria === cafe.id
                            ? theme.colors.accentSoft
                            : theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor:
                            newSubCafeteria === cafe.id
                              ? theme.colors.accent
                              : theme.colors.surface,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name="restaurant"
                          size={18}
                          color={newSubCafeteria === cafe.id ? "#fff" : theme.colors.muted}
                        />
                      </View>
                      <Text
                        style={{
                          color:
                            newSubCafeteria === cafe.id ? theme.colors.accent : theme.colors.text,
                          fontWeight: "600",
                          flex: 1,
                        }}
                      >
                        {cafe.name}
                      </Text>
                      {newSubCafeteria === cafe.id && (
                        <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                      )}
                    </Pressable>
                  ))}
                </View>
                )}
              </AnimatedCard>

              <AnimatedCard title="選擇日期" delay={50}>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {DAYS.map((day) => (
                    <Pressable
                      key={day.key}
                      onPress={() => toggleDay(day.key)}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: newSubDays.includes(day.key)
                          ? theme.colors.accent
                          : theme.colors.surface2,
                      }}
                    >
                      <Text
                        style={{
                          color: newSubDays.includes(day.key) ? "#fff" : theme.colors.text,
                          fontWeight: "600",
                        }}
                      >
                        {day.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={() => setNewSubDays(["mon", "tue", "wed", "thu", "fri"])}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                      平日
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewSubDays(["sat", "sun"])}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                      週末
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewSubDays(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                      每天
                    </Text>
                  </Pressable>
                </View>
              </AnimatedCard>

              <AnimatedCard title="選擇時段" delay={100}>
                <View style={{ gap: 8 }}>
                  {TIMES.map((time) => (
                    <Pressable
                      key={time.key}
                      onPress={() => toggleTime(time.key)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: theme.radius.md,
                        backgroundColor: newSubTimes.includes(time.key)
                          ? theme.colors.accentSoft
                          : theme.colors.surface2,
                        gap: 12,
                      }}
                    >
                      <Ionicons
                        name={time.icon as any}
                        size={22}
                        color={
                          newSubTimes.includes(time.key) ? theme.colors.accent : theme.colors.muted
                        }
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: newSubTimes.includes(time.key)
                              ? theme.colors.accent
                              : theme.colors.text,
                            fontWeight: "600",
                          }}
                        >
                          {time.label}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          每天 {time.time} 推播
                        </Text>
                      </View>
                      {newSubTimes.includes(time.key) && (
                        <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                      )}
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <Button 
                text={saving ? "建立中..." : "建立訂閱"} 
                kind="primary" 
                onPress={handleCreateSubscription}
                disabled={saving}
              />
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="通知設定">
                <View style={{ gap: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Ionicons name="notifications" size={22} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>推播通知</Text>
                    </View>
                    <Switch
                      value={pushEnabled}
                      onValueChange={handlePushToggle}
                      disabled={saving}
                      trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                    />
                  </View>

                  <View>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
                      提前通知時間
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {[15, 30, 60].map((mins) => (
                        <Pressable
                          key={mins}
                          onPress={() => handleNotifyTimeChange(mins)}
                          disabled={saving || !pushEnabled}
                          style={{
                            flex: 1,
                            paddingVertical: 12,
                            borderRadius: theme.radius.md,
                            backgroundColor:
                              notifyTime === mins ? theme.colors.accent : theme.colors.surface2,
                            alignItems: "center",
                            opacity: saving || !pushEnabled ? 0.5 : 1,
                          }}
                        >
                          <Text
                            style={{
                              color: notifyTime === mins ? "#fff" : theme.colors.text,
                              fontWeight: "600",
                            }}
                          >
                            {mins} 分鐘
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </AnimatedCard>

              <AnimatedCard title="訂閱統計" delay={50}>
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: theme.colors.muted }}>啟用中的訂閱</Text>
                    <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 18 }}>
                      {subscriptions.filter(s => s.enabled).length}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: theme.colors.muted }}>已排程的通知</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                      {subscriptions.reduce((sum, s) => sum + (s.notificationIds?.length ?? 0), 0)} 個
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: theme.colors.muted }}>訂閱的餐廳</Text>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                      {new Set(subscriptions.map(s => s.cafeteriaId)).size} 間
                    </Text>
                  </View>
                </View>
              </AnimatedCard>

              <AnimatedCard title="訂閱說明" delay={50}>
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <Ionicons name="information-circle" size={20} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                      訂閱後，系統會在指定時間自動推播當日菜單給您
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <Ionicons name="heart" size={20} color={theme.colors.danger} />
                    <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                      可根據喜好設定多個餐廳和時段的訂閱
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <Ionicons name="battery-full" size={20} color={theme.colors.success} />
                    <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                      智慧推播不會過度消耗電量
                    </Text>
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
