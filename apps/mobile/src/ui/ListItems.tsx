/* eslint-disable */
import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCurrentTheme } from './theme';
import { useThemeVersion } from './useThemeStyleSheet';
import { Pill, StatusBadge } from './components';
import { formatDateTime, formatRelativeTime, toDate } from '../utils/format';

export type AnnouncementItemProps = {
  id: string;
  title: string;
  body: string;
  source?: string;
  publishedAt: unknown;
  onPress: (id: string) => void;
};

export const AnnouncementItem = memo(
  function AnnouncementItem({
    id,
    title,
    body,
    source,
    publishedAt,
    onPress,
  }: AnnouncementItemProps) {
    useThemeVersion();
    const theme = getCurrentTheme();
    const handlePress = useCallback(() => onPress(id), [id, onPress]);

    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        })}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`查看公告：${title}`}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {source ? (
              <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                {source}
              </Text>
            ) : null}
            {source ? <Text style={{ color: theme.colors.muted, fontSize: 12 }}>·</Text> : null}
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {formatDateTime(publishedAt)}
            </Text>
          </View>

          <Text
            style={{
              fontSize: theme.typography.h3.fontSize,
              fontWeight: '600',
              color: theme.colors.text,
              letterSpacing: theme.typography.h3.letterSpacing,
              lineHeight: theme.typography.h3.lineHeight,
            }}
            numberOfLines={2}
          >
            {title}
          </Text>

          <Text
            style={{
              color: theme.colors.textSecondary,
              lineHeight: theme.typography.bodySmall.lineHeight,
              fontSize: theme.typography.bodySmall.fontSize,
            }}
            numberOfLines={2}
          >
            {body}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
      </Pressable>
    );
  },
  (prev, next) => {
    return (
      prev.id === next.id &&
      prev.title === next.title &&
      prev.body === next.body &&
      prev.source === next.source &&
      prev.publishedAt === next.publishedAt
    );
  },
);

export type EventStatus = 'upcoming' | 'ongoing' | 'ended';

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
  viewMode?: 'list' | 'card';
  onPress: (id: string) => void;
};

export const EventItem = memo(
  function EventItem({
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
    viewMode = 'list',
    onPress,
  }: EventItemProps) {
    useThemeVersion();
    const theme = getCurrentTheme();
    const startDate = toDate(startsAt);
    const range = `${formatDateTime(startsAt)} ~ ${formatDateTime(endsAt)}`;
    const handlePress = useCallback(() => onPress(id), [id, onPress]);

    const isFull = Boolean(capacity && (registeredCount ?? 0) >= capacity);
    const capacityText = capacity
      ? `${registeredCount ?? 0}/${capacity} 人報名`
      : registeredCount
        ? `${registeredCount} 人報名`
        : '名額不限';

    if (viewMode === 'card') {
      return (
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => ({
            borderRadius: theme.radius.lg,
            backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: 14,
            gap: 8,
          })}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`查看活動：${title}`}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              {status === 'ongoing' ? (
                <StatusBadge status="open" text="進行中" />
              ) : status === 'ended' ? (
                <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
                  已結束
                </Text>
              ) : (
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                  {startDate ? formatRelativeTime(startDate) : formatDateTime(startsAt)}
                </Text>
              )}
            </View>
            {isFavorite && <Ionicons name="heart" size={16} color={theme.colors.danger} />}
          </View>

          <Text
            style={{
              color: theme.colors.text,
              fontWeight: '600',
              fontSize: theme.typography.h3.fontSize,
              lineHeight: theme.typography.h3.lineHeight,
              letterSpacing: theme.typography.h3.letterSpacing,
            }}
            numberOfLines={2}
          >
            {title}
          </Text>

          {location && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Ionicons name="location-outline" size={13} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }} numberOfLines={1}>
                {location}
              </Text>
            </View>
          )}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.separator,
            }}
          >
            {isFull ? (
              <Pill text={`${registeredCount ?? 0}/${capacity} 人已滿`} kind="danger" size="sm" />
            ) : (
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{capacityText}</Text>
            )}
            <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
          </View>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
          paddingVertical: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        })}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`查看活動：${title}`}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {status === 'ongoing' && <StatusBadge status="open" text="進行中" />}
            {status === 'upcoming' && startDate && (
              <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
                {formatRelativeTime(startDate)}
              </Text>
            )}
            {status === 'ended' && (
              <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
                已結束
              </Text>
            )}
            {isFull && <Pill text="額滿" kind="danger" size="sm" />}
            {isFavorite && <Ionicons name="heart" size={14} color={theme.colors.danger} />}
          </View>

          <Text
            style={{
              fontSize: theme.typography.h3.fontSize,
              fontWeight: '600',
              color: theme.colors.text,
              letterSpacing: theme.typography.h3.letterSpacing,
              lineHeight: theme.typography.h3.lineHeight,
            }}
            numberOfLines={2}
          >
            {title}
          </Text>

          <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 17 }}>
            {`${range}${location ? ` · ${location}` : ''} · ${capacityText}`}
          </Text>

          {description && (
            <Text
              style={{
                color: theme.colors.textSecondary,
                lineHeight: theme.typography.bodySmall.lineHeight,
                fontSize: theme.typography.bodySmall.fontSize,
              }}
              numberOfLines={2}
            >
              {description}
            </Text>
          )}
        </View>

        <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
      </Pressable>
    );
  },
  (prev, next) => {
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
  },
);

export type MenuItemProps = {
  id: string;
  name: string;
  price?: number;
  cafeteria: string;
  availableOn: string;
  isAvailable?: boolean;
  onPress?: (id: string) => void;
};

export const MenuItem = memo(
  function MenuItem({
    id,
    name,
    price,
    cafeteria,
    availableOn,
    isAvailable = true,
    onPress,
  }: MenuItemProps) {
    useThemeVersion();
    const theme = getCurrentTheme();
    const handlePress = useCallback(() => onPress?.(id), [id, onPress]);

    return (
      <Pressable
        onPress={handlePress}
        disabled={!onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 13,
          paddingHorizontal: 16,
          backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.separator,
          opacity: isAvailable ? 1 : 0.48,
          gap: 12,
        })}
      >
        <View style={{ width: 22, alignItems: 'center' }}>
          <Ionicons name="restaurant-outline" size={17} color={theme.colors.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              color: theme.colors.text,
              fontWeight: '600',
              fontSize: theme.typography.h3.fontSize,
              lineHeight: theme.typography.h3.lineHeight,
            }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {cafeteria}
          </Text>
        </View>
        {!isAvailable ? (
          <Pill text="已售完" kind="danger" size="sm" />
        ) : price !== undefined ? (
          <Text
            style={{
              color: theme.colors.text,
              fontWeight: '600',
              fontSize: 15,
              fontVariant: ['tabular-nums'],
            }}
          >
            ${price}
          </Text>
        ) : null}
      </Pressable>
    );
  },
  (prev, next) => {
    return (
      prev.id === next.id &&
      prev.name === next.name &&
      prev.price === next.price &&
      prev.cafeteria === next.cafeteria &&
      prev.availableOn === next.availableOn &&
      prev.isAvailable === next.isAvailable
    );
  },
);
