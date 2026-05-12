/* eslint-disable */
/**
 * 🏫 校園社群 — Community Screen
 *
 * 四個分頁：動態（Firestore 貼文）| 看板 | 即時（Story + LBS）| 學伴
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';

import { HomeFeedScreen } from './social/HomeFeedScreen';
import { BoardsScreen } from './social/BoardsScreen';
import { RealtimeSocialScreen } from './social/RealtimeSocialScreen';
import { StudyBuddyPanel } from './community/StudyBuddyPanel';
import { CampusSocialNavProvider } from './social/CampusSocialNavContext';

type TabKey = 'feed' | 'boards' | 'realtime' | 'buddy';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'feed', label: '動態', icon: 'sparkles-outline' },
  { key: 'boards', label: '看板', icon: 'grid-outline' },
  { key: 'realtime', label: '即時', icon: 'flash-outline' },
  { key: 'buddy', label: '學伴', icon: 'people-outline' },
];

const LEGACY_TAB: Record<string, TabKey> = {
  social: 'feed',
  pulse: 'realtime',
};

export function CommunityScreen(props: Record<string, unknown>) {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('feed');
  const stackNav = (props as any)?.navigation;

  // 支援從 route.params.initialTab 指定初始 tab（含舊版 social / pulse 別名）
  const route = (props as any)?.route;
  const rawInitial = route?.params?.initialTab as string | undefined;
  const initialTab: TabKey | undefined = rawInitial
    ? (LEGACY_TAB[rawInitial] ?? (rawInitial as TabKey))
    : undefined;
  useEffect(() => {
    if (initialTab && TABS.some((t) => t.key === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* ─── Top Segment Tabs ─── */}
      <View
        style={{
          paddingTop: insets.top + 4,
          paddingBottom: 10,
          paddingHorizontal: 16,
          backgroundColor: theme.colors.bg,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '800',
            color: theme.colors.text,
            marginBottom: 10,
          }}
        >
          校園社群
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  paddingVertical: 9,
                  borderRadius: theme.radius.md,
                  backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                  borderWidth: active ? 0 : 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={15}
                  color={active ? '#fff' : theme.colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: active ? '700' : '500',
                    color: active ? '#fff' : theme.colors.textSecondary,
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ─── Content ─── */}
      <CampusSocialNavProvider navigation={stackNav}>
        <View style={{ flex: 1 }}>
          {activeTab === 'feed' && <HomeFeedScreen />}
          {activeTab === 'boards' && <BoardsScreen />}
          {activeTab === 'realtime' && <RealtimeSocialScreen />}
          {activeTab === 'buddy' && <StudyBuddyPanel />}
        </View>
      </CampusSocialNavProvider>
    </View>
  );
}

export default CommunityScreen;
