import React, { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DmsScreen } from './DmsScreen';
import { getThemeVersion, subscribeToTheme, theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

export function MessagesLandingScreen({ navigation }: ServiceScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={{
          paddingTop: Math.max(insets.top, 8) + 10,
          paddingHorizontal: 18,
          paddingBottom: 18,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: -0.6, color: theme.colors.text }}>
          訊息
        </Text>
        <Text style={{ color: theme.colors.textSecondary, marginTop: 6, lineHeight: 20, fontSize: 13 }}>
          本校對話即時更新。從這裡接續私訊，或和群組成員討論。
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前往我的群組"
            onPress={() => safeNavigate(navigation, 'Groups')}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 58,
              borderRadius: 14,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name="people-outline" size={22} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>我的群組</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="搜尋同學或管理好友邀請"
            onPress={() => safeNavigate(navigation, 'FriendsManage')}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 58,
              borderRadius: 14,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Ionicons name="person-add-outline" size={22} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>好友與邀請</Text>
          </Pressable>
        </View>
      </View>
      <DmsScreen navigation={navigation} />
    </View>
  );
}
