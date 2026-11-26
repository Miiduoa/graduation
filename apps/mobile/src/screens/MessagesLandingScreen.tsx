import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MESSAGING_NAV_SECTIONS } from '@campus/shared/src/academicSections';
import { DmsScreen } from './DmsScreen';
import { theme } from '../ui/theme';
import { pageTitleFont } from '../ui/styles';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

const NOTIFY_SECTION = MESSAGING_NAV_SECTIONS[0];

/** Above this text scale (or on short screens) the header gives room back to the inbox. */
const COMPACT_FONT_SCALE = 1.25;
const COMPACT_HEIGHT = 640;

export function MessagesLandingScreen({ navigation }: ServiceScreenProps) {
  const s = useThemeStyleSheet(createStyles);
  const insets = useSafeAreaInsets();
  const { fontScale, height } = useWindowDimensions();
  const compact = fontScale > COMPACT_FONT_SCALE || height < COMPACT_HEIGHT;
  const actions = [
    {
      label: '校園社群',
      accessibilityLabel: '前往校園社群',
      icon: 'people-outline' as const,
      onPress: () => safeNavigate(navigation, 'CampusSocialScreen'),
    },
    {
      label: '好友與邀請',
      accessibilityLabel: '搜尋同學或管理好友邀請',
      icon: 'person-add-outline' as const,
      onPress: () => safeNavigate(navigation, 'FriendsManage'),
    },
    {
      label: '我的群組',
      accessibilityLabel: '前往我的群組',
      icon: 'chatbubbles-outline' as const,
      onPress: () => safeNavigate(navigation, 'Groups'),
    },
    {
      label: NOTIFY_SECTION.label,
      accessibilityLabel: `前往${NOTIFY_SECTION.label}`,
      icon: 'notifications-outline' as const,
      onPress: () => safeNavigate(navigation, NOTIFY_SECTION.mobileScreen),
    },
  ];

  return (
    <View style={s.page}>
      <View
        style={[
          s.header,
          { paddingTop: Math.max(insets.top, 8) + (compact ? 4 : 10) },
        ]}
      >
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.4}
          style={[s.title, compact && s.titleCompact]}
        >
          交流
        </Text>
      </View>
      {/* The directory is one scrolling row, so its height never grows with text size. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.directory}
        contentContainerStyle={s.directoryContent}
        accessibilityLabel="交流入口"
      >
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel}
            onPress={action.onPress}
            style={({ pressed }) => [s.action, pressed && s.pressed]}
          >
            {compact ? null : (
              <Ionicons name={action.icon} size={18} color={theme.colors.accent} />
            )}
            <Text style={s.actionLabel} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {compact ? null : (
        <Text accessibilityRole="header" style={s.inboxHeading}>
          私訊
        </Text>
      )}
      <View style={s.inbox}>
        <DmsScreen navigation={navigation} />
      </View>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    header: { paddingHorizontal: 18, paddingBottom: 4 },
    title: {
      fontFamily: pageTitleFont,
      fontSize: 30,
      lineHeight: 38,
      fontWeight: '800',
      letterSpacing: 0,
      color: theme.colors.text,
    },
    titleCompact: { fontSize: 24, lineHeight: 30 },
    directory: {
      flexGrow: 0,
      flexShrink: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    directoryContent: { paddingHorizontal: 10, gap: 4, alignItems: 'center' },
    action: {
      minHeight: 44,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    actionLabel: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 14,
      lineHeight: 20,
    },
    inboxHeading: {
      color: theme.colors.textSecondary,
      fontWeight: '700',
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 18,
      paddingTop: 12,
    },
    inbox: { flex: 1, minHeight: 0 },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
  });
