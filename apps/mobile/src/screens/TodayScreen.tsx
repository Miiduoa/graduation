import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type {
  CampusSignal,
  ClubEvent,
  Course,
  CrowdReport,
  ImportedArtifact,
  InboxTask,
  MenuItem,
} from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { buildTodayActionBrief } from "../services/ai";
import { analytics } from "../services/analytics";
import { pickAndParseICalFile } from "../services/ical";
import {
  appendCrowdReport,
  appendImportedArtifact,
  buildCampusSignals,
  createCrowdReport,
  createImportedArtifactFromCalendar,
  createManualCourseArtifact,
  getFreshnessLabel,
  getTodaySourceLabel,
  listCrowdReports,
  listImportedArtifacts,
} from "../services/studentOs";
import { getFirstStorageValue, getScopedStorageKey } from "../services/scopedStorage";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useSchedule } from "../state/schedule";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { ContextStrip, CompletionState, HeroActionCard } from "../ui/campusOs";
import { shadowStyle, theme } from "../ui/theme";
import {
  formatDueWindow,
  getActionLabel,
  getInboxIntent,
  getInboxUrgency,
  getTodayCourses,
  resolveRoleMode,
  roleSummary,
  toInboxItem,
} from "../utils/campusOs";

type TimeSegment = "morning" | "class" | "afternoon" | "evening" | "night";
type CampusNavigation = {
  navigate?: (routeName: string, params?: unknown) => void;
};
type ManualCourseDraft = {
  title: string;
  location: string;
  instructor: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const QUICK_REPORT_PLACES = [
  { signalType: "cafeteria_queue" as const, placeId: "cafeteria", placeName: "學餐" },
  { signalType: "library_seat" as const, placeId: "library", placeName: "圖書館" },
  { signalType: "bus_crowd" as const, placeId: "bus", placeName: "校園公車" },
];

function getTimeSegment(): TimeSegment {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 13) return "class";
  if (hour >= 13 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早安";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午安";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚安";
  return "夜深了";
}

function getDateString() {
  const now = new Date();
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 ${WEEKDAYS[now.getDay()]}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function formatSignalWindow(signal: CampusSignal) {
  if (!signal.startAt) return getFreshnessLabel(signal.freshness);
  const date = new Date(signal.startAt);
  if (Number.isNaN(date.getTime())) return getFreshnessLabel(signal.freshness);
  const timeLabel = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (signal.endAt) {
    const endDate = new Date(signal.endAt);
    if (!Number.isNaN(endDate.getTime())) {
      const endLabel = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
      return `${timeLabel} - ${endLabel}`;
    }
  }
  return timeLabel;
}

function getSignalIcon(type: CampusSignal["type"]): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "course":
      return "school-outline";
    case "announcement":
      return "megaphone-outline";
    case "event":
      return "calendar-outline";
    case "menu":
      return "restaurant-outline";
    case "crowd":
      return "pulse-outline";
    case "imported_event":
      return "calendar-number-outline";
    case "task":
      return "checkbox-outline";
    case "mobility":
      return "bus-outline";
    case "place":
      return "navigate-circle-outline";
    case "ai_action":
      return "sparkles-outline";
    default:
      return "ellipse-outline";
  }
}

function getSignalTint(signal: CampusSignal) {
  switch (signal.source) {
    case "user_import":
      return theme.colors.accent;
    case "crowd_verified":
      return theme.colors.fresh;
    case "ai_synthesized":
      return theme.colors.social;
    case "official_public":
    default:
      if (signal.type === "announcement") return theme.colors.warning;
      if (signal.type === "event") return theme.colors.growth;
      if (signal.type === "menu") return theme.colors.achievement;
      return theme.colors.calm;
  }
}

function handleActionTarget(nav: CampusNavigation | undefined, target?: CampusSignal["actionTarget"]) {
  if (!target) return;
  if (target.tab && target.screen) {
    nav?.navigate?.(target.tab, { screen: target.screen, params: target.params });
    return;
  }
  if (target.tab) {
    nav?.navigate?.(target.tab);
    return;
  }
  if (target.screen) {
    nav?.navigate?.(target.screen, target.params);
  }
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: theme.colors.muted,
        fontSize: theme.typography.overline.fontSize,
        fontWeight: theme.typography.overline.fontWeight ?? "700",
        letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </Text>
  );
}

function Badge(props: { label: string; tint: string; soft?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius.full,
        backgroundColor: props.soft ? `${props.tint}12` : props.tint,
        borderWidth: 1,
        borderColor: `${props.tint}30`,
      }}
    >
      <Text
        style={{
          color: props.soft ? props.tint : "#fff",
          fontSize: 11,
          fontWeight: "700",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

function StreakBadge({ days }: { days: number }) {
  if (days < 2) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.streakSoft,
        borderWidth: 1,
        borderColor: `${theme.colors.streak}30`,
      }}
    >
      <Ionicons name="flame" size={12} color={theme.colors.streak} />
      <Text style={{ color: theme.colors.streak, fontSize: 11, fontWeight: "700" }}>{days} 天</Text>
    </View>
  );
}

function CampusSignalCard(props: {
  signal: CampusSignal;
  onPress?: () => void;
}) {
  const tint = getSignalTint(props.signal);
  const content = (
    <View
      style={{
        padding: 16,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 12,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tint}12`,
            borderWidth: 1,
            borderColor: `${tint}24`,
          }}
        >
          <Ionicons name={getSignalIcon(props.signal.type)} size={20} color={tint} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Badge label={getTodaySourceLabel(props.signal.source)} tint={tint} soft />
            <Badge label={getFreshnessLabel(props.signal.freshness)} tint={theme.colors.muted} soft />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{props.signal.title}</Text>
          {props.signal.description ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
              {props.signal.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {props.signal.meta ? <Badge label={props.signal.meta} tint={theme.colors.accent} soft /> : null}
        {props.signal.startAt ? <Badge label={formatSignalWindow(props.signal)} tint={theme.colors.growth} soft /> : null}
        {props.signal.location ? <Badge label={props.signal.location} tint={theme.colors.calm} soft /> : null}
      </View>
    </View>
  );

  if (!props.onPress) return content;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      {content}
    </Pressable>
  );
}

function AIBriefCard(props: {
  summary: string;
  reasons: string[];
  onActionPress: (action: { actionTarget?: CampusSignal["actionTarget"] }) => void;
  actions: Array<{ id: string; label: string; reason?: string; actionTarget?: CampusSignal["actionTarget"] }>;
}) {
  return (
    <View
      style={{
        padding: 18,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.focusSurface,
        borderWidth: 1,
        borderColor: `${theme.colors.social}26`,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${theme.colors.social}12`,
          }}
        >
          <Ionicons name="sparkles" size={20} color={theme.colors.social} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.social, fontSize: 12, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" }}>
            AI Action Brief
          </Text>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700", marginTop: 3 }}>
            今天先把決策順序排好
          </Text>
        </View>
      </View>

      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 }}>
        {props.summary}
      </Text>

      <View style={{ gap: 6 }}>
        {props.reasons.slice(0, 3).map((reason, index) => (
          <View key={`${reason}-${index}`} style={{ flexDirection: "row", gap: 8 }}>
            <Text style={{ color: theme.colors.social, fontWeight: "800" }}>{index + 1}.</Text>
            <Text style={{ color: theme.colors.textSecondary, flex: 1, lineHeight: 20 }}>{reason}</Text>
          </View>
        ))}
      </View>

      {props.actions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {props.actions.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => props.onActionPress(action)}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: theme.radius.full,
                backgroundColor: pressed ? `${theme.colors.social}18` : `${theme.colors.social}12`,
                borderWidth: 1,
                borderColor: `${theme.colors.social}28`,
              })}
            >
              <Text style={{ color: theme.colors.social, fontSize: 12, fontWeight: "700" }}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ImportHubCard(props: {
  personalized: boolean;
  confirmedArtifactsCount: number;
  courseCount: number;
  onImportIcal: () => void;
  onManualCourse: () => void;
  onOpenCalendar: () => void;
}) {
  const title = props.personalized ? "維持你的 Today 精準度" : "把公開入口升級成你的 Today";
  const description = props.personalized
    ? `目前已連動 ${props.courseCount} 門課與 ${props.confirmedArtifactsCount} 份匯入資料。需要時再補上 iCal 或手動課表。`
    : "先匯入課表、行事曆或手動建立課程，Today 才能真正按你的時間、地點與節奏排序。";

  return (
    <View
      style={{
        padding: 18,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 14,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <Ionicons name="download-outline" size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 6 }}>
            {description}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Pressable
          onPress={props.onImportIcal}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: theme.radius.full,
            backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
          })}
        >
          <Ionicons name="calendar-outline" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>匯入 iCal</Text>
        </Pressable>

        <Pressable
          onPress={props.onManualCourse}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: theme.radius.full,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          })}
        >
          <Ionicons name="create-outline" size={16} color={theme.colors.text} />
          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700" }}>手動課表</Text>
        </Pressable>

        <Pressable
          onPress={props.onOpenCalendar}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: theme.radius.full,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
          })}
        >
          <Ionicons name="open-outline" size={16} color={theme.colors.text} />
          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "700" }}>打開行事曆</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CrowdPulseCard(props: {
  reports: CrowdReport[];
  onQuickReport: (input: {
    signalType: CrowdReport["signalType"];
    placeId: string;
    placeName: string;
    value: CrowdReport["value"];
  }) => void;
}) {
  const latestByPlace = useMemo(() => {
    const map = new Map<string, CrowdReport>();
    for (const report of props.reports) {
      const key = `${report.signalType}:${report.placeId}`;
      const existing = map.get(key);
      if (!existing || new Date(report.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        map.set(key, report);
      }
    }
    return map;
  }, [props.reports]);

  return (
    <View
      style={{
        padding: 18,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 16,
        ...shadowStyle(theme.shadows.sm),
      }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>Verified Campus Pulse</Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 }}>
          讓同學回報的學餐排隊、圖書館座位、公車狀況進到 Today，但只保留有時效的資訊。
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {QUICK_REPORT_PLACES.map((place) => {
          const latest = latestByPlace.get(`${place.signalType}:${place.placeId}`);
          return (
            <View
              key={`${place.signalType}:${place.placeId}`}
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: 14,
                gap: 10,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>{place.placeName}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                    {latest
                      ? `最近回報：${latest.value === "high" ? "偏擠" : latest.value === "low" ? "順暢" : "普通"} · ${getFreshnessLabel("new")}`
                      : "目前還沒有有效回報"}
                  </Text>
                </View>
                {latest ? (
                  <Badge
                    label={latest.value === "high" ? "偏擠" : latest.value === "low" ? "順暢" : "普通"}
                    tint={latest.value === "high" ? theme.colors.warning : latest.value === "low" ? theme.colors.growth : theme.colors.calm}
                    soft
                  />
                ) : null}
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  { label: "順暢", value: "low" as const, tint: theme.colors.growth },
                  { label: "普通", value: "medium" as const, tint: theme.colors.calm },
                  { label: "偏擠", value: "high" as const, tint: theme.colors.warning },
                ].map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      props.onQuickReport({
                        signalType: place.signalType,
                        placeId: place.placeId,
                        placeName: place.placeName,
                        value: option.value,
                      })
                    }
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingVertical: 9,
                      borderRadius: theme.radius.md,
                      backgroundColor: pressed ? `${option.tint}18` : `${option.tint}10`,
                      borderWidth: 1,
                      borderColor: `${option.tint}25`,
                    })}
                  >
                    <Text style={{ color: option.tint, fontSize: 12, fontWeight: "700" }}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ImportPreviewModal(props: {
  visible: boolean;
  artifact: ImportedArtifact | null;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const selectedCount = props.artifact?.parsedEntities.filter((entity) => props.selectedIds.has(entity.id)).length ?? 0;

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: "flex-end" }}>
        <View
          style={{
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 30,
            gap: 16,
            maxHeight: "80%",
          }}
        >
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>確認匯入內容</Text>
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 20 }}>
              逐筆勾選你要納入 Today 的事件。只有你確認過的項目才會成為個人化訊號。
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 10 }}>
              {props.artifact?.parsedEntities.map((entity) => {
                const checked = props.selectedIds.has(entity.id);
                return (
                  <Pressable
                    key={entity.id}
                    onPress={() => props.onToggle(entity.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      padding: 14,
                      borderRadius: theme.radius.lg,
                      borderWidth: 1,
                      borderColor: checked ? `${theme.colors.accent}45` : theme.colors.border,
                      backgroundColor: checked ? theme.colors.focusSurface : theme.colors.surface2,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor: checked ? theme.colors.accent : theme.colors.muted,
                        backgroundColor: checked ? theme.colors.accent : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {checked ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{entity.title}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                        {[entity.startTime, entity.endTime ? `- ${entity.endTime}` : null, entity.location].filter(Boolean).join(" ")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={props.onClose}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
              })}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={props.onConfirm}
              style={({ pressed }) => ({
                flex: 1.4,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>匯入選中的 {selectedCount} 筆</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ManualCourseModal(props: {
  visible: boolean;
  draft: ManualCourseDraft;
  onChange: (next: ManualCourseDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: "flex-end" }}>
        <View
          style={{
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 30,
            gap: 16,
          }}
        >
          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>手動建立課表</Text>
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 20 }}>
              這會同時建立你的課程資料與一份已確認的匯入紀錄。
            </Text>
          </View>

          <View style={{ gap: 12 }}>
            {[
              { key: "title", label: "課程名稱", placeholder: "例如：英文聽講" },
              { key: "location", label: "地點", placeholder: "例如：任垣樓 201" },
              { key: "instructor", label: "授課教師", placeholder: "例如：王老師" },
              { key: "startTime", label: "開始時間", placeholder: "08:10" },
              { key: "endTime", label: "結束時間", placeholder: "09:00" },
            ].map((field) => (
              <View key={field.key} style={{ gap: 6 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }}>{field.label}</Text>
                <TextInput
                  value={props.draft[field.key as keyof ManualCourseDraft] as string}
                  onChangeText={(value) =>
                    props.onChange({
                      ...props.draft,
                      [field.key]: value,
                    })
                  }
                  placeholder={field.placeholder}
                  placeholderTextColor={theme.colors.muted}
                  style={{
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surface2,
                  }}
                />
              </View>
            ))}

            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }}>星期</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {WEEKDAYS.map((label, index) => (
                  <Pressable
                    key={label}
                    onPress={() => props.onChange({ ...props.draft, dayOfWeek: index })}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      borderRadius: theme.radius.full,
                      backgroundColor:
                        props.draft.dayOfWeek === index
                          ? theme.colors.accent
                          : pressed
                            ? theme.colors.surface2
                            : theme.colors.surface,
                      borderWidth: 1,
                      borderColor:
                        props.draft.dayOfWeek === index ? theme.colors.accent : theme.colors.border,
                    })}
                  >
                    <Text
                      style={{
                        color: props.draft.dayOfWeek === index ? "#fff" : theme.colors.text,
                        fontWeight: "700",
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={props.onClose}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
              })}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "700" }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={props.onSubmit}
              style={({ pressed }) => ({
                flex: 1.4,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>建立課程</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function TodayScreen(props: { navigation?: CampusNavigation }) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const schedule = useSchedule();
  const storageContext = useMemo(
    () => ({ uid: auth.user?.uid ?? null, schoolId: school.id }),
    [auth.user?.uid, school.id]
  );
  const streakStorageKey = useMemo(
    () => getScopedStorageKey("streak", storageContext),
    [storageContext]
  );

  const [streakDays, setStreakDays] = useState(0);
  const [importedArtifacts, setImportedArtifacts] = useState<ImportedArtifact[]>([]);
  const [crowdReports, setCrowdReports] = useState<CrowdReport[]>([]);
  const [pendingImportArtifact, setPendingImportArtifact] = useState<ImportedArtifact | null>(null);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [showManualCourseModal, setShowManualCourseModal] = useState(false);
  const [manualCourseDraft, setManualCourseDraft] = useState<ManualCourseDraft>({
    title: "",
    location: "",
    instructor: "",
    dayOfWeek: 1,
    startTime: "08:10",
    endTime: "09:00",
  });
  const streakPulse = useRef(new Animated.Value(1)).current;

  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const roleCopy = roleSummary(roleMode);
  const segment = getTimeSegment();
  const displayName = auth.profile?.displayName?.split(" ")[0];
  const roleFallbackName = roleMode === "guest" ? "你" : "同學";

  const { items: inboxTasks, refresh: refreshInbox, refreshing: inboxRefreshing } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const { items: announcements, refresh: refreshAnnouncements } = useAsyncList(
    async () => (await ds.listAnnouncements(school.id)).slice(0, 3),
    [ds, school.id]
  );

  const { items: events, refresh: refreshEvents } = useAsyncList<ClubEvent>(
    async () =>
      (await ds.listEvents(school.id))
        .filter((event) => {
          const startsAt = new Date(event.startsAt);
          return !Number.isNaN(startsAt.getTime()) && startsAt.getTime() >= Date.now() - 1000 * 60 * 60;
        })
        .slice(0, 3),
    [ds, school.id]
  );

  const { items: menus, refresh: refreshMenus } = useAsyncList<MenuItem>(
    async () => (await ds.listMenus(school.id)).slice(0, 3),
    [ds, school.id]
  );

  const loadLocalSignals = useCallback(async () => {
    const [artifacts, reports] = await Promise.all([
      listImportedArtifacts(storageContext),
      listCrowdReports(storageContext),
    ]);
    setImportedArtifacts(artifacts);
    setCrowdReports(reports);
  }, [storageContext]);

  useEffect(() => {
    loadLocalSignals().catch(() => void 0);
  }, [loadLocalSignals]);

  useEffect(() => {
    const legacyStreakKey = "campus.streak.v1";
    type StreakData = {
      currentStreak: number;
      longestStreak: number;
      lastLoginDate: string;
      totalDays: number;
    };

    const update = async () => {
      try {
        const raw = await getFirstStorageValue([streakStorageKey, legacyStreakKey]);
        const existing: StreakData = raw
          ? (JSON.parse(raw) as StreakData)
          : {
              currentStreak: 0,
              longestStreak: 0,
              lastLoginDate: "",
              totalDays: 0,
            };

        const today = new Date().toISOString().split("T")[0];
        if (existing.lastLoginDate === today) {
          setStreakDays(existing.currentStreak);
          return;
        }

        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
        const newStreak = existing.lastLoginDate === yesterday ? existing.currentStreak + 1 : 1;
        const updated: StreakData = {
          currentStreak: newStreak,
          longestStreak: Math.max(existing.longestStreak, newStreak),
          lastLoginDate: today,
          totalDays: existing.totalDays + 1,
        };

        await AsyncStorage.setItem(streakStorageKey, JSON.stringify(updated));
        setStreakDays(updated.currentStreak);

        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // ignore
        }

        streakPulse.setValue(1);
        Animated.sequence([
          Animated.timing(streakPulse, { toValue: 1.12, duration: 220, useNativeDriver: true }),
          Animated.timing(streakPulse, { toValue: 1.0, duration: 220, useNativeDriver: true }),
        ]).start();
      } catch {
        // ignore
      }
    };

    update();
  }, [streakPulse, streakStorageKey]);

  const rankedInboxItems = useMemo(
    () => inboxTasks.map(toInboxItem).sort((a, b) => a.priority - b.priority),
    [inboxTasks]
  );

  const urgentInboxItems = useMemo(() => rankedInboxItems.slice(0, 3), [rankedInboxItems]);
  const todayCourses = useMemo(() => getTodayCourses(schedule.courses), [schedule.courses]);
  const confirmedArtifacts = useMemo(
    () => importedArtifacts.filter((artifact) => artifact.userConfirmedAt),
    [importedArtifacts]
  );
  const personalizedReady = todayCourses.length > 0 || confirmedArtifacts.length > 0;

  const campusSignals = useMemo(
    () =>
      buildCampusSignals({
        schoolId: school.id,
        announcements,
        events,
        menus,
        courses: schedule.courses,
        importedArtifacts,
        crowdReports,
      }),
    [announcements, crowdReports, events, importedArtifacts, menus, schedule.courses, school.id]
  );

  const aiBrief = useMemo(
    () =>
      buildTodayActionBrief({
        signals: campusSignals,
        importedArtifacts,
        userName: displayName ?? roleFallbackName,
        role: auth.profile?.role,
        schoolName: school.shortName ?? school.name,
      }),
    [auth.profile?.role, campusSignals, displayName, importedArtifacts, roleFallbackName, school.name, school.shortName]
  );

  const nextAction = useMemo(() => rankedInboxItems[0] ?? null, [rankedInboxItems]);
  const heroSignal = useMemo(
    () => campusSignals.find((signal) => signal.source === "user_import" || signal.type === "course") ?? campusSignals[0] ?? null,
    [campusSignals]
  );

  const highPressureCount = rankedInboxItems.filter(
    (item) => item.urgency === "critical" || item.urgency === "high"
  ).length;

  const handleNextActionPress = useCallback(() => {
    if (!nextAction) return;
    if (nextAction.kind === "live" && nextAction.sessionId) {
      nav?.navigate?.("課程", {
        screen: "Classroom",
        params: { groupId: nextAction.groupId, sessionId: nextAction.sessionId },
      });
      return;
    }
    if ((nextAction.kind === "assignment" || nextAction.kind === "quiz") && nextAction.assignmentId) {
      nav?.navigate?.("收件匣", {
        screen: "AssignmentDetail",
        params: { groupId: nextAction.groupId, assignmentId: nextAction.assignmentId },
      });
      return;
    }
    nav?.navigate?.("收件匣", {
      screen: "GroupDetail",
      params: { groupId: nextAction.groupId },
    });
  }, [nav, nextAction]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshInbox(),
      refreshAnnouncements(),
      refreshEvents(),
      refreshMenus(),
      schedule.refreshSchedule(),
      loadLocalSignals(),
    ]);
  }, [loadLocalSignals, refreshAnnouncements, refreshEvents, refreshInbox, refreshMenus, schedule]);

  const handlePickIcal = useCallback(async () => {
    try {
      const calendar = await pickAndParseICalFile();
      if (!calendar || calendar.events.length === 0) return;
      const artifact = createImportedArtifactFromCalendar(calendar);
      setPendingImportArtifact(artifact);
      setSelectedImportIds(new Set());
      analytics.logFeatureUsed("today_import_ical_preview", { count: artifact.parsedEntities.length });
    } catch (error: unknown) {
      Alert.alert("匯入失敗", getErrorMessage(error, "無法解析 iCal 檔案"));
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImportArtifact) return;
    const parsedEntities = pendingImportArtifact.parsedEntities.filter((entity) => selectedImportIds.has(entity.id));

    if (parsedEntities.length === 0) {
      Alert.alert("尚未選擇項目", "請至少勾選一筆確認後再匯入。");
      return;
    }

    const confirmedArtifact: ImportedArtifact = {
      ...pendingImportArtifact,
      parsedEntities,
      userConfirmedAt: new Date().toISOString(),
    };

    const next = await appendImportedArtifact(confirmedArtifact, storageContext);
    setImportedArtifacts(next);
    setPendingImportArtifact(null);
    setSelectedImportIds(new Set());
    analytics.logFeatureUsed("today_import_ical_confirmed", { count: parsedEntities.length });
    Alert.alert("匯入完成", `已新增 ${parsedEntities.length} 筆已確認的個人資料。`);
  }, [pendingImportArtifact, selectedImportIds, storageContext]);

  const handleCreateManualCourse = useCallback(async () => {
    if (!manualCourseDraft.title.trim()) {
      Alert.alert("缺少課程名稱", "請先填入課程名稱。");
      return;
    }

    const course: Course = {
      id: `manual-course-${Date.now()}`,
      code: "MANUAL",
      name: manualCourseDraft.title.trim(),
      instructor: manualCourseDraft.instructor.trim() || "自行建立",
      teacher: manualCourseDraft.instructor.trim() || "自行建立",
      credits: 0,
      semester: "自訂",
      location: manualCourseDraft.location.trim() || "未設定地點",
      dayOfWeek: manualCourseDraft.dayOfWeek,
      startTime: manualCourseDraft.startTime,
      endTime: manualCourseDraft.endTime,
      schoolId: school.id,
      schedule: [
        {
          dayOfWeek: manualCourseDraft.dayOfWeek,
          startTime: manualCourseDraft.startTime,
          endTime: manualCourseDraft.endTime,
          location: manualCourseDraft.location.trim() || "未設定地點",
        },
      ],
    };

    try {
      await schedule.addCourse(course);
      const artifact = createManualCourseArtifact({
        title: manualCourseDraft.title.trim(),
        location: manualCourseDraft.location.trim(),
        dayOfWeek: manualCourseDraft.dayOfWeek,
        startTime: manualCourseDraft.startTime,
        endTime: manualCourseDraft.endTime,
      });
      const confirmedArtifact: ImportedArtifact = {
        ...artifact,
        userConfirmedAt: new Date().toISOString(),
      };
      const next = await appendImportedArtifact(confirmedArtifact, storageContext);
      setImportedArtifacts(next);
      setShowManualCourseModal(false);
      setManualCourseDraft({
        title: "",
        location: "",
        instructor: "",
        dayOfWeek: 1,
        startTime: "08:10",
        endTime: "09:00",
      });
      analytics.logFeatureUsed("today_manual_course_added", { schoolId: school.id });
      Alert.alert("課程已建立", "這門課現在會出現在你的 Today 與課表中。");
    } catch (error: unknown) {
      Alert.alert("建立失敗", getErrorMessage(error, "課程時間可能與既有項目衝突。"));
    }
  }, [manualCourseDraft, schedule, school.id, storageContext]);

  const handleQuickReport = useCallback(
    async (input: {
      signalType: CrowdReport["signalType"];
      placeId: string;
      placeName: string;
      value: CrowdReport["value"];
    }) => {
      const report = createCrowdReport({
        schoolId: school.id,
        signalType: input.signalType,
        placeId: input.placeId,
        placeName: input.placeName,
        value: input.value,
        reporterReputation: auth.user ? 0.82 : 0.58,
      });
      const next = await appendCrowdReport(report, storageContext);
      setCrowdReports(next);
      analytics.logFeatureUsed("today_quick_report", {
        signal_type: input.signalType,
        place_id: input.placeId,
        value: input.value,
      });
    },
    [auth.user, school.id, storageContext]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={inboxRefreshing || schedule.loading}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 12,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 13, fontWeight: "500" }}>{getDateString()}</Text>
            <Animated.View style={{ transform: [{ scale: streakPulse }] }}>
              <StreakBadge days={streakDays} />
            </Animated.View>
          </View>

          <View style={{ gap: 4 }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.display.fontSize,
                fontWeight: theme.typography.display.fontWeight ?? "800",
                letterSpacing: theme.typography.display.letterSpacing,
              }}
            >
              {getGreeting()}，{displayName ?? roleFallbackName}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21 }}>
              {personalizedReady
                ? `${school.name} · ${segment === "morning" ? "先看接下來的時間節點" : segment === "evening" ? "把今天收尾、把明天排好" : "把校務、移動與生活節奏放在同一頁"}`
                : `${school.name} · ${roleCopy.hint}`}
            </Text>
          </View>

          {rankedInboxItems.length > 0 ? (
            <View style={{ gap: 6 }}>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.border,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    backgroundColor:
                      highPressureCount === 0
                        ? theme.colors.growth
                        : highPressureCount === rankedInboxItems.length
                          ? theme.colors.urgent
                          : theme.colors.warning,
                    width: `${Math.max((highPressureCount / rankedInboxItems.length) * 100, highPressureCount > 0 ? 12 : 100)}%`,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                {highPressureCount > 0
                  ? `目前有 ${highPressureCount} 件高壓事項，Today 會優先把它們排在前面`
                  : "目前沒有高壓事項，Today 以你的課程與校園情境排序"}
              </Text>
            </View>
          ) : null}
        </View>

        {!personalizedReady ? (
          <ContextStrip
            eyebrow="Public Mode"
            title="目前先用公開資料模式運作"
            description="你已經能看公告、活動、餐廳與 campus pulse，但匯入課表或行事曆後，Today 才會真正按你的節奏排序。"
            right={<Badge label="等待個人資料" tint={theme.colors.warning} soft />}
          />
        ) : (
          <ContextStrip
            eyebrow="Student OS"
            title="Today 已進入個人化模式"
            description={`目前已整合 ${todayCourses.length} 門課、${confirmedArtifacts.length} 份匯入資料，並持續用校園公開資訊與同學回報補強決策。`}
            right={<Badge label={`${campusSignals.length} 個有效訊號`} tint={theme.colors.accent} soft />}
          />
        )}

        {!personalizedReady ? (
          <HeroActionCard
            icon="download-outline"
            eyebrow="建立你的第一個 daily reason"
            title="先把課表或 iCal 接進來"
            description="不要只停在公開資訊。只要你確認過一份課表或行事曆，Today 就能開始幫你排先後順序。"
            meta="等待匯入"
            tone="accent"
            actionLabel="現在開始"
            onPress={handlePickIcal}
          />
        ) : nextAction ? (
          <HeroActionCard
            icon={
              nextAction.kind === "live"
                ? "pulse"
                : getInboxIntent(nextAction) === "reply"
                  ? "chatbubble-ellipses"
                  : "document-text"
            }
            eyebrow={`收件匣 · ${getActionLabel(getInboxIntent(nextAction))}`}
            title={nextAction.title}
            description={nextAction.reason ?? toInboxItem(nextAction).reason ?? "這件事會影響你接下來的節奏"}
            meta={nextAction.dueAt ? formatDueWindow(new Date(nextAction.dueAt)) : "等待處理"}
            tone={
              getInboxUrgency(nextAction) === "critical"
                ? "danger"
                : getInboxUrgency(nextAction) === "high"
                  ? "warning"
                  : "accent"
            }
            actionLabel={nextAction.actionLabel ?? getActionLabel(getInboxIntent(nextAction))}
            onPress={handleNextActionPress}
          />
        ) : heroSignal ? (
          <HeroActionCard
            icon={getSignalIcon(heroSignal.type)}
            eyebrow={`${getTodaySourceLabel(heroSignal.source)} · 下一步`}
            title={heroSignal.title}
            description={heroSignal.description ?? "這是你現在最值得先看的校園節點"}
            meta={getFreshnessLabel(heroSignal.freshness)}
            tone={heroSignal.source === "crowd_verified" ? "success" : heroSignal.type === "announcement" ? "warning" : "accent"}
            actionLabel="前往查看"
            onPress={() => handleActionTarget(nav, heroSignal.actionTarget)}
          />
        ) : (
          <CompletionState
            title="今天沒有需要立刻處理的節點"
            description="你已經把急迫事項清掉了。接下來可以補齊個人資料，讓 Tomorrow 也開始變聰明。"
            actionLabel="打開行事曆"
            onPress={() => nav?.navigate?.("課程", { screen: "Calendar" })}
          />
        )}

        {aiBrief ? (
          <AIBriefCard
            summary={aiBrief.summary}
            reasons={aiBrief.reasons}
            actions={aiBrief.suggestedActions}
            onActionPress={(action) => handleActionTarget(nav, action.actionTarget)}
          />
        ) : null}

        <ImportHubCard
          personalized={personalizedReady}
          confirmedArtifactsCount={confirmedArtifacts.length}
          courseCount={schedule.courses.length}
          onImportIcal={handlePickIcal}
          onManualCourse={() => setShowManualCourseModal(true)}
          onOpenCalendar={() => nav?.navigate?.("課程", { screen: "Calendar" })}
        />

        {campusSignals.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionLabel>Today Intelligence</SectionLabel>
            {campusSignals.slice(0, 5).map((signal) => (
              <CampusSignalCard
                key={signal.id}
                signal={signal}
                onPress={() => handleActionTarget(nav, signal.actionTarget)}
              />
            ))}
          </View>
        ) : null}

        {auth.user && urgentInboxItems.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SectionLabel>待處理事項</SectionLabel>
            <View
              style={{
                padding: 16,
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                ...shadowStyle(theme.shadows.sm),
              }}
            >
              <View style={{ gap: 12 }}>
                {urgentInboxItems.map((item, index) => (
                  <Pressable
                    key={`${item.groupId}-${index}`}
                    onPress={() => {
                      const normalized = toInboxItem(item);
                      if (normalized.kind === "live" && normalized.sessionId) {
                        nav?.navigate?.("課程", {
                          screen: "Classroom",
                          params: { groupId: normalized.groupId, sessionId: normalized.sessionId },
                        });
                      } else if (normalized.assignmentId) {
                        nav?.navigate?.("收件匣", {
                          screen: "AssignmentDetail",
                          params: { groupId: normalized.groupId, assignmentId: normalized.assignmentId },
                        });
                      } else {
                        nav?.navigate?.("收件匣", {
                          screen: "GroupDetail",
                          params: { groupId: normalized.groupId },
                        });
                      }
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      opacity: pressed ? 0.82 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor:
                          item.urgency === "critical"
                            ? theme.colors.urgent
                            : item.urgency === "high"
                              ? theme.colors.warning
                              : item.urgency === "medium"
                                ? theme.colors.accent
                                : theme.colors.muted,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>{item.title}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                        {item.reason ?? item.nextStep ?? "查看細節"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        <CrowdPulseCard reports={crowdReports} onQuickReport={handleQuickReport} />

        <Pressable
          onPress={() => nav?.navigate?.("AIChat")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            padding: 16,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.focusSurface,
            borderWidth: 1,
            borderColor: `${theme.colors.accent}30`,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              backgroundColor: theme.colors.accentSoft,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: `${theme.colors.accent}30`,
            }}
          >
            <Ionicons name="sparkles" size={20} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>Campus AI 助理</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              問時間規劃、找地點、整理今天的下一步
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={theme.colors.accent} />
        </Pressable>
      </ScrollView>

      <ImportPreviewModal
        visible={Boolean(pendingImportArtifact)}
        artifact={pendingImportArtifact}
        selectedIds={selectedImportIds}
        onToggle={(id) =>
          setSelectedImportIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            return next;
          })
        }
        onClose={() => {
          setPendingImportArtifact(null);
          setSelectedImportIds(new Set());
        }}
        onConfirm={handleConfirmImport}
      />

      <ManualCourseModal
        visible={showManualCourseModal}
        draft={manualCourseDraft}
        onChange={setManualCourseDraft}
        onClose={() => setShowManualCourseModal(false)}
        onSubmit={handleCreateManualCourse}
      />
    </View>
  );
}
