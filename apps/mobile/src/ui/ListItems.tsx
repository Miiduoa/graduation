import React, { memo, useCallback } from "react";
import { View, Text, Pressable, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getCurrentTheme, shadowStyle } from "./theme";
import { Pill, StatusBadge } from "./components";
import { formatDateTime, formatRelativeTime, toDate } from "../utils/format";

export type AnnouncementItemProps = {
  id: string;
  title: string;
  body: string;
  source?: string;
  publishedAt: unknown;
  onPress: (id: string) => void;
};

export const AnnouncementItem = memo(function AnnouncementItem({
  id,
  title,
  body,
  source,
  publishedAt,
  onPress,
}: AnnouncementItemProps) {
  const theme = getCurrentTheme();
  const handlePress = useCallback(() => onPress(id), [id, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.colors.accent : theme.colors.border,
        padding: 18,
        gap: 10,
        ...shadowStyle(theme.shadows.sm),
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`查看公告：${title}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {source && (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.accentSoft,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "600" }}>
              {source}
            </Text>
          </View>
        )}
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
          {formatDateTime(publishedAt)}
        </Text>
      </View>

      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: theme.colors.text,
          letterSpacing: -0.2,
          lineHeight: 23,
        }}
        numberOfLines={2}
      >
        {title}
      </Text>

      <Text
        style={{ color: theme.colors.muted, lineHeight: 21, fontSize: 14 }}
        numberOfLines={2}
      >
        {body}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
        <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>
          查看詳情
        </Text>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} style={{ marginLeft: 2 }} />
      </View>
    </Pressable>
  );
}, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.title === next.title &&
    prev.body === next.body &&
    prev.source === next.source &&
    prev.publishedAt === next.publishedAt
  );
});

export type EventStatus = "upcoming" | "ongoing" | "ended";

export type EventItemProps = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: unknown;
  endsAt?: unknown;
  capacity?: number;
  registeredCount?: number;
  isFavorite?: boolean;
  status: EventStatus;
  viewMode?: "list" | "card";
  onPress: (id: string) => void;
};

export const EventItem = memo(function EventItem({
  id,
  title,
  description,
  location,
  startsAt,
  endsAt,
  capacity,
  registeredCount,
  isFavorite = false,
  status,
  viewMode = "list",
  onPress,
}: EventItemProps) {
  const theme = getCurrentTheme();
  const startDate = toDate(startsAt);
  const range = `${formatDateTime(startsAt)} ~ ${formatDateTime(endsAt)}`;
  const handlePress = useCallback(() => onPress(id), [id, onPress]);

  const statusColor =
    status === "ongoing" ? theme.colors.success :
    status === "upcoming" ? theme.colors.accent :
    theme.colors.muted;

  if (viewMode === "card") {
    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => ({
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: "hidden",
          ...shadowStyle(theme.shadows.sm),
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
      >
        <View
          style={{
            height: 90,
            backgroundColor: `${statusColor}08`,
            alignItems: "center",
            justifyContent: "center",
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 16,
              backgroundColor: `${statusColor}15`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="calendar" size={24} color={statusColor} />
          </View>
          {status === "ongoing" && (
            <View style={{
              position: "absolute",
              top: 10,
              right: 10,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.success,
            }}>
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>進行中</Text>
            </View>
          )}
          {isFavorite && (
            <View style={{ position: "absolute", top: 10, left: 10 }}>
              <Ionicons name="heart" size={20} color={theme.colors.danger} />
            </View>
          )}
        </View>
        <View style={{ padding: 16, gap: 8 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, letterSpacing: -0.2 }}
            numberOfLines={2}
          >
            {title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="time-outline" size={13} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {startDate ? formatRelativeTime(startDate) : formatDateTime(startsAt)}
            </Text>
          </View>
          {location && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="location-outline" size={13} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }} numberOfLines={1}>{location}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
            {capacity ? (
              <Pill
                text={`${registeredCount ?? 0}/${capacity} 人`}
                kind={(registeredCount ?? 0) >= capacity ? "danger" : "accent"}
                size="sm"
              />
            ) : (
              <Pill text={registeredCount ? `${registeredCount} 人報名` : "不限人數"} size="sm" />
            )}
            {status === "ended" && <Pill text="已結束" kind="muted" size="sm" />}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: pressed ? theme.colors.accent : theme.colors.border,
        padding: 18,
        gap: 10,
        ...shadowStyle(theme.shadows.sm),
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`查看活動：${title}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {status === "ongoing" && <StatusBadge status="open" text="進行中" />}
        {status === "upcoming" && startDate && (
          <Pill text={formatRelativeTime(startDate)} kind="accent" size="sm" />
        )}
        {status === "ended" && <StatusBadge status="closed" text="已結束" />}
        {isFavorite && <Ionicons name="heart" size={16} color={theme.colors.danger} />}
      </View>

      <Text
        style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text, letterSpacing: -0.2, lineHeight: 23 }}
        numberOfLines={2}
      >
        {title}
      </Text>

      <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19 }}>
        {`${range}${location ? ` · ${location}` : ""}`}
      </Text>

      {description && (
        <Text style={{ color: theme.colors.textSecondary, lineHeight: 21, fontSize: 14 }} numberOfLines={2}>
          {description}
        </Text>
      )}

      <View style={{ marginTop: 4, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {capacity ? (
          <Pill
            text={`${registeredCount ?? 0}/${capacity} 人報名`}
            kind={(registeredCount ?? 0) >= capacity ? "danger" : "accent"}
            size="sm"
          />
        ) : (
          <Pill text={registeredCount ? `${registeredCount} 人報名` : "名額不限"} kind="accent" size="sm" />
        )}
      </View>
    </Pressable>
  );
}, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.title === next.title &&
    prev.description === next.description &&
    prev.location === next.location &&
    prev.startsAt === next.startsAt &&
    prev.endsAt === next.endsAt &&
    prev.capacity === next.capacity &&
    prev.registeredCount === next.registeredCount &&
    prev.isFavorite === next.isFavorite &&
    prev.status === next.status &&
    prev.viewMode === next.viewMode
  );
});

export type MenuItemProps = {
  id: string;
  name: string;
  price?: number;
  cafeteria: string;
  availableOn: string;
  isAvailable?: boolean;
  onPress?: (id: string) => void;
};

export const MenuItem = memo(function MenuItem({
  id,
  name,
  price,
  cafeteria,
  availableOn,
  isAvailable = true,
  onPress,
}: MenuItemProps) {
  const theme = getCurrentTheme();
  const handlePress = useCallback(() => onPress?.(id), [id, onPress]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: isAvailable ? 1 : 0.45,
        gap: 14,
        ...shadowStyle(theme.shadows.sm),
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: theme.colors.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="restaurant-outline" size={20} color={theme.colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 15, letterSpacing: -0.1 }}>
          {name}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
          {cafeteria}
        </Text>
      </View>
      {!isAvailable ? (
        <Pill text="已售完" kind="danger" size="sm" />
      ) : price !== undefined ? (
        <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 17 }}>
          ${price}
        </Text>
      ) : null}
    </Pressable>
  );
}, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.price === next.price &&
    prev.cafeteria === next.cafeteria &&
    prev.availableOn === next.availableOn &&
    prev.isAvailable === next.isAvailable
  );
});
