/**
 * HeaderAvatarButton — 在各 Tab 主畫面左上角顯示的頭像按鈕
 * ═══════════════════════════════════════════════════════════════════════
 * 點擊 → 開啟 HeaderDrawer
 * 替代原本「我的」Tab 的功能入口。
 */
import React from 'react';
import { Pressable, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { headerDrawer } from './HeaderDrawer';
import { theme } from '../ui/theme';

export interface HeaderAvatarButtonProps {
  size?: number;
}

export function HeaderAvatarButton({ size = 36 }: HeaderAvatarButtonProps) {
  const auth = useAuth();
  const notifs = useNotifications();
  const initial = (auth.profile?.displayName ?? auth.user?.email ?? '訪')
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <Pressable
      testID="header-avatar-button"
      onPress={() => headerDrawer.open()}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="開啟個人選單"
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View>
        <LinearGradient
          colors={[theme.colors.accent, '#7C3AED']}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {auth.user ? (
            <Text
              style={{
                color: '#fff',
                fontSize: size * 0.45,
                fontWeight: '800',
              }}
            >
              {initial}
            </Text>
          ) : (
            <Ionicons name="person-outline" size={size * 0.5} color="#fff" />
          )}
        </LinearGradient>
        {/* 紅點：未讀通知 */}
        {notifs.unreadCount > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: 8,
              backgroundColor: theme.colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.colors.bg,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
              {notifs.unreadCount > 9 ? '9+' : notifs.unreadCount}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default HeaderAvatarButton;
