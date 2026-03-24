/* eslint-disable */
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable, Alert, Share, Linking, Clipboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, SectionTitle, Divider } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { formatDateTime } from "../utils/format";
import {
  pickAndParseICalFile,
  exportAndShareICalFile,
  convertAppEventsToICalEvents,
  convertAssignmentsToICalEvents,
  type ICalEvent,
  type ParsedCalendar,
} from "../services/ical";

type CalendarEvent = {
  id: string;
  type: "event" | "assignment";
  title: string;
  date: Date;
  endDate?: Date;
  location?: string;
  groupId?: string;
  groupName?: string;
};

function getMonthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startPadding = firstDay.getDay();
  for (let i = startPadding - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push(d);
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  const endPadding = 6 - lastDay.getDay();
  for (let i = 1; i <= endPadding; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatMonthYear(date: Date): string {
  const months = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
  ];
  return `${date.getFullYear()} 年 ${months[date.getMonth()]}`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const CALENDAR_API_BASE_URL =
  process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_URL ??
  `https://asia-east1-${process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "YOUR_PROJECT_ID"}.cloudfunctions.net`;

type SubscribeButtonProps = {
  icon: string;
  label: string;
  description: string;
  subscribeUrl: string;
};

function SubscribeButton({ icon, label, description, subscribeUrl }: SubscribeButtonProps) {
  const webcalUrl = subscribeUrl.replace(/^https?:\/\//, "webcal://");

  const handleSubscribe = async () => {
    try {
      const canOpen = await Linking.canOpenURL(webcalUrl);
      if (canOpen) {
        await Linking.openURL(webcalUrl);
      } else {
        Alert.alert(
          "無法開啟日曆",
          "請複製連結後手動新增訂閱",
          [
            { text: "取消", style: "cancel" },
            {
              text: "複製連結",
              onPress: () => {
                Clipboard.setString(subscribeUrl);
                Alert.alert("已複製", "訂閱連結已複製到剪貼簿");
              }
            },
          ]
        );
      }
    } catch (error) {
      Alert.alert("錯誤", "無法開啟訂閱連結");
    }
  };

  const handleCopy = () => {
    Clipboard.setString(subscribeUrl);
    Alert.alert("已複製", "訂閱連結已複製到剪貼簿");
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `訂閱校園行事曆：${subscribeUrl}`,
        url: subscribeUrl,
      });
    } catch (error) {
      console.error("Share error:", error);
    }
  };

  return (
    <View
      style={{
        padding: 14,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        ...softShadowStyle(theme.shadows.soft),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon as any} size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>{label}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{description}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Pressable
          onPress={handleSubscribe}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: theme.radius.md,
            backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          <Ionicons name="add-circle" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>訂閱</Text>
        </Pressable>
        <Pressable
          onPress={handleCopy}
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          <Ionicons name="copy-outline" size={16} color={theme.colors.text} />
        </Pressable>
        <Pressable
          onPress={handleShare}
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          <Ionicons name="share-outline" size={16} color={theme.colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

export function CalendarScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const ds = useDataSource();

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [importedEvents, setImportedEvents] = useState<ICalEvent[]>([]);
  const [importedCalendarName, setImportedCalendarName] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { items: events, loading: eventsLoading } = useAsyncList<any>(
    () => ds.listEvents(school.id),
    [ds, school.id]
  );

  const { items: assignments, loading: assignmentsLoading } = useAsyncList<any>(
    async () => {
      if (!auth.user) return [];
      const groups = await ds.listGroups(auth.user.uid, {
        pageSize: 10,
        filters: [{ field: "schoolId", operator: "==", value: school.id }],
      });
      if (groups.length === 0) return [];

      const assignmentGroups = await Promise.all(
        groups.slice(0, 10).map(async (group) => {
          const rows = await ds.listAssignments(group.id, { pageSize: 50 });
          return rows.map((assignment) => ({
            ...assignment,
            groupId: assignment.groupId ?? group.id,
            groupName: group.name ?? group.id,
          }));
        }),
      );

      return assignmentGroups.flat();
    },
    [auth.user?.uid, ds, school.id]
  );

  const calendarEvents = useMemo(() => {
    const items: CalendarEvent[] = [];

    for (const e of events) {
      const startDate = e.startsAt?.toDate?.() ?? (e.startsAt ? new Date(e.startsAt) : null);
      if (startDate && !isNaN(startDate.getTime())) {
        items.push({
          id: `event-${e.id}`,
          type: "event",
          title: e.title,
          date: startDate,
          endDate: e.endsAt?.toDate?.() ?? (e.endsAt ? new Date(e.endsAt) : undefined),
          location: e.location,
        });
      }
    }

    for (const a of assignments) {
      const dueDate = a.dueAt?.toDate?.() ?? (a.dueAt ? new Date(a.dueAt) : null);
      if (dueDate && !isNaN(dueDate.getTime())) {
        items.push({
          id: `assignment-${a.id}`,
          type: "assignment",
          title: a.title,
          date: dueDate,
          groupId: a.groupId,
          groupName: a.groupName,
        });
      }
    }

    for (const ie of importedEvents) {
      items.push({
        id: ie.id,
        type: "event",
        title: `[匯入] ${ie.title}`,
        date: ie.startDate,
        endDate: ie.endDate,
        location: ie.location,
      });
    }

    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events, assignments, importedEvents]);

  const handleImportIcal = async () => {
    try {
      const result = await pickAndParseICalFile();
      if (result) {
        setImportedEvents(result.events);
        setImportedCalendarName(result.name ?? null);
        Alert.alert(
          "匯入成功",
          `已匯入 ${result.events.length} 個事件${result.name ? `（${result.name}）` : ""}`
        );
      }
    } catch (error: any) {
      Alert.alert("匯入失敗", error?.message ?? "無法解析 iCal 檔案");
    }
  };

  const handleExportIcal = async () => {
    setExporting(true);
    try {
      const eventItems = convertAppEventsToICalEvents(events, "event");
      const assignmentItems = convertAssignmentsToICalEvents(assignments);
      const allItems = [...eventItems, ...assignmentItems];

      if (allItems.length === 0) {
        Alert.alert("沒有事件", "目前沒有可匯出的事件");
        return;
      }

      await exportAndShareICalFile(allItems, `${school.code}-calendar.ics`, `${school.name} 行事曆`);
    } catch (error: any) {
      Alert.alert("匯出失敗", error?.message ?? "無法匯出行事曆");
    } finally {
      setExporting(false);
    }
  };

  const handleClearImported = () => {
    setImportedEvents([]);
    setImportedCalendarName(null);
  };

  const getSubscribeUrl = (type: "events" | "assignments" | "all") => {
    const params = new URLSearchParams({
      schoolId: school.id,
      type,
    });
    if (auth.user && (type === "assignments" || type === "all")) {
      params.append("userId", auth.user.uid);
    }
    return `${CALENDAR_API_BASE_URL}/calendarSubscribe?${params.toString()}`;
  };

  const monthDays = useMemo(
    () => getMonthDays(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth]
  );

  const eventsOnSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    return calendarEvents.filter((e) => isSameDay(e.date, selectedDate));
  }, [calendarEvents, selectedDate]);

  const hasEventOnDay = (date: Date) => {
    return calendarEvents.some((e) => isSameDay(e.date, date));
  };

  const getEventTypesOnDay = (date: Date): { hasEvent: boolean; hasAssignment: boolean } => {
    const dayEvents = calendarEvents.filter((e) => isSameDay(e.date, date));
    return {
      hasEvent: dayEvents.some((e) => e.type === "event"),
      hasAssignment: dayEvents.some((e) => e.type === "assignment"),
    };
  };

  const goToPrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const isLoading = eventsLoading || assignmentsLoading;

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="行事曆" subtitle={formatMonthYear(currentMonth)}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Pressable
              onPress={goToPrevMonth}
              style={({ pressed }) => ({
                padding: 8,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.colors.accentSoft : "transparent",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
            </Pressable>
            <Pressable
              onPress={goToToday}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: theme.radius.full,
                backgroundColor: pressed ? theme.colors.accentSoft : "transparent",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 14 }}>今天</Text>
            </Pressable>
            <Pressable
              onPress={goToNextMonth}
              style={({ pressed }) => ({
                padding: 8,
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.colors.accentSoft : "transparent",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <Ionicons name="chevron-forward" size={22} color={theme.colors.text} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            {WEEKDAYS.map((day) => (
              <View key={day} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ color: theme.colors.textSecondary, fontWeight: "700", fontSize: 12 }}>{day}</Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {monthDays.map((date, idx) => {
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
              const isToday = isSameDay(date, today);
              const isSelected = selectedDate && isSameDay(date, selectedDate);
              const { hasEvent: hasCampusEvent, hasAssignment } = getEventTypesOnDay(date);

              return (
                <Pressable
                  key={idx}
                  onPress={() => setSelectedDate(date)}
                  style={{
                    width: "14.28%",
                    aspectRatio: 1,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: theme.radius.full,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isSelected
                        ? theme.colors.accent
                        : isToday
                        ? theme.colors.accentSoft
                        : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color: isSelected
                          ? "#fff"
                          : isCurrentMonth
                          ? theme.colors.text
                          : theme.colors.muted,
                        fontWeight: isToday || isSelected ? "700" : "400",
                        fontSize: 14,
                      }}
                    >
                      {date.getDate()}
                    </Text>
                    {(hasCampusEvent || hasAssignment) ? (
                      <View style={{ position: "absolute", bottom: 3, flexDirection: "row", gap: 2 }}>
                        {hasCampusEvent && (
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: theme.radius.full,
                              backgroundColor: isSelected ? "#fff" : theme.colors.accent,
                            }}
                          />
                        )}
                        {hasAssignment && (
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: theme.radius.full,
                              backgroundColor: isSelected ? "#fff" : theme.colors.warning,
                            }}
                          />
                        )}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", gap: 16, marginTop: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: theme.radius.full, backgroundColor: theme.colors.accent }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>活動</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: theme.radius.full, backgroundColor: theme.colors.warning }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>作業截止</Text>
            </View>
          </View>
        </Card>

        {isLoading ? (
          <LoadingState title="事件" subtitle="載入中..." rows={2} />
        ) : (
          <Card
            title={selectedDate ? `${selectedDate.getMonth() + 1}/${selectedDate.getDate()} 的事件` : "選擇日期"}
            subtitle={`共 ${eventsOnSelectedDate.length} 個事件`}
          >
            {eventsOnSelectedDate.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Ionicons name="calendar-outline" size={32} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.textSecondary, marginTop: 8, fontSize: 14 }}>
                  這天沒有事件。
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {eventsOnSelectedDate.map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => {
                      if (e.type === "event") {
                        const eventId = e.id.replace("event-", "");
                        nav?.navigate?.("Today", { screen: "活動詳情", params: { id: eventId } });
                      } else if (e.type === "assignment" && e.groupId) {
                        const assignmentId = e.id.replace("assignment-", "");
                        nav?.navigate?.("收件匣", {
                          screen: "AssignmentDetail",
                          params: { groupId: e.groupId, assignmentId },
                        });
                      }
                    }}
                    style={({ pressed }) => ({
                      padding: 14,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface,
                      ...softShadowStyle(theme.shadows.soft),
                      transform: [{ scale: pressed ? 0.985 : 1 }],
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: theme.radius.sm,
                          backgroundColor: e.type === "event" ? theme.colors.accentSoft : theme.colors.warningSoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={e.type === "event" ? "calendar" : "document-text"}
                          size={18}
                          color={e.type === "event" ? theme.colors.accent : theme.colors.warning}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>{e.title}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 }}>
                          {formatDateTime(e.date)}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.groupName ? ` · ${e.groupName}` : ""}
                        </Text>
                      </View>
                      <Pill text={e.type === "event" ? "活動" : "作業"} kind={e.type === "event" ? "accent" : "warning"} size="sm" />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        )}

        <Card title="即將到來" subtitle="未來 7 天的事件">
          {(() => {
            const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
            const upcoming = calendarEvents.filter(
              (e) => e.date >= today && e.date <= nextWeek
            );
            if (upcoming.length === 0) {
              return (
                <View style={{ alignItems: "center", paddingVertical: 16 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>未來 7 天沒有事件。</Text>
                </View>
              );
            }
            return (
              <View style={{ gap: 10 }}>
                {upcoming.slice(0, 5).map((e) => (
                  <View
                    key={e.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      borderRadius: theme.radius.sm,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: theme.radius.full,
                        backgroundColor: e.type === "event" ? theme.colors.accent : theme.colors.warning,
                      }}
                    />
                    <Text style={{ color: theme.colors.text, flex: 1, fontSize: 14 }} numberOfLines={1}>
                      {e.title}
                    </Text>
                    <Pill
                      text={`${e.date.getMonth() + 1}/${e.date.getDate()}`}
                      size="sm"
                      kind="muted"
                    />
                  </View>
                ))}
                {upcoming.length > 5 ? (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: "center", marginTop: 4 }}>
                    還有 {upcoming.length - 5} 個事件...
                  </Text>
                ) : null}
              </View>
            );
          })()}
        </Card>

        <Card title="iCal 同步" subtitle="匯入/匯出行事曆">
          <View style={{ gap: 14 }}>
            <View>
              <SectionTitle text="匯入外部行事曆" />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 10, marginTop: 4, lineHeight: 18 }}>
                支援 .ics 格式（學校行事曆、Google 日曆等）
              </Text>
              <Button text="選擇 iCal 檔案" kind="primary" icon="document-attach-outline" onPress={handleImportIcal} />
              {importedEvents.length > 0 ? (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Pill text={`已匯入 ${importedEvents.length} 個事件`} kind="accent" size="sm" />
                    {importedCalendarName ? (
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{importedCalendarName}</Text>
                    ) : null}
                  </View>
                  <Button text="清除匯入的事件" kind="ghost" icon="close-circle-outline" onPress={handleClearImported} />
                </View>
              ) : null}
            </View>

            <Divider spacing={0} />

            <View>
              <SectionTitle text="匯出我的行事曆" />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 10, marginTop: 4, lineHeight: 18 }}>
                匯出活動與作業截止日期為 .ics 檔案
              </Text>
              <Button
                text={exporting ? "匯出中..." : "匯出行事曆"}
                kind="primary"
                icon="download-outline"
                onPress={handleExportIcal}
                disabled={exporting}
                loading={exporting}
              />
            </View>

            <Divider spacing={0} />

            <View>
              <SectionTitle text="訂閱行事曆" />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 14 }}>
                訂閱後，校園行事曆會自動同步到你的 iOS/Android/Google 日曆。
              </Text>

              <View style={{ gap: 10 }}>
                <SubscribeButton
                  icon="calendar"
                  label="訂閱所有活動"
                  description="包含所有校園活動"
                  subscribeUrl={getSubscribeUrl("events")}
                />

                {auth.user && (
                  <SubscribeButton
                    icon="document-text"
                    label="訂閱我的作業"
                    description="包含課程作業截止日"
                    subscribeUrl={getSubscribeUrl("assignments")}
                  />
                )}

                {auth.user && (
                  <SubscribeButton
                    icon="apps"
                    label="訂閱全部"
                    description="活動 + 作業 + 已報名活動"
                    subscribeUrl={getSubscribeUrl("all")}
                  />
                )}
              </View>

              <View style={{
                marginTop: 14,
                padding: 14,
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.md,
              }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
                  💡 提示：點擊「訂閱」會開啟系統日曆 App。{"\n"}
                  如果無法自動開啟，可以複製連結後手動新增訂閱。
                </Text>
              </View>
            </View>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
