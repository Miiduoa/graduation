import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, Alert, Dimensions, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AnimatedCard, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";

type WidgetSize = "small" | "medium" | "large";
type WidgetStatus = "native" | "preview";

type Widget = {
  id: string;
  name: string;
  description: string;
  sizes: WidgetSize[];
  icon: string;
  color: string;
  status: WidgetStatus;
};

const WIDGETS: Widget[] = [
  {
    id: "todaySchedule",
    name: "今日課表",
    description: "顯示今天的課程安排",
    sizes: ["small", "medium", "large"],
    icon: "calendar",
    color: theme.colors.accent,
    status: "native",
  },
  {
    id: "nextClass",
    name: "下一堂課",
    description: "顯示即將開始的課程",
    sizes: ["small", "medium"],
    icon: "alarm",
    color: "#2563EB",
    status: "native",
  },
  {
    id: "busArrival",
    name: "公車到站",
    description: "即時校車到站資訊",
    sizes: ["small", "medium"],
    icon: "bus",
    color: "#22C55E",
    status: "native",
  },
  {
    id: "announcement",
    name: "校園公告",
    description: "顯示最新公告與未讀數",
    sizes: ["medium", "large"],
    icon: "megaphone",
    color: "#F97316",
    status: "native",
  },
  {
    id: "cafeteriaMenu",
    name: "餐廳菜單",
    description: "顯示今日推薦菜色",
    sizes: ["medium"],
    icon: "restaurant",
    color: "#F97316",
    status: "preview",
  },
  {
    id: "library",
    name: "圖書館",
    description: "借閱狀態與到期提醒",
    sizes: ["small", "medium"],
    icon: "library",
    color: "#8B5CF6",
    status: "preview",
  },
  {
    id: "eventCountdown",
    name: "近期活動",
    description: "顯示即將舉辦的活動",
    sizes: ["medium", "large"],
    icon: "ticket",
    color: "#EC4899",
    status: "preview",
  },
  {
    id: "grades",
    name: "成績查詢",
    description: "快速查看最新成績",
    sizes: ["small", "medium"],
    icon: "school",
    color: "#06B6D4",
    status: "preview",
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function WidgetStatusBadge({ status }: { status: WidgetStatus }) {
  const isNative = status === "native";
  const color = isNative ? "#10B981" : "#F59E0B";
  const backgroundColor = isNative ? "rgba(16,185,129,0.14)" : "rgba(245,158,11,0.14)";

  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor,
      }}
    >
      <Text style={{ color, fontSize: 10, fontWeight: "700" }}>
        {isNative ? "已整合" : "預覽中"}
      </Text>
    </View>
  );
}

function SmallWidget({ widget }: { widget: Widget }) {
  return (
    <View
      style={{
        width: (SCREEN_WIDTH - 48) / 2,
        aspectRatio: 1,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface2,
        padding: 14,
        justifyContent: "space-between",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: `${widget.color}20`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={widget.icon as any} size={20} color={widget.color} />
        </View>
        <WidgetStatusBadge status={widget.status} />
      </View>

      <View>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
          {widget.name}
        </Text>
        {widget.id === "todaySchedule" ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            3 堂課，下一堂 10:20
          </Text>
        ) : null}
        {widget.id === "nextClass" ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            程式設計 22 分鐘後
          </Text>
        ) : null}
        {widget.id === "busArrival" ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            校門口站 3 分鐘後
          </Text>
        ) : null}
        {widget.id === "library" ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            2 本書即將到期
          </Text>
        ) : null}
        {widget.id === "grades" ? (
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            GPA 3.75
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function MediumWidget({ widget }: { widget: Widget }) {
  return (
    <View
      style={{
        width: "100%",
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface2,
        padding: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${widget.color}20`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={widget.icon as any} size={22} color={widget.color} />
        </View>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16, flex: 1 }}>
          {widget.name}
        </Text>
        <WidgetStatusBadge status={widget.status} />
      </View>

      {widget.id === "todaySchedule" ? (
        <View style={{ gap: 8 }}>
          {[
            { time: "08:10", name: "微積分", room: "理學院 201" },
            { time: "10:20", name: "程式設計", room: "工程館 301" },
            { time: "13:10", name: "資料結構", room: "工程館 405" },
          ].map((course) => (
            <View key={`${widget.id}-${course.time}`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ color: widget.color, fontWeight: "700", width: 45, fontSize: 12 }}>
                {course.time}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                  {course.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{course.room}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "nextClass" ? (
        <View
          style={{
            padding: 14,
            borderRadius: theme.radius.md,
            backgroundColor: `${widget.color}12`,
            gap: 6,
          }}
        >
          <Text style={{ color: widget.color, fontSize: 12, fontWeight: "700" }}>22 分鐘後開始</Text>
          <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }}>程式設計</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>10:20 - 12:10 · 工程館 301</Text>
        </View>
      ) : null}

      {widget.id === "busArrival" ? (
        <View style={{ gap: 10 }}>
          {[
            { route: "校園接駁車", time: "3 分鐘", status: "即將到站" },
            { route: "高鐵接駁車", time: "15 分鐘", status: "行駛中" },
          ].map((bus) => (
            <View key={`${widget.id}-${bus.route}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                  {bus.route}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{bus.status}</Text>
              </View>
              <Text style={{ color: widget.color, fontWeight: "700", fontSize: 13 }}>
                {bus.time}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "announcement" ? (
        <View style={{ gap: 8 }}>
          {[
            { title: "選課加退選截止提醒", source: "教務處", urgent: true },
            { title: "圖書館延長開館公告", source: "圖書館", urgent: false },
          ].map((announcement) => (
            <View key={`${widget.id}-${announcement.title}`} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13, flex: 1 }} numberOfLines={1}>
                  {announcement.title}
                </Text>
                {announcement.urgent ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(244,63,94,0.14)",
                    }}
                  >
                    <Text style={{ color: "#F43F5E", fontSize: 10, fontWeight: "700" }}>重要</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{announcement.source}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "cafeteriaMenu" ? (
        <View style={{ gap: 8 }}>
          {[
            { name: "招牌滷肉飯", price: 45, tag: "熱門" },
            { name: "雞腿便當", price: 85, tag: "推薦" },
          ].map((item) => (
            <View key={`${widget.id}-${item.name}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                  {item.name}
                </Text>
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    borderRadius: 4,
                    backgroundColor: `${widget.color}20`,
                  }}
                >
                  <Text style={{ color: widget.color, fontSize: 9, fontWeight: "600" }}>
                    {item.tag}
                  </Text>
                </View>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 13 }}>${item.price}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "library" ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>借閱中</Text>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>5 本</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>即將到期</Text>
            <Text style={{ color: theme.colors.danger, fontWeight: "700", fontSize: 14 }}>2 本</Text>
          </View>
        </View>
      ) : null}

      {widget.id === "eventCountdown" ? (
        <View
          style={{
            padding: 14,
            borderRadius: theme.radius.md,
            backgroundColor: `${widget.color}12`,
            gap: 6,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>程式設計競賽</Text>
          <Text style={{ color: widget.color, fontWeight: "800", fontSize: 20 }}>5 天 3 小時</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>工程館國際會議廳 · 剩餘 12 名額</Text>
        </View>
      ) : null}

      {widget.id === "grades" ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>本學期 GPA</Text>
            <Text style={{ color: widget.color, fontWeight: "800", fontSize: 18 }}>3.75</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>最新成績</Text>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>資料庫系統 A</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LargeWidget({ widget }: { widget: Widget }) {
  return (
    <View
      style={{
        width: "100%",
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface2,
        padding: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: `${widget.color}20`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={widget.icon as any} size={24} color={widget.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 17 }}>
            {widget.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {widget.description}
          </Text>
        </View>
        <WidgetStatusBadge status={widget.status} />
      </View>

      {widget.id === "todaySchedule" ? (
        <View style={{ gap: 10 }}>
          {[
            { time: "08:10-10:00", name: "微積分", room: "理學院 201", instructor: "王教授" },
            { time: "10:20-12:10", name: "程式設計", room: "工程館 301", instructor: "李教授" },
            { time: "13:10-15:00", name: "資料結構", room: "工程館 405", instructor: "張教授" },
            { time: "15:20-17:10", name: "演算法", room: "工程館 302", instructor: "陳教授" },
          ].map((course) => (
            <View
              key={`${widget.id}-${course.time}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 4,
                  height: "100%",
                  borderRadius: 2,
                  backgroundColor: widget.color,
                }}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                    {course.name}
                  </Text>
                  <Text style={{ color: widget.color, fontWeight: "600", fontSize: 12 }}>
                    {course.time}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {course.room} · {course.instructor}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "announcement" ? (
        <View style={{ gap: 10 }}>
          {[
            { title: "113 學年度第二學期選課公告", source: "教務處", meta: "今日更新", urgent: true },
            { title: "宿舍門禁時段調整通知", source: "學務處", meta: "昨天 18:30", urgent: false },
            { title: "校慶活動交通管制提醒", source: "總務處", meta: "昨天 09:20", urgent: false },
          ].map((announcement) => (
            <View
              key={`${widget.id}-${announcement.title}`}
              style={{
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14, flex: 1 }}>
                  {announcement.title}
                </Text>
                {announcement.urgent ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(244,63,94,0.14)",
                    }}
                  >
                    <Text style={{ color: "#F43F5E", fontSize: 10, fontWeight: "700" }}>重要</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                {announcement.source} · {announcement.meta}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {widget.id === "eventCountdown" ? (
        <View style={{ gap: 10 }}>
          {[
            { name: "程式設計競賽", date: "2026/03/20", location: "工程館", spots: "剩餘 12 名額" },
            { name: "社團博覽會", date: "2026/03/24", location: "活動中心", spots: "免費參加" },
            { name: "職涯講座", date: "2026/03/28", location: "國際會議廳", spots: "剩餘 50 名額" },
          ].map((event) => (
            <View
              key={`${widget.id}-${event.name}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  backgroundColor: `${widget.color}20`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="calendar" size={22} color={widget.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                  {event.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {event.date} · {event.location}
                </Text>
                <Text style={{ color: widget.color, fontSize: 11, marginTop: 2 }}>
                  {event.spots}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function WidgetPreviewScreen() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedSize, setSelectedSize] = useState<WidgetSize>("medium");

  const filteredWidgets = useMemo(
    () => WIDGETS.filter((widget) => widget.sizes.includes(selectedSize)),
    [selectedSize]
  );
  const integratedWidgets = useMemo(
    () => WIDGETS.filter((widget) => widget.status === "native"),
    []
  );
  const previewWidgets = useMemo(
    () => WIDGETS.filter((widget) => widget.status === "preview"),
    []
  );

  const handleAddWidget = (widget: Widget) => {
    const addSteps =
      Platform.OS === "ios"
        ? "長按主畫面空白處 → 點擊左上角「+」→ 搜尋「校園助手」→ 選擇尺寸後加入。"
        : Platform.OS === "android"
          ? "長按主畫面空白處 → 選擇「小工具」→ 找到「校園助手」→ 長按拖曳到主畫面。"
          : "iOS 與 Android 都可從主畫面的小工具列表加入。";

    Alert.alert(
      widget.status === "native" ? "加入小工具" : "預覽說明",
      widget.status === "native"
        ? `${widget.name} 已有原生小工具版型與資料供應流程。\n\n${addSteps}\n\n若目前安裝包看不到小工具，請先完成 README 中的 iOS Widget Extension / Android Widget Provider 設定。`
        : `${widget.name} 目前可在 App 內預覽版型與資訊密度，原生主畫面版仍待接上。\n\n你可以先用本頁確認內容呈現，再安排原生 widget 整合。`,
      [{ text: "好的" }]
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={["預覽", "設定說明"]} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView style={{ flex: 1, marginTop: 12 }} showsVerticalScrollIndicator={false}>
          {selectedTab === 0 ? (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="小工具尺寸">
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["small", "medium", "large"] as const).map((size) => (
                    <Pressable
                      key={size}
                      onPress={() => setSelectedSize(size)}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: selectedSize === size ? theme.colors.accent : theme.colors.surface2,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: selectedSize === size ? "#fff" : theme.colors.text,
                          fontWeight: "600",
                        }}
                      >
                        {size === "small" ? "小" : size === "medium" ? "中" : "大"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>

              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                可用小工具 ({filteredWidgets.length})
              </Text>

              {selectedSize === "small" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  {filteredWidgets.map((widget) => (
                    <Pressable key={widget.id} onPress={() => handleAddWidget(widget)}>
                      <SmallWidget widget={widget} />
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {selectedSize === "medium" ? (
                <View style={{ gap: 12 }}>
                  {filteredWidgets.map((widget, index) => (
                    <Pressable key={widget.id} onPress={() => handleAddWidget(widget)}>
                      <AnimatedCard delay={index * 50}>
                        <MediumWidget widget={widget} />
                      </AnimatedCard>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {selectedSize === "large" ? (
                <View style={{ gap: 12 }}>
                  {filteredWidgets.map((widget, index) => (
                    <Pressable key={widget.id} onPress={() => handleAddWidget(widget)}>
                      <AnimatedCard delay={index * 50}>
                        <LargeWidget widget={widget} />
                      </AnimatedCard>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {selectedTab === 1 ? (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="什麼是小工具？">
                <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                  小工具是放在手機主畫面的快捷資訊卡片，不需要打開 App 就能快速查看重要資訊。
                </Text>
              </AnimatedCard>

              <AnimatedCard title="如何新增小工具？" delay={50}>
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: theme.colors.accentSoft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>1</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>iOS</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2, lineHeight: 20 }}>
                        長按主畫面空白處 → 點擊左上角「+」→ 搜尋「校園助手」→ 選擇小工具尺寸 → 新增
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: theme.colors.accentSoft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>2</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>Android</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2, lineHeight: 20 }}>
                        長按主畫面空白處 → 選擇「小工具」→ 找到「校園助手」→ 長按拖曳到主畫面
                      </Text>
                    </View>
                  </View>
                </View>
              </AnimatedCard>

              <AnimatedCard title="可用小工具一覽" delay={100}>
                <View style={{ gap: 10 }}>
                  {WIDGETS.map((widget) => (
                    <View
                      key={widget.id}
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
                          borderRadius: 10,
                          backgroundColor: `${widget.color}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name={widget.icon as any} size={20} color={widget.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                          {widget.name}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {widget.description}
                        </Text>
                      </View>
                      <WidgetStatusBadge status={widget.status} />
                    </View>
                  ))}
                </View>
              </AnimatedCard>

              <AnimatedCard title="整合狀態" delay={150}>
                <View style={{ gap: 12 }}>
                  <View
                    style={{
                      padding: 14,
                      borderRadius: theme.radius.md,
                      backgroundColor: "rgba(16,185,129,0.12)",
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: "#10B981", fontWeight: "700" }}>
                      已完成原生整合 ({integratedWidgets.length})
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                      {integratedWidgets.map((widget) => widget.name).join("、")}
                    </Text>
                  </View>

                  <View
                    style={{
                      padding: 14,
                      borderRadius: theme.radius.md,
                      backgroundColor: "rgba(245,158,11,0.12)",
                      gap: 6,
                    }}
                  >
                    <Text style={{ color: "#F59E0B", fontWeight: "700" }}>
                      預覽與資料模型已完成 ({previewWidgets.length})
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                      {previewWidgets.map((widget) => widget.name).join("、")}
                    </Text>
                  </View>

                  <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                    小工具要真正出現在主畫面，仍需跟著 iOS / Android 原生 target 一起建置；本頁主要用來確認版型與資訊優先順序。
                  </Text>
                </View>
              </AnimatedCard>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Screen>
  );
}
