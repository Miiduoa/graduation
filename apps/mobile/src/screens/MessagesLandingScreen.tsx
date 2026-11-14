import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MESSAGING_NAV_SECTIONS } from '@campus/shared/src/academicSections';
import { DmsScreen } from './DmsScreen';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

const NOTIFY_SECTION = MESSAGING_NAV_SECTIONS[0];

export function MessagesLandingScreen({ navigation }: ServiceScreenProps) {
  const s = useThemeStyleSheet(createStyles);
  const insets = useSafeAreaInsets();
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
      <View style={[s.header, { paddingTop: Math.max(insets.top, 8) + 10 }]}>
        <Text accessibilityRole="header" style={s.title}>
          交流
        </Text>
        <Text style={s.subtitle}>聊近況、找同學，接續你的對話。</Text>
        <View style={s.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
              onPress={action.onPress}
              style={({ pressed }) => [s.action, pressed && s.pressed]}
            >
              <Ionicons name={action.icon} size={20} color={theme.colors.accent} />
              <Text style={s.actionLabel}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
        <Text accessibilityRole="header" style={s.inboxHeading}>
          私訊
        </Text>
      </View>
      <DmsScreen navigation={navigation} />
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    header: { paddingHorizontal: 18, paddingBottom: 8 },
    title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, color: theme.colors.text },
    subtitle: { color: theme.colors.textSecondary, marginTop: 6, lineHeight: 20, fontSize: 13 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
    action: {
      flexBasis: '45%',
      flexGrow: 1,
      minWidth: 130,
      minHeight: 52,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    actionLabel: {
      flex: 1,
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: 14,
      lineHeight: 20,
    },
    inboxHeading: { color: theme.colors.text, fontWeight: '600', fontSize: 17, marginTop: 18 },
    pressed: { backgroundColor: theme.colors.surfaceInteractive },
  });